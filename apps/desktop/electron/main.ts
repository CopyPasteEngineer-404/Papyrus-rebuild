import { app, BrowserWindow, ipcMain, dialog, shell, session, crashReporter } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { DatabaseConnection, runMigrations, WorkspaceRepository, FileRepository, TraceRepository } from '@papyrus/database';
import { executePipeline } from '@papyrus/orchestrator';
import { logger, generateId, OutputFormat, ConstraintSet, DEFAULT_CONSTRAINT_SET } from '@papyrus/shared';
import { ConverterWorkerPool, SourceFormat, TargetFormat, HtmlConversionOptions, VALID_TARGET_FORMATS } from '@papyrus/workers';
import { ExportManager } from './export-manager';

const SUPPORTED_EXTENSIONS = ['.md', '.csv', '.txt', '.mmd', '.mermaid', '.html', '.tex', '.latex', '.docx'];
const SUPPORTED_FORMATS_NO_EXT = ['md', 'csv', 'txt', 'mermaid', 'mmd', 'html', 'latex', 'tex', 'docx'];

/** Map file extension (without dot) to SourceFormat for conversion routing */
const EXT_TO_SOURCE_FORMAT: Record<string, SourceFormat> = {
  md: 'md', markdown: 'md', csv: 'csv', txt: 'txt', text: 'txt',
  mmd: 'mermaid', mermaid: 'mermaid', html: 'html', tex: 'latex', latex: 'latex', docx: 'docx',
};

// ESM-safe __dirname replacement — must be computed at module top-level
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Crash Reporter ---
// Collects crash dumps in the user data directory for post-mortem debugging.
// Dumps are stored under crashes/ and uploaded on next launch if a URL is configured.
const crashesDir = path.join(app.getPath('userData'), 'crashes');
if (!fs.existsSync(crashesDir)) {
  fs.mkdirSync(crashesDir, { recursive: true });
}
crashReporter.start({
  submitURL: '', // Set to a URL to auto-upload crash reports
  productName: 'Papyrus',
  compress: true,
  uploadToServer: false,
  extra: {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  },
});

// --- Global Error Handlers ---
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
});

let mainWindow: BrowserWindow | null = null;
let db: DatabaseConnection | null = null;
let currentWorkspace: string | null = null;
let exportManager: ExportManager | null = null;
let converterPool: ConverterWorkerPool | null = null;
let fsWatchers: fs.FSWatcher[] = [];

/**
 * Security: Check that a file path is contained within the current workspace.
 * Uses path.resolve() to normalize both paths before comparison, preventing
 * path traversal attacks via symlinks, relative segments (../), or
 * prefix-spoofing (e.g. /workspace-evil masquerading as /workspace).
 */
function isWithinWorkspace(filePath: string): boolean {
  if (!currentWorkspace) return false;
  try {
    // Resolve symlinks to prevent symlink-based path traversal
    const resolvedPath = fs.realpathSync(path.resolve(filePath));
    const resolvedWorkspace = fs.realpathSync(path.resolve(currentWorkspace));
    // Use path.relative to properly check containment (prevents prefix-spoofing)
    const relative = path.relative(resolvedWorkspace, resolvedPath);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  } catch {
    // If realpath fails (file doesn't exist yet), fall back to non-symlink check
    const resolvedPath = path.resolve(filePath);
    const resolvedWorkspace = path.resolve(currentWorkspace);
    return resolvedPath === resolvedWorkspace || resolvedPath.startsWith(resolvedWorkspace + path.sep);
  }
}

// --- Built-in JSON Settings Store (replaces electron-store) ---
// Eliminates the broken dependency chain: electron-store → conf → dot-prop → is-obj

class JsonSettingsStore {
  private filePath: string;
  private data: Record<string, any>;
  private defaults: Record<string, any>;

  constructor(fileName: string, defaults: Record<string, any>) {
    this.defaults = defaults;
    // Use Electron's userData directory for settings storage
    const userDataPath = app.getPath('userData');
    this.filePath = path.join(userDataPath, `${fileName}.json`);
    this.data = { ...defaults };
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.data = { ...this.defaults, ...parsed };
      }
    } catch (err) {
      logger.warn('Failed to load settings file, using defaults:', err);
      this.data = { ...this.defaults };
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      logger.error('Failed to save settings file:', err);
    }
  }

  get<T = any>(key: string, defaultValue?: T): T {
    if (key in this.data) {
      return this.data[key] as T;
    }
    return defaultValue as T;
  }

  set(key: string, value: any): void {
    this.data[key] = value;
    this.save();
  }
}

const settingsStore = new JsonSettingsStore('papyrus-settings', {
  theme: 'dark',
  themeSkin: 'papyrus',
  lastWorkspace: null as string | null,
  recentWorkspaces: [] as Array<{ path: string; name: string; lastOpened: number }>,
  aiProvider: 'none',
  exportPreferences: DEFAULT_CONSTRAINT_SET,
});

// Allowed settings keys — only these can be read/written via settings:getKey/settings:setKey
const ALLOWED_SETTINGS_KEYS = new Set([
  'theme',
  'themeSkin',
  'lastWorkspace',
  'recentWorkspaces',
  'aiProvider',
  'exportPreferences',
  'setupComplete',
  'clockMode',
  'layoutMode',
]);

/** Update recent workspaces list (max 10 entries) */
function addRecentWorkspace(workspacePath: string, workspaceName: string): void {
  const recent: Array<{ path: string; name: string; lastOpened: number }> = settingsStore.get('recentWorkspaces', []) as any;
  // Remove if already present
  const filtered = recent.filter((w) => w.path !== workspacePath);
  // Add to front
  filtered.unshift({ path: workspacePath, name: workspaceName, lastOpened: Date.now() });
  // Keep max 10
  settingsStore.set('recentWorkspaces', filtered.slice(0, 10));
}

// Active task abort controllers for task cancellation and graceful shutdown
const activeAbortControllers = new Map<string, AbortController>();

/**
 * Close current workspace resources (DB, file watchers, export manager).
 * Must be called before opening a new workspace to prevent resource leaks.
 */
async function closeCurrentWorkspace(): Promise<void> {
  await stopFileWatcher();
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
  currentWorkspace = null;
  exportManager = null;
}

/**
 * Shared workspace open logic — used by workspace:open, workspace:new, and workspace:openSample.
 * Initializes DB, ExportManager, file watcher, and indexing for a given workspace path.
 */
async function openWorkspaceAtPath(workspacePath: string): Promise<any> {
  // Always close previous workspace first to prevent resource leaks
  await closeCurrentWorkspace();

  // Validate: Check that the path exists and is a directory
  try {
    const stat = await fs.promises.stat(workspacePath);
    if (!stat.isDirectory()) {
      throw new Error('Selected path is not a directory');
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error('Directory does not exist. It may have been moved or deleted.');
    }
    if (err.code === 'EACCES') {
      throw new Error('Permission denied. Cannot access this directory.');
    }
    throw new Error(`Cannot open workspace: ${err.message}`);
  }

  // Step 1: Initialize database (async — sql.js WASM load)
  currentWorkspace = workspacePath;
  try {
    db = await DatabaseConnection.create(workspacePath);
    runMigrations(db.getDb(), db.getDbPath());
  } catch (dbErr: any) {
    logger.error('Database initialization failed:', dbErr);
    throw new Error('Failed to initialize database. The workspace may be on a read-only volume or the database is corrupted. Try a different directory.');
  }

  // Step 2: Create or find workspace record
  const workspaceRepo = new WorkspaceRepository(db.getDb());
  let workspace = workspaceRepo.findByPath(workspacePath);
  if (!workspace) {
    const name = path.basename(workspacePath);
    workspace = workspaceRepo.create(workspacePath, name);
  }

  // Step 3: Initialize ExportManager and Converter Worker Pool
  exportManager = new ExportManager(workspacePath, db.getDb());
  if (!converterPool) {
    converterPool = new ConverterWorkerPool();
  }

  // Step 4: Notify UI that indexing has started
  mainWindow?.webContents.send('workspace:indexing', { workspace });

  // Step 5: Index workspace files (with error recovery for individual files)
  const indexedFiles = await indexWorkspace(workspacePath);

  // Step 6: Start file watcher
  startFileWatcher(workspacePath);

  // Step 7: Save as last workspace & update recent workspaces
  settingsStore.set('lastWorkspace', workspacePath);
  addRecentWorkspace(workspacePath, path.basename(workspacePath));

  // Step 8: Notify UI that indexing is complete, including file list
  mainWindow?.webContents.send('workspace:indexed', { workspace, files: indexedFiles });
  return { ...workspace, files: indexedFiles };
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'Papyrus',
    frame: false, // Custom titlebar
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // vite-plugin-electron sets VITE_DEV_SERVER_URL when running in dev mode
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

// --- Content Security Policy ---

async function setupCSP(): Promise<void> {
  if (process.env.VITE_DEV_SERVER_URL) {
    // In dev mode, allow connections for Vite HMR and mermaid
    await session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:5173 http://localhost:5173 https://cdn.jsdelivr.net; " +
            "style-src 'self' 'unsafe-inline' http://127.0.0.1:5173 http://localhost:5173 https://cdn.jsdelivr.net; " +
            "connect-src 'self' http://127.0.0.1:5173 http://localhost:5173 ws://127.0.0.1:5173 ws://localhost:5173 https://cdn.jsdelivr.net; " +
            "font-src 'self' http://127.0.0.1:5173 http://localhost:5173 https://cdn.jsdelivr.net; " +
            "img-src 'self' data: blob: https:; " +
            "worker-src 'self' blob:;",
          ],
        },
      });
    });
  } else {
    // Production: tightened CSP — no unsafe-eval, unsafe-inline only for styles (required by Tailwind)
    await session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
            "script-src 'self' https://cdn.jsdelivr.net; " +
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
            "connect-src 'self' https://cdn.jsdelivr.net; " +
            "font-src 'self' https://cdn.jsdelivr.net; " +
            "img-src 'self' data: blob: https:; " +
            "worker-src 'self' blob:; " +
            "object-src 'none'; " +
            "base-uri 'self';",
          ],
        },
      });
    });
  }
}

// --- IPC Handlers ---

// Window Controls
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('window:close', () => mainWindow?.close());

// Workspace: Open — Full lifecycle: Open → Scan → Store Metadata → Init DB → Load UI
ipcMain.handle('workspace:open', async (_event, payload: { path: string }) => {
  try {
    let workspacePath = payload.path;
    if (!workspacePath || workspacePath === '') {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Open Workspace',
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      workspacePath = result.filePaths[0];
    }

    return await openWorkspaceAtPath(workspacePath);
  } catch (error) {
    logger.error('Failed to open workspace:', error);
    // Clean up on failure — stop watchers, close DB, reset state
    await stopFileWatcher();
    if (db) {
      try { db.close(); } catch { /* ignore */ }
      db = null;
    }
    currentWorkspace = null;
    exportManager = null;
    throw error;
  }
});

// Workspace: Close
ipcMain.handle('workspace:close', async () => {
  await stopFileWatcher();
  if (db) {
    db.close();
    db = null;
  }
  currentWorkspace = null;
  exportManager = null;
});

// Workspace: Delete — Close workspace, remove from recent list, delete DB record
ipcMain.handle('workspace:delete', async (_event, payload: { path: string }) => {
  const workspacePath = payload.path;
  if (!workspacePath || typeof workspacePath !== 'string') {
    throw new Error('Invalid workspace path');
  }

  // If the workspace being deleted is the current one, close it first
  if (currentWorkspace === workspacePath) {
    await stopFileWatcher();
    if (db) {
      try { db.close(); } catch { /* ignore */ }
      db = null;
    }
    currentWorkspace = null;
    exportManager = null;
  }

  // Remove from recent workspaces list
  try {
    const recent: Array<{ path: string; name: string; lastOpened: number }> = settingsStore.get('recentWorkspaces', []) as any;
    const filtered = recent.filter((w) => w.path !== workspacePath);
    settingsStore.set('recentWorkspaces', filtered);
  } catch {
    // Ignore errors in removing from recent list
  }

  // Remove from the database (if we have a DB open for another workspace, query it)
  // Note: we cannot easily delete from the workspace-specific DB since we just closed it.
  // The workspace record lives in its own DB, so it's cleaned up when the workspace directory is removed.
  // The main cleanup is: close resources + remove from recent list.

  // Notify renderer that workspace was deleted
  mainWindow?.webContents.send('workspace:deleted', { path: workspacePath });

  return { success: true, path: workspacePath };
});

// Workspace: Reindex — Re-index the current workspace (no dialog, no DB re-init)
ipcMain.handle('workspace:reindex', async () => {
  if (!currentWorkspace || !db) {
    throw new Error('No workspace is currently open. Open a workspace first.');
  }

  try {
    // Notify UI that indexing has started
    const workspaceRepo = new WorkspaceRepository(db.getDb());
    let workspace = workspaceRepo.findByPath(currentWorkspace);
    if (!workspace) {
      workspace = workspaceRepo.create(currentWorkspace, path.basename(currentWorkspace));
    }

    mainWindow?.webContents.send('workspace:indexing', { workspace });

    // Re-index all files
    const indexedFiles = await indexWorkspace(currentWorkspace);

    // Notify UI that indexing is complete
    mainWindow?.webContents.send('workspace:indexed', { workspace, files: indexedFiles });

    return { ...workspace, files: indexedFiles };
  } catch (error) {
    logger.error('Failed to reindex workspace:', error);
    throw error;
  }
});

// Workspace: Get Info
ipcMain.handle('workspace:getInfo', async () => {
  if (!db) return [];
  const workspaceRepo = new WorkspaceRepository(db.getDb());
  return workspaceRepo.getAll();
});

// Search: Keyword search
ipcMain.handle('search:query', async (_event, payload: { query: string; filters?: any }) => {
  if (!db) return [];

  try {
    // Validate inputs
    if (!payload.query || typeof payload.query !== 'string') {
      return [];
    }

    // Sanitize filters to prevent injection
    const allowedFormats = [...SUPPORTED_FORMATS_NO_EXT];
    const filters = payload.filters;
    const formatFilter = filters?.formats && Array.isArray(filters.formats)
      ? filters.formats.filter((f: any) => typeof f === 'string' && allowedFormats.includes(f))
      : undefined;
    const modifiedAfter = filters?.modifiedAfter && typeof filters.modifiedAfter === 'number'
      ? filters.modifiedAfter
      : undefined;

    const fileRepo = new FileRepository(db.getDb());
    const workspaceRepo = new WorkspaceRepository(db.getDb());

    // Use currentWorkspace to find the correct workspace ID instead of always using the first one
    let workspaceId: string | undefined;
    if (currentWorkspace) {
      const ws = workspaceRepo.findByPath(currentWorkspace);
      if (ws) workspaceId = ws.id;
    }
    if (!workspaceId) {
      const workspaces = workspaceRepo.getAll();
      if (workspaces.length === 0) return [];
      workspaceId = workspaces[0].id;
    }

    const queryTerms = payload.query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    const allFiles = fileRepo.findByWorkspace(workspaceId);

    let results = allFiles
      .map((file) => {
        const fileName = path.basename(file.path);
        const fileNameLower = fileName.toLowerCase();
        const ext = path.extname(file.path).toLowerCase().replace('.', '');

        let score = 0;
        for (const term of queryTerms) {
          if (fileNameLower.includes(term)) score += 3;
          if (ext === term) score += 2;
          if (file.format === term) score += 1;
        }

        return {
          fileId: file.id,
          fileName,
          filePath: file.path,
          format: file.format,
          size: 0,
          modifiedAt: file.indexed_at,
          score,
          snippet: '',
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    if (formatFilter) {
      results = results.filter((r) => formatFilter.includes(r.format));
    }

    return results.slice(0, 50);
  } catch (error) {
    logger.error('Search failed:', error);
    return [];
  }
});

// Task: Create — THE PIPELINE ENTRY POINT
ipcMain.handle('task:create', async (_event, payload: { sourceFiles: string[]; outputFormats: OutputFormat[]; constraints: ConstraintSet }) => {
  if (!currentWorkspace) throw new Error('No workspace open. Please open a workspace first.');
  if (!exportManager) throw new Error('Export manager not initialized. Try reopening the workspace.');

  // Security: ensure all source files are within the workspace
  for (const srcFile of payload.sourceFiles) {
    if (!isWithinWorkspace(srcFile)) {
      throw new Error(`Access denied: source file is outside the workspace: ${path.basename(srcFile)}`);
    }
  }

  // Validate source files exist and are readable
  for (const srcFile of payload.sourceFiles) {
    try {
      const stat = await fs.promises.stat(srcFile);
      if (!stat.isFile()) {
        throw new Error(`Source path is not a file: ${srcFile}`);
      }
      if (stat.size === 0) {
        logger.warn(`Source file is empty: ${srcFile}`);
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error(`Source file not found: ${path.basename(srcFile)}. It may have been moved or deleted.`);
      }
      if (err.code === 'EACCES') {
        throw new Error(`Permission denied reading file: ${path.basename(srcFile)}`);
      }
      if (err.code === 'EBUSY') {
        throw new Error(`File is locked by another process: ${path.basename(srcFile)}. Close it and try again.`);
      }
      throw new Error(`Cannot read source file: ${err.message}`);
    }
  }

  const outputDir = exportManager.getExportDir();
  const taskId = generateId();

  // Create AbortController for this task
  const abortController = new AbortController();
  activeAbortControllers.set(taskId, abortController);

  // Notify UI that task is starting
  mainWindow?.webContents.send('task:progress', {
    taskId,
    phase: 'starting',
    percentComplete: 0,
  });

  let completedData: any = null;

  const task = await executePipeline(
    payload.sourceFiles,
    payload.outputFormats,
    payload.constraints,
    outputDir,
    (event, data) => {
      if (abortController.signal.aborted) return;

      if (event === 'progress') {
        mainWindow?.webContents.send('task:progress', {
          ...data,
          percentComplete: calculateProgress(data),
        });
      } else if (event === 'completed') {
        completedData = data;
      } else if (event === 'failed') {
        activeAbortControllers.delete(taskId);
        mainWindow?.webContents.send('task:failed', data);
      } else if (event === 'worker-done') {
        mainWindow?.webContents.send('task:progress', {
          taskId: data.taskId,
          format: data.format,
          result: data.result,
          percentComplete: calculateWorkerProgress(data),
        });
      }
    }
  );

  // Process completion logic AFTER executePipeline resolves (properly awaited)
  if (completedData?.task?.results) {
    try {
      const exports: any[] = [];
      const workerResults: any[] = [];
      for (const [format, result] of Object.entries(completedData.task.results)) {
        const r = result as any;
        if (r.artifacts) {
          for (const artifact of r.artifacts) {
            exports.push({
              format,
              outputPath: path.join(outputDir, artifact.filename),
              fileSize: artifact.size,
              sourcePath: payload.sourceFiles[0] || '',
            });
          }
        }
        workerResults.push({
          format,
          duration: r.duration || 0,
          success: r.success !== false,
        });
      }

      for (const exp of exports) {
        try {
          const stat = await fs.promises.stat(exp.outputPath);
          exp.fileSize = stat.size > 0 ? stat.size : 0;
        } catch {
          exp.fileSize = 0;
        }
      }

      for (const exp of exports) {
        await exportManager?.recordExport(
          completedData.task.id, exp.format, exp.outputPath, exp.fileSize,
          exp.sourcePath, exp.format === 'pdf' ? 'pdf-worker' : exp.format === 'txt' ? 'txt-worker' : 'markdown-worker',
          workerResults.find(w => w.format === exp.format)?.duration,
        );
      }

      if (exports.length > 0 && exportManager) {
        const manifest = exportManager.generateManifest(completedData.task.id, exports, workerResults);
        await exportManager.writeManifest(manifest);
      }

      if (db) {
        const traceRepo = new TraceRepository(db.getDb());
        const workspaceRepo = new WorkspaceRepository(db.getDb());
        let traceWorkspaceId: string | undefined;
        if (currentWorkspace) {
          const ws = workspaceRepo.findByPath(currentWorkspace);
          if (ws) traceWorkspaceId = ws.id;
        }
        if (!traceWorkspaceId) {
          const workspaces = workspaceRepo.getAll();
          if (workspaces.length > 0) traceWorkspaceId = workspaces[0].id;
        }
        if (traceWorkspaceId) {
          traceRepo.create(traceWorkspaceId, JSON.stringify(completedData.task));
        }
        db.markDirty();
      }
    } catch (err) {
      logger.error('Error in task completion handler:', err);
    }

    activeAbortControllers.delete(taskId);
    mainWindow?.webContents.send('task:completed', completedData);
  }

  return task;
});

// Task: Cancel — Real cancellation via AbortController
ipcMain.handle('task:cancel', async (_event, payload: { taskId: string }) => {
  const { taskId } = payload;
  const controller = activeAbortControllers.get(taskId);

  if (controller) {
    controller.abort();
    activeAbortControllers.delete(taskId);
    logger.info(`Task cancelled: ${taskId}`);

    // Notify UI with proper cancelled event
    mainWindow?.webContents.send('task:cancelled', {
      taskId,
      status: 'cancelled',
      error: 'Task was cancelled by user',
    });
  } else {
    logger.warn(`Task cancellation requested but no active controller: ${taskId}`);
  }
});

// Convert: File — Direct format conversion (md→txt, csv→txt, csv→html, etc.)
// Bypasses the full IR pipeline for simpler "Save As..." style conversions
ipcMain.handle('convert:file', async (_event, payload: { sourceFilePath: string; targetFormat: string; htmlOptions?: HtmlConversionOptions; taskId?: string }) => {
  const { sourceFilePath, targetFormat, htmlOptions, taskId } = payload;

  if (!currentWorkspace) {
    throw new Error('No workspace open. Please open a workspace first.');
  }
  if (!exportManager) {
    throw new Error('Export manager not initialized. Try reopening the workspace.');
  }
  if (!converterPool) {
    throw new Error('Converter not initialized. Try reopening the workspace.');
  }

  // Security: ensure source file is within the workspace
  if (!isWithinWorkspace(sourceFilePath)) {
    throw new Error('Access denied: source file is outside the workspace.');
  }

  // Validate target format
  if (!VALID_TARGET_FORMATS.includes(targetFormat as TargetFormat)) {
    throw new Error(`Invalid target format: ${targetFormat}. Supported: ${VALID_TARGET_FORMATS.join(', ')}`);
  }

  // Validate source file exists
  try {
    const stat = await fs.promises.stat(sourceFilePath);
    if (!stat.isFile()) {
      throw new Error(`Source path is not a file: ${sourceFilePath}`);
    }
    if (stat.size === 0) {
      logger.warn(`Source file is empty: ${sourceFilePath}`);
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(`Source file not found: ${path.basename(sourceFilePath)}. It may have been moved or deleted.`);
    }
    if (err.code === 'EACCES') {
      throw new Error(`Permission denied reading file: ${path.basename(sourceFilePath)}`);
    }
    throw new Error(`Cannot read source file: ${err.message}`);
  }

  // Detect source format from extension
  const ext = path.extname(sourceFilePath).toLowerCase().replace('.', '');
  const sourceFormat = EXT_TO_SOURCE_FORMAT[ext];
  if (!sourceFormat) {
    throw new Error(`Unsupported source file format: .${ext}. Supported formats: md, csv, txt, mermaid, latex, docx`);
  }

  // Same format check — no conversion needed
  if (sourceFormat === targetFormat) {
    throw new Error(`Source file is already ${targetFormat.toUpperCase()} format. No conversion needed.`);
  }

  // Perform the conversion on a worker thread (non-blocking)
  const outputDir = exportManager.getExportDir();

  // Check if the task was cancelled before starting conversion
  if (taskId) {
    const controller = activeAbortControllers.get(taskId);
    if (controller?.signal.aborted) {
      throw new Error('Task was cancelled');
    }
  }

  const result = await converterPool!.convert(sourceFilePath, sourceFormat, targetFormat as TargetFormat, outputDir, htmlOptions);

  if (!result.success) {
    throw new Error(result.error || 'Conversion failed for an unknown reason.');
  }

  // Record the export in the database
  if (db && exportManager) {
    const traceId = generateId();
    try {
      await exportManager.recordExport(
        traceId,
        result.targetFormat,
        result.outputPath,
        result.fileSize,
        sourceFilePath,
        `converter-${sourceFormat}-to-${result.targetFormat}`,
        result.duration,
      );
      db.markDirty();
    } catch (dbErr) {
      logger.error('Failed to record conversion export in database:', dbErr);
    }
  }

  // Notify UI about the new export
  mainWindow?.webContents.send('export:created', {
    format: result.targetFormat,
    outputPath: result.outputPath,
    fileSize: result.fileSize,
    sourcePath: sourceFilePath,
    workerName: `converter-${sourceFormat}-to-${result.targetFormat}`,
    duration: result.duration,
  });

  return result;
});

// Convert: Batch — Convert multiple files in parallel with progress reporting
ipcMain.handle('convert:batch', async (_event, payload: {
  files: Array<{ sourceFilePath: string; targetFormat: string }>;
  htmlOptions?: HtmlConversionOptions;
  taskId?: string;
}) => {
  const { files, htmlOptions, taskId } = payload;

  if (!currentWorkspace) {
    throw new Error('No workspace open. Please open a workspace first.');
  }
  if (!exportManager) {
    throw new Error('Export manager not initialized. Try reopening the workspace.');
  }
  if (!converterPool) {
    throw new Error('Converter not initialized. Try reopening the workspace.');
  }

  const outputDir = exportManager.getExportDir();
  const total = files.length;
  const results: Array<{ sourceFilePath: string; result: any }> = [];

  // Process files with controlled concurrency (max 3 parallel)
  const MAX_CONCURRENT = 3;
  let index = 0;

  async function processNext(): Promise<void> {
    while (index < files.length) {
      const i = index++;
      const file = files[i];

      // Check for cancellation
      if (taskId) {
        const controller = activeAbortControllers.get(taskId);
        if (controller?.signal.aborted) {
          throw new Error('Task was cancelled');
        }
      }

      // Validate source file
      try {
        await fs.promises.access(file.sourceFilePath, fs.constants.R_OK);
      } catch {
        results.push({
          sourceFilePath: file.sourceFilePath,
          result: { success: false, error: `File not accessible: ${path.basename(file.sourceFilePath)}` },
        });
        mainWindow?.webContents.send('task:progress', {
          taskId: taskId || 'batch',
          phase: 'converting',
          percentComplete: Math.round(((i + 1) / total) * 100),
          currentFile: path.basename(file.sourceFilePath),
        });
        continue;
      }

      // Detect source format
      const ext = path.extname(file.sourceFilePath).toLowerCase().replace('.', '');
      const sourceFormat = EXT_TO_SOURCE_FORMAT[ext];
      if (!sourceFormat) {
        results.push({
          sourceFilePath: file.sourceFilePath,
          result: { success: false, error: `Unsupported format: .${ext}` },
        });
        continue;
      }

      // Convert
      try {
        const result = await converterPool.convert(
          file.sourceFilePath, sourceFormat, file.targetFormat as TargetFormat, outputDir, htmlOptions,
        );
        results.push({ sourceFilePath: file.sourceFilePath, result });
      } catch (err) {
        results.push({
          sourceFilePath: file.sourceFilePath,
          result: { success: false, error: err instanceof Error ? err.message : String(err) },
        });
      }

      // Report progress
      mainWindow?.webContents.send('task:progress', {
        taskId: taskId || 'batch',
        phase: 'converting',
        percentComplete: Math.round(((i + 1) / total) * 100),
        currentFile: path.basename(file.sourceFilePath),
      });
    }
  }

  // Run up to MAX_CONCURRENT parallel workers
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, total) }, () => processNext());
  await Promise.all(workers);

  const succeeded = results.filter(r => r.result.success).length;
  const failed = results.filter(r => !r.result.success).length;

  return { total, succeeded, failed, results };
});

// Task: Get History (parses JSON task_data into objects)
ipcMain.handle('task:getHistory', async () => {
  if (!db) return [];
  const traceRepo = new TraceRepository(db.getDb());
  const workspaceRepo = new WorkspaceRepository(db.getDb());

  // Use currentWorkspace to find the correct workspace ID
  let historyWorkspaceId: string | undefined;
  if (currentWorkspace) {
    const ws = workspaceRepo.findByPath(currentWorkspace);
    if (ws) historyWorkspaceId = ws.id;
  }
  if (!historyWorkspaceId) {
    const workspaces = workspaceRepo.getAll();
    if (workspaces.length === 0) return [];
    historyWorkspaceId = workspaces[0].id;
  }

  const traces = traceRepo.findByWorkspace(historyWorkspaceId);
  // Parse task_data JSON strings into proper objects for the renderer
  return traces.map((trace: any) => {
    let taskData = trace.task_data;
    if (typeof taskData === 'string') {
      try {
        taskData = JSON.parse(taskData);
      } catch {
        // If parsing fails, leave as-is
      }
    }
    return { ...trace, task_data: taskData };
  });
});

// Export: Get All
ipcMain.handle('export:getAll', async () => {
  if (!exportManager) return [];
  return exportManager.getRecentExports();
});

// Export: Open in system viewer
ipcMain.handle('export:open', async (_event, payload: { outputPath: string }) => {
  // Security: Validate the export path is within the exports directory (resolve symlinks)
  if (exportManager) {
    const exportDir = exportManager.getExportDir();
    try {
      const resolvedPath = fs.realpathSync(path.resolve(payload.outputPath));
      const resolvedExportDir = fs.realpathSync(path.resolve(exportDir));
      if (!resolvedPath.startsWith(resolvedExportDir + path.sep) && resolvedPath !== resolvedExportDir) {
        throw new Error('Export path is outside the exports directory');
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error('Export file does not exist');
      }
      if (!err.message.includes('outside the exports directory')) {
        throw new Error('Export path is invalid');
      }
      throw err;
    }
  }
  await shell.openPath(payload.outputPath);
});

// Export: Show in file manager (selects the file, not just opens the folder)
ipcMain.handle('export:showInFolder', async (_event, payload: { outputPath: string }) => {
  // Security: Validate the export path is within the exports directory (resolve symlinks)
  if (exportManager) {
    const exportDir = exportManager.getExportDir();
    try {
      const resolvedPath = fs.realpathSync(path.resolve(payload.outputPath));
      const resolvedExportDir = fs.realpathSync(path.resolve(exportDir));
      if (!resolvedPath.startsWith(resolvedExportDir + path.sep) && resolvedPath !== resolvedExportDir) {
        throw new Error('Export path is outside the exports directory');
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error('Export file does not exist');
      }
      if (!err.message.includes('outside the exports directory')) {
        throw new Error('Export path is invalid');
      }
      throw err;
    }
  }
  shell.showItemInFolder(payload.outputPath);
});

// Recent Workspaces: Get list of last 10 workspaces
ipcMain.handle('workspace:getRecent', async () => {
  try {
    const recent: Array<{ path: string; name: string; lastOpened: number }> = settingsStore.get('recentWorkspaces', []) as any;
    // Filter out workspaces that no longer exist on disk
    return recent.filter((w) => {
      try { return fs.existsSync(w.path); } catch { return false; }
    });
  } catch {
    return [];
  }
});

// Recent Workspaces: Remove a workspace from the list
ipcMain.handle('workspace:removeRecent', async (_event, payload: { path: string }) => {
  try {
    const recent: Array<{ path: string; name: string; lastOpened: number }> = settingsStore.get('recentWorkspaces', []) as any;
    const filtered = recent.filter((w) => w.path !== payload.path);
    settingsStore.set('recentWorkspaces', filtered);
    return true;
  } catch {
    return false;
  }
});

// Workspace: New — Create a new workspace directory and open it
ipcMain.handle('workspace:new', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
      title: 'Create New Workspace',
      buttonLabel: 'Create Workspace',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const workspacePath = result.filePaths[0];

    // Create the directory if it doesn't exist
    if (!fs.existsSync(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true });
    }

    // Create a .papyrus-workspace marker file
    const markerPath = path.join(workspacePath, '.papyrus-workspace');
    if (!fs.existsSync(markerPath)) {
      fs.writeFileSync(markerPath, JSON.stringify({
        name: path.basename(workspacePath),
        createdAt: Date.now(),
        version: 1,
      }, null, 2), 'utf-8');
    }

    return await openWorkspaceAtPath(workspacePath);
  } catch (error) {
    logger.error('Failed to create new workspace:', error);
    // Clean up on failure
    await stopFileWatcher();
    if (db) {
      try { db.close(); } catch { /* ignore */ }
      db = null;
    }
    currentWorkspace = null;
    exportManager = null;
    throw error;
  }
});

// Workspace: Import Files — Copy selected files into the current workspace
ipcMain.handle('workspace:importFiles', async () => {
  if (!currentWorkspace) {
    throw new Error('No workspace is currently open. Open a workspace first.');
  }

  try {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Import Files into Workspace',
      filters: [
        { name: 'Supported Documents', extensions: ['md', 'csv', 'mmd', 'mermaid', 'txt', 'html', 'tex', 'latex', 'docx'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    const importedFiles: Array<{ name: string; path: string; success: boolean; error?: string }> = [];
    for (const srcPath of result.filePaths) {
      const fileName = path.basename(srcPath);
      const destPath = path.join(currentWorkspace, fileName);

      // Check if file already exists
      if (fs.existsSync(destPath) && srcPath !== destPath) {
        // Skip if source and destination are the same file
        importedFiles.push({ name: fileName, path: destPath, success: false, error: 'File already exists in workspace' });
        continue;
      }

      try {
        if (srcPath !== destPath) {
          await fs.promises.copyFile(srcPath, destPath);
        }
        importedFiles.push({ name: fileName, path: destPath, success: true });
      } catch (err: any) {
        importedFiles.push({ name: fileName, path: destPath, success: false, error: err.message });
      }
    }

    return importedFiles;
  } catch (error) {
    logger.error('Failed to import files:', error);
    throw error;
  }
});

// Workspace: Import Folder — Copy selected folder contents into the current workspace
ipcMain.handle('workspace:importFolder', async () => {
  if (!currentWorkspace) {
    throw new Error('No workspace is currently open. Open a workspace first.');
  }

  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Import Folder into Workspace',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    const srcDir = result.filePaths[0];
    const folderName = path.basename(srcDir);
    const destDir = path.join(currentWorkspace, folderName);
    const supportedExtensions = [...SUPPORTED_EXTENSIONS];
    const importedFiles: Array<{ name: string; path: string; success: boolean; error?: string }> = [];

    // Recursively copy supported files
    async function copyFiles(src: string, dest: string): Promise<void> {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }
      const entries = await fs.promises.readdir(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'exports') {
            await copyFiles(srcPath, destPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (supportedExtensions.includes(ext)) {
            try {
              await fs.promises.copyFile(srcPath, destPath);
              importedFiles.push({ name: entry.name, path: destPath, success: true });
            } catch (err: any) {
              importedFiles.push({ name: entry.name, path: destPath, success: false, error: err.message });
            }
          }
        }
      }
    }

    await copyFiles(srcDir, destDir);
    return importedFiles;
  } catch (error) {
    logger.error('Failed to import folder:', error);
    throw error;
  }
});

// Workspace: Open Sample — Open the bundled sample workspace
ipcMain.handle('workspace:openSample', async () => {
  try {
    // Look for sample-workspace relative to the app path
    let samplePath: string | null = null;

    // In development: check relative to project root
    const devSamplePath = path.join(app.getAppPath(), '..', 'sample-workspace');
    if (fs.existsSync(devSamplePath)) {
      samplePath = devSamplePath;
    }

    // In production: check relative to resources
    if (!samplePath) {
      const prodSamplePath = path.join(process.resourcesPath || '', 'sample-workspace');
      if (fs.existsSync(prodSamplePath)) {
        samplePath = prodSamplePath;
      }
    }

    if (!samplePath) {
      throw new Error('Sample workspace not found. The app may be running from an unexpected location.');
    }

    return await openWorkspaceAtPath(samplePath);
  } catch (error) {
    logger.error('Failed to open sample workspace:', error);
    // Clean up on failure
    await stopFileWatcher();
    if (db) {
      try { db.close(); } catch { /* ignore */ }
      db = null;
    }
    currentWorkspace = null;
    exportManager = null;
    throw error;
  }
});

// File: Write content to a file within the current workspace
ipcMain.handle('file:writeContent', async (_event, payload: { filePath: string; content: string }) => {
  try {
    const filePath = payload.filePath;
    const content = payload.content;
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path');
    }
    if (typeof content !== 'string') {
      throw new Error('Invalid content');
    }

    // Security: Only write files within the current workspace
    if (!isWithinWorkspace(filePath)) {
      throw new Error('File is outside the current workspace');
    }

    // Validate that the file already exists (don't allow creating new files via this API)
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) {
        throw new Error('Path is not a file');
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error('File does not exist. Cannot create new files via write API.');
      }
      throw new Error(`Cannot write to file: ${err.message}`);
    }

    await fs.promises.writeFile(filePath, content, 'utf-8');
    logger.info(`File written: ${filePath}`);
  } catch (error) {
    logger.error('Failed to write file:', error);
    throw error;
  }
});

// File: Read content for preview (only text-based files, max 512KB)
ipcMain.handle('file:readContent', async (_event, payload: { filePath: string }) => {
  try {
    const filePath = payload.filePath;
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path');
    }

    // Security: Only read files within the current workspace
    if (!isWithinWorkspace(filePath)) {
      throw new Error('File is outside the current workspace');
    }

    const stat = await fs.promises.stat(filePath);
    if (stat.size > 512 * 1024) {
      throw new Error('File too large for preview (max 512KB)');
    }

    const ext = path.extname(filePath).toLowerCase();
    const textExtensions = ['.md', '.csv', '.mmd', '.mermaid', '.txt', '.json', '.text', '.html', '.htm', '.tex', '.latex']; // Note: .docx is binary (ZIP), not text
    if (!textExtensions.includes(ext)) {
      throw new Error('File format not supported for text preview');
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    logger.error('Failed to read file for preview:', error);
    throw error;
  }
});

// Settings: Get (from electron-store)
ipcMain.handle('settings:get', async () => {
  return {
    aiProvider: settingsStore.get('aiProvider', 'none'),
    theme: settingsStore.get('theme', 'dark'),
    themeSkin: settingsStore.get('themeSkin', 'papyrus'),
    defaultConstraints: settingsStore.get('exportPreferences', DEFAULT_CONSTRAINT_SET),
    recentWorkspaces: settingsStore.get('recentWorkspaces', []),
  };
});

// Settings: Update (persist to electron-store) — only allowed keys
ipcMain.handle('settings:update', async (_event, settings: any) => {
  if (settings.theme && ['light', 'dark', 'system'].includes(settings.theme)) {
    settingsStore.set('theme', settings.theme);
  }
  if (settings.themeSkin && ['papyrus', 'halftone', 'isometric', 'minimalart'].includes(settings.themeSkin)) {
    settingsStore.set('themeSkin', settings.themeSkin);
  }
  if (settings.aiProvider && ['ollama', 'openai', 'none'].includes(settings.aiProvider)) {
    settingsStore.set('aiProvider', settings.aiProvider);
  }
  if (settings.defaultConstraints) {
    // Validate constraints against the Zod schema before persisting
    const { ConstraintSetSchema } = await import('@papyrus/shared');
    const parsed = ConstraintSetSchema.safeParse(settings.defaultConstraints);
    if (parsed.success) {
      settingsStore.set('exportPreferences', parsed.data);
    } else {
      logger.warn('Settings: invalid defaultConstraints, ignoring:', parsed.error);
    }
  }
  logger.info('Settings persisted:', settings);
});

// Settings: Get single key — only allowed keys
ipcMain.handle('settings:getKey', async (_event, key: string) => {
  if (!ALLOWED_SETTINGS_KEYS.has(key)) {
    logger.warn(`Settings: attempted to read disallowed key: ${key}`);
    return undefined;
  }
  return settingsStore.get(key);
});

// Settings: Set single key — only allowed keys
ipcMain.handle('settings:setKey', async (_event, payload: { key: string; value: any }) => {
  if (!ALLOWED_SETTINGS_KEYS.has(payload.key)) {
    logger.warn(`Settings: attempted to write disallowed key: ${payload.key}`);
    throw new Error(`Setting key '${payload.key}' is not allowed. Allowed keys: ${[...ALLOWED_SETTINGS_KEYS].join(', ')}`);
  }
  settingsStore.set(payload.key, payload.value);
});

// Diagnostics: Smoke test — verify core subsystems work
ipcMain.handle('diagnostics:smokeTest', async () => {
  const results: Array<{ name: string; status: 'pass' | 'fail'; message: string }> = [];

  // 1. Database connection
  try {
    if (db) {
      const dbAny = db.getDb();
      dbAny.prepare('SELECT 1 as ok').get();
      results.push({ name: 'Database', status: 'pass', message: 'SQLite database is connected and responsive' });
    } else {
      results.push({ name: 'Database', status: 'fail', message: 'No database connection. Open a workspace first.' });
    }
  } catch (err: any) {
    results.push({ name: 'Database', status: 'fail', message: `Database error: ${err.message}` });
  }

  // 2. Workspace path
  if (currentWorkspace) {
    try {
      const stat = await fs.promises.stat(currentWorkspace);
      results.push({ name: 'Workspace', status: 'pass', message: `Workspace directory exists: ${currentWorkspace}` });
    } catch (err: any) {
      results.push({ name: 'Workspace', status: 'fail', message: `Workspace directory error: ${err.message}` });
    }
  } else {
    results.push({ name: 'Workspace', status: 'fail', message: 'No workspace is currently open' });
  }

  // 3. Export directory writable
  if (exportManager) {
    try {
      const exportDir = exportManager.getExportDir();
      const testFile = path.join(exportDir, `.papyrus-write-test-${Date.now()}`);
      await fs.promises.writeFile(testFile, 'test');
      await fs.promises.unlink(testFile);
      results.push({ name: 'Export Directory', status: 'pass', message: `Export directory is writable: ${exportDir}` });
    } catch (err: any) {
      results.push({ name: 'Export Directory', status: 'fail', message: `Export directory not writable: ${err.message}` });
    }
  } else {
    results.push({ name: 'Export Directory', status: 'fail', message: 'Export manager not initialized. Open a workspace first.' });
  }

  // 4. Parser test — parse a small markdown string
  try {
    const { parseFile } = await import('@papyrus/parsers');
    const ir = await parseFile('test.md', '# Test\nHello world');
    if (ir && ir.children && ir.children.length > 0) {
      results.push({ name: 'Parser', status: 'pass', message: 'Markdown parser produces valid IR' });
    } else {
      results.push({ name: 'Parser', status: 'fail', message: 'Parser returned empty IR' });
    }
  } catch (err: any) {
    results.push({ name: 'Parser', status: 'fail', message: `Parser error: ${err.message}` });
  }

  // 5. File watcher
  if (fsWatchers.length > 0) {
    results.push({ name: 'File Watcher', status: 'pass', message: 'File watcher is active' });
  } else if (currentWorkspace) {
    results.push({ name: 'File Watcher', status: 'fail', message: 'File watcher is not running (workspace is open but watcher failed to start)' });
  } else {
    results.push({ name: 'File Watcher', status: 'fail', message: 'No workspace is open — file watcher starts automatically when a workspace is opened' });
  }

  // 6. Settings persistence
  try {
    const theme = settingsStore.get('theme');
    results.push({ name: 'Settings', status: 'pass', message: `Settings store is working (theme: ${theme})` });
  } catch (err: any) {
    results.push({ name: 'Settings', status: 'fail', message: `Settings store error: ${err.message}` });
  }

  const allPassed = results.every(r => r.status === 'pass');
  return { passed: allPassed, results };
});

// --- File Watcher ---

function startFileWatcher(workspacePath: string): void {
  stopFileWatcher();

  const supportedExtensions = [...SUPPORTED_EXTENSIONS];

  // Use Node.js fs.watch for recursive directory watching
  // Replaces chokidar to eliminate the external dependency chain
  try {
    // Debounce map: tracks last event time per file path (scoped, not on globalThis)
    const debounceMap = new Map<string, number>();

    const watcher = fs.watch(workspacePath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      // Skip ignored patterns
      const normalized = filename.replace(/\\/g, '/');
      if (normalized.includes('node_modules/') ||
          normalized.includes('.git/') ||
          normalized.includes('exports/') ||
          normalized.includes('.papyrus/') ||
          normalized.split('/')[0].startsWith('.')) {
        return;
      }

      const ext = path.extname(filename).toLowerCase();
      const fullPath = path.join(workspacePath, filename);

      // Debounce: ignore rapid successive events for the same file
      const now = Date.now();
      const lastTime = debounceMap.get(fullPath) || 0;
      if (now - lastTime < 300) return; // 300ms debounce
      debounceMap.set(fullPath, now);

      if (eventType === 'rename') {
        // 'rename' covers both add and unlink in Node.js fs.watch
        // Check if the file exists to determine which event it is
        fs.access(fullPath, fs.constants.F_OK, (err) => {
          if (err) {
            // File doesn't exist → unlink
            logger.info(`File removed: ${fullPath}`);
            handleFileChange('unlink', fullPath);
          } else {
            // File exists → add
            if (supportedExtensions.includes(ext)) {
              logger.info(`File added: ${fullPath}`);
              handleFileChange('add', fullPath);
            }
          }
        });
      } else if (eventType === 'change') {
        if (supportedExtensions.includes(ext)) {
          logger.info(`File changed: ${fullPath}`);
          handleFileChange('change', fullPath);
        }
      }
    });

    watcher.on('error', (error) => {
      logger.error('File watcher error:', error);
    });

    fsWatchers.push(watcher);
    logger.info(`File watcher started for: ${workspacePath}`);
  } catch (err) {
    logger.error('Failed to start file watcher:', err);
  }
}

async function stopFileWatcher(): Promise<void> {
  for (const w of fsWatchers) {
    try { w.close(); } catch { /* ignore */ }
  }
  fsWatchers = [];
}

function handleFileChange(type: string, filePath: string): void {
  if (!db || !currentWorkspace) return;

  // Re-index the affected file
  const fileRepo = new FileRepository(db.getDb());
  const workspaceRepo = new WorkspaceRepository(db.getDb());

  // Use currentWorkspace to find the correct workspace ID
  let changeWorkspaceId: string | undefined;
  const ws = workspaceRepo.findByPath(currentWorkspace!);
  if (ws) changeWorkspaceId = ws.id;
  if (!changeWorkspaceId) {
    const workspaces = workspaceRepo.getAll();
    if (workspaces.length === 0) return;
    changeWorkspaceId = workspaces[0].id;
  }
  const ext = path.extname(filePath).toLowerCase().replace('.', '');

  if (type === 'add' || type === 'change') {
    if (SUPPORTED_FORMATS_NO_EXT.includes(ext)) {
      try {
        const stat = fs.statSync(filePath);
        // Use size + mtime as a fast change-detection hash
        const hash = `${stat.size}-${Math.floor(stat.mtimeMs)}`;
        const format = ext === 'mermaid' ? 'mmd' : ext === 'tex' ? 'latex' : ext;
        fileRepo.upsert(changeWorkspaceId!, filePath, format, hash, undefined, stat.size, stat.mtimeMs);
        db.markDirty();
      } catch {
        // Skip files we can't read
      }
    }
  } else if (type === 'unlink') {
    fileRepo.deleteByPath(changeWorkspaceId!, filePath);
    db.markDirty();
  }

  // Notify renderer about the change
  mainWindow?.webContents.send('file:changed', { type, path: filePath });
}

// --- Workspace Indexing ---

interface IndexedFile {
  id: string;
  name: string;
  path: string;
  format: string;
  size: number;
  modifiedAt: number;
}

async function indexWorkspace(workspacePath: string): Promise<IndexedFile[]> {
  if (!db) return [];

  const fileRepo = new FileRepository(db.getDb());
  const workspaceRepo = new WorkspaceRepository(db.getDb());

  // Use currentWorkspace to find the correct workspace ID
  let indexWorkspaceId: string | undefined;
  if (currentWorkspace) {
    const ws = workspaceRepo.findByPath(currentWorkspace);
    if (ws) indexWorkspaceId = ws.id;
  }
  if (!indexWorkspaceId) {
    const workspaces = workspaceRepo.getAll();
    if (workspaces.length === 0) return [];
    indexWorkspaceId = workspaces[0].id;
  }
  const indexedFiles: IndexedFile[] = [];
  const errors: string[] = [];

  async function walkDir(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err: any) {
      // If we can't read a directory, log and skip it
      if (err.code === 'EACCES') {
        logger.warn(`Permission denied scanning directory: ${dir}`);
        errors.push(`Skipped (access denied): ${dir}`);
        return;
      }
      if (err.code === 'EBUSY') {
        logger.warn(`Directory locked: ${dir}`);
        errors.push(`Skipped (locked): ${dir}`);
        return;
      }
      logger.error(`Error scanning directory: ${dir}`, err);
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'exports') continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walkDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const extNoDot = ext.replace('.', '');
        if (SUPPORTED_FORMATS_NO_EXT.includes(extNoDot)) {
          try {
            const stat = await fs.promises.stat(fullPath);
            // Use size + mtime as a fast change-detection hash (avoids reading entire file content)
            const hash = `${stat.size}-${Math.floor(stat.mtimeMs)}`;
            const format = extNoDot === 'mermaid' ? 'mmd' : extNoDot === 'tex' ? 'latex' : extNoDot;
            fileRepo.upsert(indexWorkspaceId!, fullPath, format, hash, entry.name, stat.size, stat.mtimeMs);

            indexedFiles.push({
              id: hash,
              name: entry.name,
              path: fullPath,
              format,
              size: stat.size,
              modifiedAt: stat.mtimeMs,
            });
          } catch (err: any) {
            // Individual file errors should not stop the entire index
            if (err.code === 'EACCES') {
              logger.warn(`Permission denied reading file: ${fullPath}`);
              errors.push(`Skipped (access denied): ${entry.name}`);
            } else if (err.code === 'EBUSY') {
              logger.warn(`File locked: ${fullPath}`);
              errors.push(`Skipped (locked): ${entry.name}`);
            } else if (err.code === 'ENOENT') {
              logger.warn(`File disappeared during scan: ${fullPath}`);
            } else {
              logger.error(`Error indexing file ${fullPath}:`, err);
              errors.push(`Skipped (error): ${entry.name} — ${err.message}`);
            }
          }
        }
      }
    }
  }

  await walkDir(workspacePath);
  db.markDirty();

  if (errors.length > 0) {
    logger.warn(`Workspace indexing completed with ${errors.length} warnings: ${errors.join('; ')}`);
  }

  logger.info(`Workspace indexed: ${workspacePath} (${indexedFiles.length} files${errors.length > 0 ? `, ${errors.length} skipped` : ''})`);
  return indexedFiles;
}

// --- Progress helpers ---

function calculateProgress(data: any): number {
  if (data.phase === 'parsing') return 15;
  if (data.phase === 'ir-building') return 30;
  if (data.phase === 'worker-execution') return 60;
  if (data.phase === 'exporting') return 90;
  return data.percentComplete || 0;
}

function calculateWorkerProgress(data: any): number {
  if (!data.result) return 50;
  return data.result.success ? 80 : 60;
}

// --- Crash Logs & App Info ---

ipcMain.handle('app:getCrashLogs', async () => {
  try {
    const files = fs.readdirSync(crashesDir).filter(f => f.endsWith('.dmp'));
    return files.map(f => ({
      name: f,
      path: path.join(crashesDir, f),
      size: fs.statSync(path.join(crashesDir, f)).size,
      createdAt: fs.statSync(path.join(crashesDir, f)).birthtimeMs,
    }));
  } catch {
    return [];
  }
});

ipcMain.handle('app:getInfo', async () => ({
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
}));

// --- Graceful Shutdown ---

function abortAllActiveTasks(): void {
  for (const [taskId, controller] of activeAbortControllers) {
    controller.abort();
    logger.info(`Aborted task during shutdown: ${taskId}`);
  }
  activeAbortControllers.clear();
}

async function gracefulShutdown(): Promise<void> {
  logger.info('Graceful shutdown initiated');

  // 1. Abort all active tasks
  abortAllActiveTasks();

  // 2. Stop file watcher (awaited)
  await stopFileWatcher();

  // 3. Save and close database
  if (db) {
    db.close();
    db = null;
  }

  // 4. Terminate converter worker pool
  if (converterPool) {
    converterPool.terminate();
    converterPool = null;
  }

  currentWorkspace = null;
  exportManager = null;
}

// --- App Lifecycle ---

app.whenReady().then(async () => {
  // Log any pending crash reports from previous sessions
  try {
    const pendingCrashes = fs.readdirSync(crashesDir).filter(f => f.endsWith('.dmp'));
    if (pendingCrashes.length > 0) {
      logger.info(`Found ${pendingCrashes.length} pending crash report(s) in ${crashesDir}`);
    }
  } catch { /* ignore */ }

  await setupCSP();
  createWindow();
});

app.on('window-all-closed', async () => {
  await gracefulShutdown();
  if (process.platform !== 'darwin') app.quit();
});

let isShuttingDown = false;

app.on('before-quit', async (event) => {
  if (isShuttingDown) return;
  // On macOS, before-quit fires before window-all-closed
  if (activeAbortControllers.size > 0 || db || fsWatchers.length > 0) {
    event.preventDefault();
    isShuttingDown = true;
    await gracefulShutdown();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Handle SIGTERM for graceful shutdown in process environments
process.on('SIGTERM', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  await gracefulShutdown();
  process.exit(0);
});
