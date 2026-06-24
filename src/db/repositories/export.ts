import { Database } from 'bun:sqlite';
import { generateId } from '../../shared/utils';
import type { ExportRecord, OutputFormat } from '../../shared/types';

export class ExportRepository {
  private db: Database;
  private stmtCreate: ReturnType<Database['prepare']>;
  private stmtGetRecent: ReturnType<Database['prepare']>;
  private stmtDeleteByTaskId: ReturnType<Database['prepare']>;

  constructor(db: Database) {
    this.db = db;

    this.stmtCreate = db.prepare(
      `INSERT INTO exports (id, task_id, source_path, output_path, format, file_size, duration_ms, worker_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    this.stmtGetRecent = db.prepare(
      `SELECT id, task_id, source_path, output_path, format, file_size, duration_ms, worker_name, created_at
       FROM exports
       ORDER BY created_at DESC
       LIMIT ?`
    );

    this.stmtDeleteByTaskId = db.prepare(
      `DELETE FROM exports WHERE task_id = ?`
    );
  }

  create(record: Omit<ExportRecord, 'id' | 'createdAt'>): ExportRecord {
    const id = generateId();
    const now = new Date().toISOString();
    this.stmtCreate.run(
      id,
      record.taskId,
      record.sourcePath,
      record.outputPath,
      record.format,
      record.fileSize,
      record.durationMs,
      record.workerName,
      now
    );
    return { ...record, id, createdAt: now };
  }

  getRecent(limit: number = 50): ExportRecord[] {
    const rows = this.stmtGetRecent.all(limit) as Array<{
      id: string;
      task_id: string;
      source_path: string;
      output_path: string;
      format: OutputFormat;
      file_size: number;
      duration_ms: number;
      worker_name: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      sourcePath: row.source_path,
      outputPath: row.output_path,
      format: row.format,
      fileSize: row.file_size,
      durationMs: row.duration_ms,
      workerName: row.worker_name,
      createdAt: row.created_at,
    }));
  }

  deleteByTaskId(taskId: string): boolean {
    const result = this.stmtDeleteByTaskId.run(taskId);
    return result.changes > 0;
  }
}
