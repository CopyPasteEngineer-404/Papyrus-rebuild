import Database from 'better-sqlite3';
import { generateId } from '../../shared/utils';
import type { Workspace } from '../../shared/types';

export class WorkspaceRepository {
  private db: Database.Database;
  private stmtCreate: Database.Statement;
  private stmtFindByPath: Database.Statement;
  private stmtGetAll: Database.Statement;
  private stmtUpdateLastOpened: Database.Statement;
  private stmtDeleteById: Database.Statement;
  private stmtDeleteFilesByWorkspace: Database.Statement;
  private stmtDeleteTasksByWorkspace: Database.Statement;
  private stmtDeleteExportsByTask: Database.Statement;
  private stmtGetTaskIds: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;

    this.stmtCreate = db.prepare(
      `INSERT INTO workspaces (id, path, name, created_at, last_opened)
       VALUES (?, ?, ?, ?, ?)`
    );

    this.stmtFindByPath = db.prepare(
      `SELECT id, path, name, created_at, last_opened
       FROM workspaces
       WHERE path = ?`
    );

    this.stmtGetAll = db.prepare(
      `SELECT id, path, name, created_at, last_opened
       FROM workspaces
       ORDER BY last_opened DESC`
    );

    this.stmtUpdateLastOpened = db.prepare(
      `UPDATE workspaces SET last_opened = ? WHERE id = ?`
    );

    this.stmtDeleteById = db.prepare(
      `DELETE FROM workspaces WHERE id = ?`
    );

    this.stmtDeleteFilesByWorkspace = db.prepare(
      `DELETE FROM files WHERE workspace_id = ?`
    );

    this.stmtDeleteTasksByWorkspace = db.prepare(
      `DELETE FROM tasks WHERE workspace_id = ?`
    );

    this.stmtGetTaskIds = db.prepare(
      `SELECT id FROM tasks WHERE workspace_id = ?`
    );

    this.stmtDeleteExportsByTask = db.prepare(
      `DELETE FROM exports WHERE task_id = ?`
    );
  }

  create(path: string, name: string): Workspace {
    const id = generateId();
    const now = new Date().toISOString();
    this.stmtCreate.run(id, path, name, now, now);
    return { id, path, name, createdAt: now, lastOpened: now };
  }

  findByPath(path: string): Workspace | null {
    const row = this.stmtFindByPath.get(path) as {
      id: string;
      path: string;
      name: string;
      created_at: string;
      last_opened: string;
    } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      path: row.path,
      name: row.name,
      createdAt: row.created_at,
      lastOpened: row.last_opened,
    };
  }

  getAll(): Workspace[] {
    const rows = this.stmtGetAll.all() as Array<{
      id: string;
      path: string;
      name: string;
      created_at: string;
      last_opened: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      name: row.name,
      createdAt: row.created_at,
      lastOpened: row.last_opened,
    }));
  }

  updateLastOpened(id: string): void {
    this.stmtUpdateLastOpened.run(new Date().toISOString(), id);
  }

  deleteById(id: string): void {
    const deleteExports = this.db.transaction((taskIds: string[]) => {
      for (const taskId of taskIds) {
        this.stmtDeleteExportsByTask.run(taskId);
      }
    });

    const cascade = this.db.transaction((wsId: string) => {
      const taskRows = this.stmtGetTaskIds.all(wsId) as Array<{ id: string }>;
      const taskIds = taskRows.map((r) => r.id);
      if (taskIds.length > 0) {
        deleteExports(taskIds);
      }
      this.stmtDeleteTasksByWorkspace.run(wsId);
      this.stmtDeleteFilesByWorkspace.run(wsId);
      this.stmtDeleteById.run(wsId);
    });

    cascade(id);
  }
}
