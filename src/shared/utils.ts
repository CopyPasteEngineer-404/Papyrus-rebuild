import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { InputFormat } from './types';
import { INPUT_FORMATS } from './constants';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// UUID Generation
// ---------------------------------------------------------------------------

export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// Filename Utilities
// ---------------------------------------------------------------------------

const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

export function sanitizeFilename(name: string): string {
  let sanitized = name.replace(ILLEGAL_CHARS, '_');
  sanitized = sanitized.replace(/\.+$/g, '');
  if (RESERVED_NAMES.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }
  return sanitized || 'unnamed';
}

// ---------------------------------------------------------------------------
// Format Detection
// ---------------------------------------------------------------------------

export function detectFormat(filePath: string): InputFormat | null {
  const ext = filePath.toLowerCase().split('.').pop();
  if (!ext) return null;

  for (const [format, info] of Object.entries(INPUT_FORMATS)) {
    if (info.extensions.some((e) => e.slice(1) === ext)) {
      return format as InputFormat;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel = LOG_LEVELS['info'];

export function setLogLevel(level: LogLevel): void {
  currentLevel = LOG_LEVELS[level];
}

export class Logger {
  private prefix: string;

  constructor(prefix = 'Papyrus') {
    this.prefix = prefix;
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (LOG_LEVELS[level] < currentLevel) return;
    const timestamp = new Date().toISOString();
    const tag = `[${timestamp}] [${level.toUpperCase()}] [${this.prefix}]`;
    console[level === 'error' ? 'error' : 'log'](`${tag} ${message}`, ...args);
  }

  debug(message: string, ...args: unknown[]): void { this.log('debug', message, ...args); }
  info(message: string, ...args: unknown[]): void { this.log('info', message, ...args); }
  warn(message: string, ...args: unknown[]): void { this.log('warn', message, ...args); }
  error(message: string, ...args: unknown[]): void { this.log('error', message, ...args); }

  child(prefix: string): Logger {
    return new Logger(`${this.prefix}:${prefix}`);
  }
}

export const logger = new Logger();

// ---------------------------------------------------------------------------
// File Size Formatting
// ---------------------------------------------------------------------------

export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1) return `${bytes.toFixed(2)} B`;
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// ---------------------------------------------------------------------------
// Duration Formatting
// ---------------------------------------------------------------------------

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

// ---------------------------------------------------------------------------
// Path Utilities
// ---------------------------------------------------------------------------

export function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  return lastDot === -1 ? '' : filePath.slice(lastDot).toLowerCase();
}

export function getBasename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || '';
}

export function getDirname(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  parts.pop();
  return parts.join('/') || '.';
}
