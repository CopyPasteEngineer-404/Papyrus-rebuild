import { Database } from 'bun:sqlite';
import { generateId } from '../../shared/utils';
import type { FileNode, InputFormat } from '../../shared/types';

export class FileRepository {
  private db: Database;
  private stmtUpsert: ReturnType<Database['prepare']>;
  private stmtFindByWorkspace: ReturnType<Database['prepare']>;
  private stmtFindById: ReturnType<Database['prepare']>;
  private stmtDeleteByPath: ReturnType<Database['prepare']>;
  private stmtDeleteById: ReturnType<Database['prepare']>;

  constructor(db: Database) {
    this.db = db;

    this.stmtUpsert = db.prepare(
      `INSERT INTO files (id, workspace_id, path, name, format, hash, size, modified_at, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, path) DO UPDATE SET
         name = excluded.name,
         format = excluded.format,
         hash = excluded.hash,
         size = excluded.size,
         modified_at = excluded.modified_at,
         indexed_at = excluded.indexed_at`
    );

    this.stmtFindByWorkspace = db.prepare(
      `SELECT id, workspace_id, path, name, format, hash, size, modified_at, indexed_at
       FROM files
       WHERE workspace_id = ?
       ORDER BY path`
    );

    this.stmtFindById = db.prepare(
      `SELECT id, workspace_id, path, name, format, hash, size, modified_at, indexed_at
       FROM files
       WHERE id = ?`
    );

    this.stmtDeleteByPath = db.prepare(
      `DELETE FROM files WHERE workspace_id = ? AND path = ?`
    );

    this.stmtDeleteById = db.prepare(
      `DELETE FROM files WHERE id = ?`
    );
  }

  upsert(record: Omit<FileNode, 'id' | 'indexedAt'>): FileNode {
    const now = new Date().toISOString();
    const id = generateId();
    this.stmtUpsert.run(
      id,
      record.workspaceId,
      record.path,
      record.name,
      record.format,
      record.hash ?? null,
      record.size,
      record.modifiedAt,
      now
    );
    return { ...record, id, indexedAt: now };
  }

  findByWorkspace(workspaceId: string): FileNode[] {
    const rows = this.stmtFindByWorkspace.all(workspaceId) as Array<{
      id: string;
      workspace_id: string;
      path: string;
      name: string;
      format: InputFormat;
      hash: string | null;
      size: number;
      modified_at: string;
      indexed_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      path: row.path,
      name: row.name,
      format: row.format,
      hash: row.hash ?? undefined,
      size: row.size,
      modifiedAt: row.modified_at,
      indexedAt: row.indexed_at,
    }));
  }

  findById(id: string): FileNode | null {
    const row = this.stmtFindById.get(id) as {
      id: string;
      workspace_id: string;
      path: string;
      name: string;
      format: InputFormat;
      hash: string | null;
      size: number;
      modified_at: string;
      indexed_at: string;
    } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      path: row.path,
      name: row.name,
      format: row.format,
      hash: row.hash ?? undefined,
      size: row.size,
      modifiedAt: row.modified_at,
      indexedAt: row.indexed_at,
    };
  }

  deleteByPath(workspaceId: string, path: string): boolean {
    const result = this.stmtDeleteByPath.run(workspaceId, path);
    return result.changes > 0;
  }

  deleteById(id: string): boolean {
    const result = this.stmtDeleteById.run(id);
    return result.changes > 0;
  }
}
