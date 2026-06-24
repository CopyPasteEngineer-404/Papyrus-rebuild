import { Database } from 'bun:sqlite';
import { generateId } from '../../shared/utils';
import type { TransformationTask, TaskStatus, OutputFormat, ConstraintSet, WorkerResult } from '../../shared/types';

export class TaskRepository {
  private db: Database;
  private stmtCreate: ReturnType<Database['prepare']>;
  private stmtFindById: ReturnType<Database['prepare']>;
  private stmtFindByWorkspace: ReturnType<Database['prepare']>;
  private stmtUpdateStatus: ReturnType<Database['prepare']>;
  private stmtUpdateError: ReturnType<Database['prepare']>;
  private stmtComplete: ReturnType<Database['prepare']>;

  constructor(db: Database) {
    this.db = db;

    this.stmtCreate = db.prepare(
      `INSERT INTO tasks (id, workspace_id, source_files, output_format, constraints, status, progress, results, error, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    this.stmtFindById = db.prepare(
      `SELECT id, workspace_id, source_files, output_format, constraints, status, progress, results, error, created_at, completed_at
       FROM tasks
       WHERE id = ?`
    );

    this.stmtFindByWorkspace = db.prepare(
      `SELECT id, workspace_id, source_files, output_format, constraints, status, progress, results, error, created_at, completed_at
       FROM tasks
       WHERE workspace_id = ?
       ORDER BY created_at DESC`
    );

    this.stmtUpdateStatus = db.prepare(
      `UPDATE tasks SET status = ?, progress = ? WHERE id = ?`
    );

    this.stmtUpdateError = db.prepare(
      `UPDATE tasks SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`
    );

    this.stmtComplete = db.prepare(
      `UPDATE tasks SET status = 'completed', progress = 100, completed_at = ? WHERE id = ?`
    );
  }

  create(record: {
    workspaceId: string;
    sourceFiles: string[];
    outputFormat: OutputFormat;
    constraints?: ConstraintSet;
  }): TransformationTask {
    const id = generateId();
    const now = new Date().toISOString();
    this.stmtCreate.run(
      id,
      record.workspaceId,
      JSON.stringify(record.sourceFiles),
      record.outputFormat,
      record.constraints ? JSON.stringify(record.constraints) : null,
      'pending',
      0,
      JSON.stringify([]),
      null,
      now,
      null
    );
    return {
      id,
      workspaceId: record.workspaceId,
      sourceFiles: record.sourceFiles,
      outputFormat: record.outputFormat,
      constraints: record.constraints,
      status: 'pending',
      progress: 0,
      results: [],
      createdAt: now,
    };
  }

  findById(id: string): TransformationTask | null {
    const row = this.stmtFindById.get(id) as {
      id: string;
      workspace_id: string;
      source_files: string;
      output_format: OutputFormat;
      constraints: string | null;
      status: TaskStatus;
      progress: number;
      results: string;
      error: string | null;
      created_at: string;
      completed_at: string | null;
    } | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  findByWorkspace(workspaceId: string): TransformationTask[] {
    const rows = this.stmtFindByWorkspace.all(workspaceId) as Array<{
      id: string;
      workspace_id: string;
      source_files: string;
      output_format: OutputFormat;
      constraints: string | null;
      status: TaskStatus;
      progress: number;
      results: string;
      error: string | null;
      created_at: string;
      completed_at: string | null;
    }>;
    return rows.map((row) => this.mapRow(row));
  }

  updateStatus(id: string, status: TaskStatus, progress?: number): void {
    if (progress !== undefined) {
      this.stmtUpdateStatus.run(status, progress, id);
    } else {
      this.stmtUpdateStatus.run(status, null, id);
    }
  }

  updateError(id: string, error: string): void {
    const now = new Date().toISOString();
    this.stmtUpdateError.run(error, now, id);
  }

  complete(id: string): void {
    this.stmtComplete.run(new Date().toISOString(), id);
  }

  private mapRow(row: {
    id: string;
    workspace_id: string;
    source_files: string;
    output_format: OutputFormat;
    constraints: string | null;
    status: TaskStatus;
    progress: number;
    results: string;
    error: string | null;
    created_at: string;
    completed_at: string | null;
  }): TransformationTask {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      sourceFiles: JSON.parse(row.source_files) as string[],
      outputFormat: row.output_format,
      constraints: row.constraints ? (JSON.parse(row.constraints) as ConstraintSet) : undefined,
      status: row.status,
      progress: row.progress,
      results: JSON.parse(row.results) as WorkerResult[],
      error: row.error ?? undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    };
  }
}
