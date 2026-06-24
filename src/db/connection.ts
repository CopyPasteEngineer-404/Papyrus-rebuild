import { Database } from 'bun:sqlite';
import { logger } from '../shared/utils';
import { runMigrations } from './migrations';

export interface DatabaseConnectionOptions {
  dbPath?: string;
  autoSaveInterval?: number;
}

export class DatabaseConnection {
  private db: Database | null = null;
  private dbPath: string;
  private autoSaveInterval: number;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

  constructor(options: DatabaseConnectionOptions = {}) {
    this.dbPath = options.dbPath ?? './papyrus.db';
    this.autoSaveInterval = options.autoSaveInterval ?? 30_000;
  }

  async initialize(): Promise<Database> {
    if (this.db) {
      return this.db;
    }

    this.cleanupStaleFiles();

    logger.info(`Opening database at ${this.dbPath}`);

    this.db = new Database(this.dbPath);

    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA foreign_keys = ON');

    runMigrations(this.db);

    this.startAutoSave();

    return this.db;
  }

  getDatabase(): Database {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  markDirty(): void {
    this.dirty = true;
  }

  async close(): Promise<void> {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    if (this.db) {
      if (this.dirty) {
        this.flushToDisk();
      }
      this.db.close();
      this.db = null;
      logger.info('Database closed');
    }
  }

  private flushToDisk(): void {
    if (!this.db) return;

    const tmpPath = `${this.dbPath}.tmp`;

    try {
      this.db.exec(`VACUUM INTO '${tmpPath}'`);
      this.dirty = false;
      logger.debug('Database flushed to disk');
    } catch (err) {
      logger.error('Failed to flush database', err);
      try {
        const fs = require('fs');
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {
        // best-effort cleanup
      }
    }
  }

  private startAutoSave(): void {
    this.autoSaveTimer = setInterval(() => {
      if (this.dirty) {
        this.flushToDisk();
      }
    }, this.autoSaveInterval);
  }

  private cleanupStaleFiles(): void {
    try {
      const fs = require('fs');
      const tmpPath = `${this.dbPath}.tmp`;
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
        logger.info('Cleaned up stale temp database file');
      }
    } catch {
      // ignore cleanup errors
    }
  }
}

let globalConnection: DatabaseConnection | null = null;

export async function getDatabaseConnection(options?: DatabaseConnectionOptions): Promise<DatabaseConnection> {
  if (!globalConnection) {
    globalConnection = new DatabaseConnection(options);
    await globalConnection.initialize();
  }
  return globalConnection;
}

export async function closeDatabaseConnection(): Promise<void> {
  if (globalConnection) {
    await globalConnection.close();
    globalConnection = null;
  }
}
