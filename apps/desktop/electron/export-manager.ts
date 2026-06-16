/**
 * ExportManager — Manages export artifacts, filenames, manifests, and history.
 *
 * Responsibilities:
 * - Save exports to disk
 * - Manage filenames (sanitize, deduplicate)
 * - Manifest generation (with source, worker, duration per the v1 spec)
 * - Export history tracking
 * - Open export location in system file manager
 *
 * Manifest format (v1):
 * {
 *   "taskId": "...",
 *   "createdAt": 1234567890,
 *   "totalSize": 12345,
 *   "exports": [
 *     {
 *       "id": "...",
 *       "source": "path/to/input.md",
 *       "generated": "path/to/exports/output.pdf",
 *       "worker": "pdf",
 *       "format": "pdf",
 *       "duration": 1234,
 *       "fileSize": 5678,
 *       "createdAt": 1234567890
 *     }
 *   ]
 * }
 */

import fs from 'fs';
import path from 'path';
import { logger, generateId, sanitizeFilename } from '@papyrus/shared';
import { ExportRepository, type ExportRow as DBExportRow } from '@papyrus/database';
import type { SQLiteDatabase } from '@papyrus/database';

export interface ExportEntry {
  id: string;
  traceId: string;
  format: string;
  outputPath: string;
  createdAt: number;
  fileSize: number;
  /** Source file path that was transformed */
  sourcePath?: string;
  /** Worker name that generated this export */
  workerName?: string;
  /** Duration in ms the worker took */
  duration?: number;
}

export interface ExportManifest {
  taskId: string;
  createdAt: number;
  totalSize: number;
  exports: ExportEntry[];
}

export class ExportManager {
  private exportDir: string;
  private exportRepo: ExportRepository | null;

  constructor(workspacePath: string, db?: SQLiteDatabase) {
    this.exportDir = path.join(workspacePath, 'exports');
    this.exportRepo = db ? new ExportRepository(db) : null;

    // Ensure export directory exists (sync is acceptable in constructor)
    if (!fs.existsSync(this.exportDir)) {
      fs.mkdirSync(this.exportDir, { recursive: true });
    }
  }

  /** Get the export directory path */
  getExportDir(): string {
    return this.exportDir;
  }

  /** Generate a unique filename to avoid overwriting existing files */
  async generateFilename(baseName: string, extension: string): Promise<string> {
    const sanitized = sanitizeFilename(baseName);
    let filename = `${sanitized}.${extension}`;
    let counter = 1;

    try {
      while (await fs.promises.access(path.join(this.exportDir, filename)).then(() => true).catch(() => false)) {
        filename = `${sanitized}_${counter}.${extension}`;
        counter++;
        if (counter > 1000) {
          filename = `${sanitized}_${Date.now()}.${extension}`;
          break;
        }
      }
    } catch {
      filename = `${sanitized}_${Date.now()}.${extension}`;
    }

    return filename;
  }

  /** Generate the full output path for an export */
  async getOutputPath(baseName: string, extension: string): Promise<string> {
    const filename = await this.generateFilename(baseName, extension);
    return path.join(this.exportDir, filename);
  }

  /** Record an export in the database with enhanced metadata */
  async recordExport(
    traceId: string,
    format: string,
    outputPath: string,
    fileSize: number,
    sourcePath?: string,
    workerName?: string,
    duration?: number,
  ): Promise<ExportEntry> {
    const entry: ExportEntry = {
      id: generateId(),
      traceId,
      format,
      outputPath,
      createdAt: Date.now(),
      fileSize,
      sourcePath,
      workerName,
      duration,
    };

    if (this.exportRepo) {
      try {
        this.exportRepo.create(
          entry.id, traceId, format, outputPath, fileSize,
          sourcePath || '', workerName || '', duration || 0,
        );
      } catch (error) {
        logger.error('Failed to record export in database:', error);
      }
    }

    return entry;
  }

  /** Generate a manifest for a task's exports — includes source, worker, duration */
  generateManifest(
    taskId: string,
    exports: Array<{
      format: string;
      outputPath: string;
      fileSize: number;
      sourcePath?: string;
    }>,
    workerResults?: Array<{
      format: string;
      duration: number;
      success: boolean;
    }>,
  ): ExportManifest {
    const entries: ExportEntry[] = exports.map((exp) => {
      const workerResult = workerResults?.find(w => w.format === exp.format);
      return {
        id: generateId(),
        traceId: taskId,
        format: exp.format,
        outputPath: exp.outputPath,
        createdAt: Date.now(),
        fileSize: exp.fileSize,
        sourcePath: exp.sourcePath,
        workerName: exp.format === 'pdf' ? 'pdf-worker' : exp.format === 'md' ? 'markdown-worker' : `${exp.format}-worker`,
        duration: workerResult?.duration,
      };
    });

    return {
      taskId,
      createdAt: Date.now(),
      totalSize: entries.reduce((sum, e) => sum + e.fileSize, 0),
      exports: entries,
    };
  }

  /** Write manifest file alongside exports */
  async writeManifest(manifest: ExportManifest): Promise<string> {
    const manifestPath = path.join(this.exportDir, `manifest-${manifest.taskId}.json`);
    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    logger.info(`Export manifest written: ${manifestPath}`);
    return manifestPath;
  }

  /** Get recent exports from the database, mapping DB rows to ExportEntry */
  getRecentExports(limit: number = 50): ExportEntry[] {
    if (!this.exportRepo) return [];
    try {
      const rows: DBExportRow[] = this.exportRepo.getRecent(limit);
      return rows.map((row: DBExportRow) => ({
        id: row.id,
        traceId: row.trace_id,
        format: row.format,
        outputPath: row.output_path,
        createdAt: row.created_at,
        fileSize: row.file_size,
        sourcePath: row.source_path,
        workerName: row.worker_name,
        duration: row.duration_ms,
      }));
    } catch {
      return [];
    }
  }

  /** Get total size of all exports */
  async getTotalExportSize(): Promise<number> {
    try {
      const files = await fs.promises.readdir(this.exportDir);
      let totalSize = 0;
      for (const file of files) {
        const filePath = path.join(this.exportDir, file);
        const stat = await fs.promises.stat(filePath);
        if (stat.isFile()) {
          totalSize += stat.size;
        }
      }
      return totalSize;
    } catch {
      return 0;
    }
  }

  /** Read and parse a manifest file */
  async readManifest(taskId: string): Promise<ExportManifest | null> {
    try {
      const manifestPath = path.join(this.exportDir, `manifest-${taskId}.json`);
      const content = await fs.promises.readFile(manifestPath, 'utf-8');
      return JSON.parse(content) as ExportManifest;
    } catch {
      return null;
    }
  }
}
