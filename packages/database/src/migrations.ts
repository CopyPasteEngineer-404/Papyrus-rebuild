import path from 'path';
import fs from 'fs';
import type { SQLiteDatabase } from './adapter';
import { logger } from '@papyrus/shared';

export interface Migration {
  version: number;
  /** Human-readable description */
  description: string;
  /** Individual SQL statements — each runs in its own try/catch for better diagnostics */
  steps: string[];
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Create initial schema: workspaces, files, embeddings, traces, exports',
    steps: [
      `CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_opened INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        path TEXT NOT NULL,
        format TEXT NOT NULL,
        hash TEXT NOT NULL,
        indexed_at INTEGER NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        chunk TEXT NOT NULL,
        vector BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS exports (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        format TEXT NOT NULL,
        output_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        file_size INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_files_workspace ON files(workspace_id)`,
      `CREATE INDEX IF NOT EXISTS idx_files_format ON files(format)`,
      `CREATE INDEX IF NOT EXISTS idx_embeddings_file ON embeddings(file_id)`,
      `CREATE INDEX IF NOT EXISTS idx_traces_workspace ON traces(workspace_id)`,
      `CREATE INDEX IF NOT EXISTS idx_exports_trace ON exports(trace_id)`,
    ],
  },
  {
    version: 2,
    description: 'Add source_path, worker_name, duration_ms to exports',
    steps: [
      `ALTER TABLE exports ADD COLUMN source_path TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE exports ADD COLUMN worker_name TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE exports ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    version: 3,
    description: 'Add name and size columns to files for display without re-reading disk',
    steps: [
      `ALTER TABLE files ADD COLUMN name TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE files ADD COLUMN size INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE files ADD COLUMN modified_at INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    version: 4,
    description: 'Add composite index for fast workspace+path lookups and trace workspace lookups',
    steps: [
      `CREATE INDEX IF NOT EXISTS idx_files_workspace_path ON files(workspace_id, path)`,
      `CREATE INDEX IF NOT EXISTS idx_traces_workspace_created ON traces(workspace_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_exports_trace_format ON exports(trace_id, format)`,
    ],
  },
  {
    version: 5,
    description: 'Add unique constraint on files(workspace_id, path) to prevent duplicate rows',
    steps: [
      `DROP INDEX IF EXISTS idx_files_workspace_path`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_files_workspace_path_unique ON files(workspace_id, path)`,
    ],
  },
];

/** Get the current schema version from the database */
export function getSchemaVersion(db: SQLiteDatabase): number {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    const row = db.prepare('SELECT MAX(version) as v FROM _migrations').get() as unknown as Record<string, number> | undefined;
    return row?.v || 0;
  } catch {
    return 0;
  }
}

/** Backup the database file before running migrations */
function backupDatabase(dbPath: string): string | null {
  try {
    if (!fs.existsSync(dbPath)) return null;
    const backupPath = `${dbPath}.pre-migration.${Date.now()}`;
    fs.copyFileSync(dbPath, backupPath);
    logger.info(`Database backed up to ${backupPath}`);
    return backupPath;
  } catch (err) {
    logger.warn('Failed to backup database before migration:', err);
    return null;
  }
}

/**
 * Run all pending migrations in order.
 *
 * Improvements over the original:
 * 1. Backs up the database file before applying any migrations
 * 2. Each SQL step runs in its own try/catch for better error diagnostics
 * 3. Exports getSchemaVersion() for runtime schema introspection
 * 4. Descriptive migration metadata for logging
 */
export function runMigrations(db: SQLiteDatabase, dbPath?: string): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const currentVersion = db.prepare('SELECT MAX(version) as v FROM _migrations').get() as unknown as Record<string, number> | undefined;
  const appliedVersion = currentVersion?.v || 0;

  const pending = MIGRATIONS.filter(m => m.version > appliedVersion);
  if (pending.length === 0) return;

  logger.info(`Running ${pending.length} pending migration(s) from v${appliedVersion} to v${appliedVersion + pending.length}`);

  // Backup before applying any migrations
  if (dbPath) {
    const backupPath = backupDatabase(dbPath);
    if (!backupPath) {
      logger.warn('Proceeding without backup — database may be unrecoverable if migration fails');
    }
  }

  for (const migration of pending) {
    try {
      db.exec('BEGIN');

      for (let i = 0; i < migration.steps.length; i++) {
        const step = migration.steps[i];
        try {
          db.exec(step);
        } catch (stepErr) {
          db.exec('ROLLBACK');
          const msg = `Migration v${migration.version} step ${i + 1}/${migration.steps.length} failed: ${stepErr instanceof Error ? stepErr.message : String(stepErr)}`;
          logger.error(msg);
          logger.error(`  SQL: ${step.substring(0, 200)}...`);
          throw new Error(msg);
        }
      }

      db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(migration.version, Date.now());
      db.exec('COMMIT');
      logger.info(`Migration v${migration.version} applied: ${migration.description}`);
    } catch (error) {
      // ROLLBACK may fail if BEGIN failed, so wrap in try/catch
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw new Error(
        `Migration v${migration.version} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
