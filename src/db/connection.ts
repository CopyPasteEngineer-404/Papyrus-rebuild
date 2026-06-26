import Database from 'better-sqlite3';
import fs from 'fs';
import { logger } from '../shared/utils';
import { runMigrations } from './migrations';

export interface DatabaseConnectionOptions {
  dbPath?: string;
}

export class DatabaseConnection {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(options: DatabaseConnectionOptions = {}) {
    this.dbPath = options.dbPath ?? './papyrus.db';
  }

  initialize(): Database.Database {
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

    return this.db;
  }

  getDatabase(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info('Database closed');
    }
  }

  private cleanupStaleFiles(): void {
    const tmpPath = `${this.dbPath}.tmp`;
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
      logger.info('Cleaned up stale temp database file');
    }
  }
}

let globalConnection: DatabaseConnection | null = null;

export function getDatabaseConnection(options?: DatabaseConnectionOptions): DatabaseConnection {
  if (!globalConnection) {
    globalConnection = new DatabaseConnection(options);
    globalConnection.initialize();
  }
  return globalConnection;
}

export function closeDatabaseConnection(): void {
  if (globalConnection) {
    globalConnection.close();
    globalConnection = null;
  }
}
