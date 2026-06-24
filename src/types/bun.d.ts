declare module 'bun:sqlite' {
  export class Database {
    constructor(path: string);
    exec(sql: string): void;
    query<T>(sql: string): { get(...params: unknown[]): T | undefined; all(...params: unknown[]): T[]; run(...params: unknown[]): { changes: number; lastInsertRowid: number } };
    prepare(sql: string): { run(...params: unknown[]): { changes: number; lastInsertRowid: number }; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
    transaction<T extends (...args: any[]) => any>(fn: T): T;
    close(): void;
  }
}
