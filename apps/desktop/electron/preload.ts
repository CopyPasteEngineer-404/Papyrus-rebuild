import { contextBridge, ipcRenderer } from 'electron';
import { WorkspaceOpenSchema, SearchQuerySchema, TaskCreateSchema, TaskCancelSchema, ExportOpenSchema, SettingsUpdateSchema, ConvertFileSchema } from '@papyrus/shared';

export interface ElectronAPI {
  openWorkspace: (path: string) => Promise<any>;
  closeWorkspace: () => Promise<void>;
  deleteWorkspace: (path: string) => Promise<{ success: boolean; path: string }>;
  reindexWorkspace: () => Promise<any>;
  getWorkspaceInfo: () => Promise<any[]>;
  getRecentWorkspaces: () => Promise<Array<{ path: string; name: string; lastOpened: number }>>;
  removeRecentWorkspace: (path: string) => Promise<boolean>;

  search: (query: string, filters?: any) => Promise<any[]>;

  createTask: (sourceFiles: string[], outputFormats: string[], constraints: any) => Promise<any>;
  cancelTask: (taskId: string) => Promise<void>;
  getTaskHistory: () => Promise<any[]>;

  convertFile: (sourceFilePath: string, targetFormat: string, htmlOptions?: {
    darkMode?: boolean;
    textColor?: string;
    headingColor?: string;
    fontSize?: number;
    includeMermaid?: boolean;
  }) => Promise<{
    success: boolean;
    outputPath: string;
    targetFormat: string;
    fileSize: number;
    duration: number;
    error?: string;
  }> | Promise<any>;

  getExports: () => Promise<any[]>;
  openExport: (path: string) => Promise<void>;
  showExportInFolder: (path: string) => Promise<void>;

  readFileContent: (filePath: string) => Promise<string>;
  writeFileContent: (filePath: string, content: string) => Promise<void>;

  /* New workspace operations */
  newWorkspace: () => Promise<any>;
  importFiles: () => Promise<Array<{ name: string; path: string; success: boolean; error?: string }>>;
  importFolder: () => Promise<Array<{ name: string; path: string; success: boolean; error?: string }>>;
  openSampleWorkspace: () => Promise<any>;

  getSettings: () => Promise<any>;
  updateSettings: (settings: any) => Promise<void>;

  on: (channel: string, callback: (...args: any[]) => void) => void;
  removeListener: (channel: string, callback: (...args: any[]) => void) => void;

  /* Window controls */
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;

  /* File watcher */
  onFileChanged: (callback: (event: { type: string; path: string }) => void) => () => void;

  /* Settings persistence */
  getStoredSetting: (key: string) => Promise<any>;
  setStoredSetting: (key: string, value: any) => Promise<void>;

  /* Diagnostics */
  runSmokeTest: () => Promise<{ passed: boolean; results: Array<{ name: string; status: 'pass' | 'fail'; message: string }> }>;
}

const validChannels = [
  'task:progress', 'task:completed', 'task:failed', 'task:cancelled',
  'export:created', 'workspace:indexed', 'workspace:indexing',
  'workspace:deleted', 'file:changed',
];

/** Format a Zod error into a readable message */
function formatZodError(error: any): string {
  return error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

/**
 * Listener maps: track the mapping from user callback → wrapped handler
 * per channel, so removeListener and onFileChanged don't collide.
 */
const listenerMap = new Map<string, Map<(...args: any[]) => void, (_event: any, ...args: any[]) => void>>();

function getChannelMap(channel: string): Map<(...args: any[]) => void, (_event: any, ...args: any[]) => void> {
  if (!listenerMap.has(channel)) {
    listenerMap.set(channel, new Map());
  }
  return listenerMap.get(channel)!;
}

const api: ElectronAPI = {
  openWorkspace: (workspacePath) => {
    const parsed = WorkspaceOpenSchema.safeParse({ path: workspacePath || '' });
    if (!parsed.success) {
      return Promise.reject(new Error(`Invalid workspace path: ${formatZodError(parsed.error)}`));
    }
    return ipcRenderer.invoke('workspace:open', parsed.data);
  },

  closeWorkspace: () => ipcRenderer.invoke('workspace:close'),
  deleteWorkspace: (wsPath: string) => ipcRenderer.invoke('workspace:delete', { path: wsPath }),
  reindexWorkspace: () => ipcRenderer.invoke('workspace:reindex'),
  getWorkspaceInfo: () => ipcRenderer.invoke('workspace:getInfo'),
  getRecentWorkspaces: () => ipcRenderer.invoke('workspace:getRecent'),
  removeRecentWorkspace: (wsPath: string) => ipcRenderer.invoke('workspace:removeRecent', { path: wsPath }),

  search: (query, filters) => {
    const parsed = SearchQuerySchema.safeParse({ query, filters });
    if (!parsed.success) {
      return Promise.reject(new Error(`Invalid search query: ${formatZodError(parsed.error)}`));
    }
    return ipcRenderer.invoke('search:query', parsed.data);
  },

  createTask: (sourceFiles, outputFormats, constraints) => {
    const parsed = TaskCreateSchema.safeParse({ sourceFiles, outputFormats, constraints });
    if (!parsed.success) {
      return Promise.reject(new Error(`Invalid task payload: ${formatZodError(parsed.error)}`));
    }
    return ipcRenderer.invoke('task:create', parsed.data);
  },

  cancelTask: (taskId) => {
    const parsed = TaskCancelSchema.safeParse({ taskId });
    if (!parsed.success) {
      return Promise.reject(new Error(`Invalid task ID: ${formatZodError(parsed.error)}`));
    }
    return ipcRenderer.invoke('task:cancel', parsed.data);
  },

  getTaskHistory: () => ipcRenderer.invoke('task:getHistory'),

  convertFile: (sourceFilePath: string, targetFormat: string, htmlOptions?: any) => {
    const parsed = ConvertFileSchema.safeParse({ sourceFilePath, targetFormat, htmlOptions });
    if (!parsed.success) {
      return Promise.reject(new Error(`Invalid conversion payload: ${formatZodError(parsed.error)}`));
    }
    return ipcRenderer.invoke('convert:file', parsed.data);
  },

  convertBatch: (files: Array<{ sourceFilePath: string; targetFormat: string }>, htmlOptions?: any, taskId?: string) => {
    if (!Array.isArray(files) || files.length === 0) {
      return Promise.reject(new Error('No files provided for batch conversion'));
    }
    return ipcRenderer.invoke('convert:batch', { files, htmlOptions, taskId });
  },

  getExports: () => ipcRenderer.invoke('export:getAll'),
  openExport: (exportPath) => {
    const parsed = ExportOpenSchema.safeParse({ outputPath: exportPath });
    if (!parsed.success) {
      return Promise.reject(new Error(`Invalid export path: ${formatZodError(parsed.error)}`));
    }
    return ipcRenderer.invoke('export:open', parsed.data);
  },
  showExportInFolder: (exportPath) => {
    const parsed = ExportOpenSchema.safeParse({ outputPath: exportPath });
    if (!parsed.success) {
      return Promise.reject(new Error(`Invalid export path: ${formatZodError(parsed.error)}`));
    }
    return ipcRenderer.invoke('export:showInFolder', parsed.data);
  },

  readFileContent: (filePath: string) => {
    if (!filePath || typeof filePath !== 'string' || filePath.length === 0) {
      return Promise.reject(new Error('Invalid file path: filePath is required'));
    }
    return ipcRenderer.invoke('file:readContent', { filePath });
  },
  writeFileContent: (filePath: string, content: string) => {
    if (!filePath || typeof filePath !== 'string' || filePath.length === 0) {
      return Promise.reject(new Error('Invalid file path: filePath is required'));
    }
    if (typeof content !== 'string') {
      return Promise.reject(new Error('Invalid content: content must be a string'));
    }
    return ipcRenderer.invoke('file:writeContent', { filePath, content });
  },

  /* New workspace operations */
  newWorkspace: () => ipcRenderer.invoke('workspace:new'),
  importFiles: () => ipcRenderer.invoke('workspace:importFiles'),
  importFolder: () => ipcRenderer.invoke('workspace:importFolder'),
  openSampleWorkspace: () => ipcRenderer.invoke('workspace:openSample'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => {
    const parsed = SettingsUpdateSchema.safeParse(settings);
    if (!parsed.success) {
      return Promise.reject(new Error(`Invalid settings: ${formatZodError(parsed.error)}`));
    }
    return ipcRenderer.invoke('settings:update', parsed.data);
  },

  on: (channel, callback) => {
    if (validChannels.includes(channel)) {
      const handler = (_event: any, ...args: any[]) => callback(...args);
      getChannelMap(channel).set(callback, handler);
      ipcRenderer.on(channel, handler);
    }
  },
  removeListener: (channel, callback) => {
    if (validChannels.includes(channel)) {
      const channelMap = getChannelMap(channel);
      const handler = channelMap.get(callback);
      if (handler) {
        ipcRenderer.removeListener(channel, handler);
        channelMap.delete(callback);
      }
    }
  },

  /* Window controls */
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  /* File watcher */
  onFileChanged: (callback) => {
    const handler = (_event: any, data: any) => callback(data);
    getChannelMap('file:changed').set(callback, handler);
    ipcRenderer.on('file:changed', handler);
    return () => {
      ipcRenderer.removeListener('file:changed', handler);
      getChannelMap('file:changed').delete(callback);
    };
  },

  /* Settings persistence */
  getStoredSetting: (key: string) => ipcRenderer.invoke('settings:getKey', key),
  setStoredSetting: (key: string, value: any) => ipcRenderer.invoke('settings:setKey', { key, value }),

  /* Diagnostics */
  runSmokeTest: () => ipcRenderer.invoke('diagnostics:smokeTest'),

  /* Crash logs & app info */
  getCrashLogs: () => ipcRenderer.invoke('app:getCrashLogs'),
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
};

contextBridge.exposeInMainWorld('papyrus', api);
