import { z } from 'zod';

// ---------------------------------------------------------------------------
// IR Schemas
// ---------------------------------------------------------------------------

export const IRSourceSchema = z.object({
  file: z.string(),
  lineStart: z.number(),
  lineEnd: z.number(),
});

export const IRNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  source: IRSourceSchema.optional(),
  meta: z.record(z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// Format Schemas
// ---------------------------------------------------------------------------

export const InputFormatSchema = z.enum([
  'md', 'csv', 'txt', 'mermaid', 'latex', 'docx', 'xlsx', 'pptx', 'html', 'json', 'yaml', 'rtf', 'epub',
]);

export const OutputFormatSchema = z.enum([
  'pdf', 'md', 'txt', 'html', 'docx', 'xlsx', 'pptx', 'csv', 'latex', 'epub',
]);

// ---------------------------------------------------------------------------
// Constraint Schemas
// ---------------------------------------------------------------------------

export const PDFConstraintsSchema = z.object({
  paperSize: z.enum(['a4', 'letter', 'legal', 'a3', 'a5']).optional(),
  marginTop: z.number().optional(),
  marginBottom: z.number().optional(),
  marginLeft: z.number().optional(),
  marginRight: z.number().optional(),
  fontSize: z.number().optional(),
  lineHeight: z.number().optional(),
  includeToc: z.boolean().optional(),
  darkMode: z.boolean().optional(),
});

export const MarkdownConstraintsSchema = z.object({
  flavor: z.enum(['github', 'commonmark', 'gfm']).optional(),
  includeFrontmatter: z.boolean().optional(),
  diagramFormat: z.enum(['svg', 'png']).optional(),
});

export const TextConstraintsSchema = z.object({
  lineWrap: z.number().optional(),
  preserveFormatting: z.boolean().optional(),
});

export const ConstraintSetSchema = z.object({
  pdf: PDFConstraintsSchema.optional(),
  markdown: MarkdownConstraintsSchema.optional(),
  text: TextConstraintsSchema.optional(),
});

// ---------------------------------------------------------------------------
// Task Schemas
// ---------------------------------------------------------------------------

export const TaskStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']);

export const TransformationTaskSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  sourceFiles: z.array(z.string()),
  outputFormat: OutputFormatSchema,
  constraints: ConstraintSetSchema.optional(),
  status: TaskStatusSchema,
  progress: z.number(),
  results: z.array(z.any()),
  error: z.string().optional(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Workspace Schemas
// ---------------------------------------------------------------------------

export const WorkspaceSchema = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastOpened: z.string(),
});

export const FileNodeSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  path: z.string(),
  name: z.string(),
  format: InputFormatSchema,
  hash: z.string().optional(),
  size: z.number(),
  modifiedAt: z.string(),
  indexedAt: z.string(),
});

// ---------------------------------------------------------------------------
// Settings Schemas
// ---------------------------------------------------------------------------

export const SettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  maxWorkers: z.number(),
  defaultFormat: OutputFormatSchema,
  autoSave: z.boolean(),
  lastWorkspace: z.string().optional(),
});

// ---------------------------------------------------------------------------
// CLI Schemas
// ---------------------------------------------------------------------------

export const CLIConvertOptionsSchema = z.object({
  to: z.string(),
  output: z.string(),
  workers: z.number().optional(),
  timeout: z.number().optional(),
});
