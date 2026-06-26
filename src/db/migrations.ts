import Database from 'better-sqlite3';
import { logger } from '../shared/utils';

type Migration = {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
};

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          path TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          last_opened TEXT
        );

        CREATE TABLE IF NOT EXISTS files (
          id TEXT PRIMARY KEY,
          workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
          path TEXT NOT NULL,
          name TEXT NOT NULL,
          format TEXT NOT NULL,
          hash TEXT,
          size INTEGER,
          modified_at TEXT,
          indexed_at TEXT,
          UNIQUE(workspace_id, path)
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
          source_files TEXT NOT NULL,
          output_format TEXT NOT NULL,
          constraints TEXT,
          status TEXT DEFAULT 'pending',
          progress REAL DEFAULT 0,
          results TEXT DEFAULT '[]',
          error TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS exports (
          id TEXT PRIMARY KEY,
          task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
          source_path TEXT NOT NULL,
          output_path TEXT NOT NULL,
          format TEXT NOT NULL,
          file_size INTEGER,
          duration_ms INTEGER,
          worker_name TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 2,
    name: 'performance_indexes',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_files_workspace_id ON files(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_files_format ON files(format);
        CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
        CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON tasks(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_exports_task_id ON exports(task_id);
        CREATE INDEX IF NOT EXISTS idx_exports_format ON exports(format);
        CREATE INDEX IF NOT EXISTS idx_exports_created_at ON exports(created_at);
        CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
      `);
    },
  },
  {
    version: 3,
    name: 'composite_indexes',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_files_workspace_path ON files(workspace_id, path);
        CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status ON tasks(workspace_id, status);
        CREATE INDEX IF NOT EXISTS idx_exports_task_format ON exports(task_id, format);
        CREATE INDEX IF NOT EXISTS idx_files_modified_at ON files(modified_at);
        CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
      `);
    },
  },
  {
    version: 4,
    name: 'unique_constraints',
    up(db) {
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_path_unique ON workspaces(path);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key_unique ON settings(key);
      `);
    },
  },
  {
    version: 5,
    name: 'foreign_keys',
    up(db) {
      db.exec(`
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT DEFAULT (datetime('now'))
        );
      `);
    },
  },
];

function getCurrentVersion(db: Database.Database): number {
  try {
    const row = db.prepare(
      "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"
    ).get() as { version: number } | undefined;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}

export function runMigrations(db: Database.Database): void {
  db.exec('PRAGMA foreign_keys = ON');

  const currentVersion = getCurrentVersion(db);
  logger.info(`Current schema version: ${currentVersion}`);

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      logger.info(`Applying migration v${migration.version}: ${migration.name}`);

      const apply = db.transaction(() => {
        migration.up(db);
        db.prepare(
          "INSERT INTO schema_migrations (version, name) VALUES (?, ?)"
        ).run(migration.version, migration.name);
      });

      apply();

      logger.info(`Migration v${migration.version} applied successfully`);
    }
  }

  const finalVersion = getCurrentVersion(db);
  logger.info(`Schema version after migrations: ${finalVersion}`);
}
