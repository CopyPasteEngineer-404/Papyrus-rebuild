import type { InputFormat, OutputFormat, ConstraintSet } from './types';

// ---------------------------------------------------------------------------
// Format Definitions
// ---------------------------------------------------------------------------

export const INPUT_FORMATS: Record<InputFormat, { name: string; extensions: string[]; mimeTypes: string[] }> = {
  md: { name: 'Markdown', extensions: ['.md', '.markdown'], mimeTypes: ['text/markdown'] },
  csv: { name: 'CSV', extensions: ['.csv'], mimeTypes: ['text/csv'] },
  txt: { name: 'Plain Text', extensions: ['.txt', '.text'], mimeTypes: ['text/plain'] },
  mermaid: { name: 'Mermaid', extensions: ['.mmd', '.mermaid'], mimeTypes: ['text/plain'] },
  latex: { name: 'LaTeX', extensions: ['.tex', '.latex'], mimeTypes: ['application/x-latex'] },
  docx: { name: 'Word Document', extensions: ['.docx'], mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  xlsx: { name: 'Excel Spreadsheet', extensions: ['.xlsx'], mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
  pptx: { name: 'PowerPoint Presentation', extensions: ['.pptx'], mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'] },
  html: { name: 'HTML', extensions: ['.html', '.htm'], mimeTypes: ['text/html'] },
  json: { name: 'JSON', extensions: ['.json'], mimeTypes: ['application/json'] },
  yaml: { name: 'YAML', extensions: ['.yaml', '.yml'], mimeTypes: ['text/yaml'] },
  rtf: { name: 'Rich Text Format', extensions: ['.rtf'], mimeTypes: ['application/rtf'] },
  epub: { name: 'EPUB', extensions: ['.epub'], mimeTypes: ['application/epub+zip'] },
};

export const OUTPUT_FORMATS: Record<OutputFormat, { name: string; extension: string; mimeType: string }> = {
  pdf: { name: 'PDF', extension: '.pdf', mimeType: 'application/pdf' },
  md: { name: 'Markdown', extension: '.md', mimeType: 'text/markdown' },
  txt: { name: 'Plain Text', extension: '.txt', mimeType: 'text/plain' },
  html: { name: 'HTML', extension: '.html', mimeType: 'text/html' },
  docx: { name: 'Word Document', extension: '.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { name: 'Excel Spreadsheet', extension: '.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pptx: { name: 'PowerPoint Presentation', extension: '.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  csv: { name: 'CSV', extension: '.csv', mimeType: 'text/csv' },
  latex: { name: 'LaTeX', extension: '.tex', mimeType: 'application/x-latex' },
  epub: { name: 'EPUB', extension: '.epub', mimeType: 'application/epub+zip' },
};

// ---------------------------------------------------------------------------
// Conversion Matrix
// ---------------------------------------------------------------------------

export const CONVERSION_MATRIX: Record<InputFormat, OutputFormat[]> = {
  md: ['pdf', 'md', 'txt', 'html', 'docx', 'xlsx', 'pptx', 'csv', 'latex', 'epub'],
  csv: ['pdf', 'md', 'txt', 'html', 'docx', 'xlsx', 'pptx', 'csv', 'latex', 'epub'],
  txt: ['pdf', 'md', 'txt', 'html', 'docx', 'xlsx', 'pptx', 'csv', 'latex', 'epub'],
  mermaid: ['pdf', 'md', 'txt', 'html', 'docx', 'xlsx', 'pptx', 'csv', 'latex', 'epub'],
  latex: ['pdf', 'md', 'txt', 'html', 'docx', 'xlsx', 'pptx', 'csv', 'latex', 'epub'],
  docx: ['pdf', 'md', 'txt', 'html', 'docx', 'xlsx', 'pptx', 'csv', 'latex', 'epub'],
  xlsx: ['pdf', 'md', 'txt', 'html', 'docx', 'xlsx', 'pptx', 'csv', 'latex', 'epub'],
  pptx: ['pdf', 'md', 'txt', 'html', 'docx', 'xlsx', 'pptx', 'csv', 'latex', 'epub'],
  html: ['pdf', 'md', 'txt', 'html', 'docx', 'xlsx', 'pptx', 'csv', 'latex', 'epub'],
  json: ['pdf', 'md', 'txt', 'html', 'docx', 'xlsx', 'pptx', 'csv', 'latex', 'epub'],
  yaml: ['pdf', 'md', 'txt', 'html', 'docx', 'xlsx', 'pptx', 'csv', 'latex', 'epub'],
  rtf: ['pdf', 'md', 'txt', 'html', 'docx', 'xlsx', 'pptx', 'csv', 'latex', 'epub'],
  epub: ['pdf', 'md', 'txt', 'html', 'docx', 'xlsx', 'pptx', 'csv', 'latex', 'epub'],
};

// ---------------------------------------------------------------------------
// Default Constraints
// ---------------------------------------------------------------------------

export const DEFAULT_CONSTRAINTS: ConstraintSet = {
  pdf: {
    paperSize: 'a4',
    marginTop: 72,
    marginBottom: 72,
    marginLeft: 72,
    marginRight: 72,
    fontSize: 12,
    lineHeight: 1.5,
    includeToc: false,
    darkMode: false,
  },
  markdown: {
    flavor: 'github',
    includeFrontmatter: true,
    diagramFormat: 'svg',
  },
  text: {
    lineWrap: 80,
    preserveFormatting: false,
  },
};

// ---------------------------------------------------------------------------
// Application Constants
// ---------------------------------------------------------------------------

export const APP_NAME = 'Papyrus';
export const APP_VERSION = '1.0.0';
export const DB_FILENAME = 'papyrus.db';
export const MAX_WORKERS_DEFAULT = 4;
export const WORKER_TIMEOUT_MS = 60_000;
export const RETRY_ATTEMPTS = 2;
