import type { SQLiteDatabase } from '../adapter.js';
import { generateId } from '@papyrus/shared';

export interface FileRow {
  id: string;
  workspace_id: string;
  path: string;
  name: string;
  format: string;
  hash: string;
  size: number;
  modified_at: number;
  indexed_at: number;
}

export class FileRepository {
  constructor(private db: SQLiteDatabase) {}

  upsert(
    workspaceId: string,
    filePath: string,
    format: string,
    hash: string,
    name?: string,
    size?: number,
    modifiedAt?: number,
  ): void {
    const derivedName = name || filePath.split(/[\\/]/).pop() || filePath;
    const existing = this.db.prepare(
      'SELECT id FROM files WHERE workspace_id = ? AND path = ?'
    ).get(workspaceId, filePath) as unknown as FileRow | undefined;
    const id = existing?.id || generateId();
    this.db.prepare(
      `INSERT INTO files (id, workspace_id, path, name, format, hash, size, modified_at, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, path) DO UPDATE SET
         name = excluded.name,
         format = excluded.format,
         hash = excluded.hash,
         size = excluded.size,
         modified_at = excluded.modified_at,
         indexed_at = excluded.indexed_at`
    ).run(
      id,
      workspaceId,
      filePath,
      derivedName,
      format,
      hash,
      size ?? 0,
      modifiedAt ?? Date.now(),
      Date.now(),
    );
  }

  findByWorkspace(workspaceId: string): FileRow[] {
    return this.db.prepare(
      'SELECT * FROM files WHERE workspace_id = ? ORDER BY path'
    ).all(workspaceId) as unknown as FileRow[];
  }

  findById(id: string): FileRow | undefined {
    return this.db.prepare('SELECT * FROM files WHERE id = ?').get(id) as unknown as FileRow | undefined;
  }

  deleteByPath(workspaceId: string, filePath: string): void {
    this.db.prepare('DELETE FROM files WHERE workspace_id = ? AND path = ?').run(workspaceId, filePath);
  }

  deleteById(id: string): void {
    this.db.prepare('DELETE FROM files WHERE id = ?').run(id);
  }
}