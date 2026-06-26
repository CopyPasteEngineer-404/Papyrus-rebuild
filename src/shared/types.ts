// ============================================================================
// PAPYRUS v1 — Shared Types
// ============================================================================

// ---------------------------------------------------------------------------
// IR (Intermediate Representation) Types
// ---------------------------------------------------------------------------

export const IR_VERSION = 2;

export interface IRSource {
  file: string;
  lineStart: number;
  lineEnd: number;
}

export interface IRNode {
  id: string;
  type: string;
  source?: IRSource;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// IR Inline Formatting Types
// ---------------------------------------------------------------------------

export interface IRInlineTextNode extends IRNode {
  type: 'inline-text';
  content: string;
}

export interface IRInlineBoldNode extends IRNode {
  type: 'inline-bold';
  children: IRInlineNode[];
}

export interface IRInlineItalicNode extends IRNode {
  type: 'inline-italic';
  children: IRInlineNode[];
}

export interface IRInlineCodeNode extends IRNode {
  type: 'inline-code';
  content: string;
}

export interface IRInlineLinkNode extends IRNode {
  type: 'inline-link';
  href: string;
  children: IRInlineNode[];
}

export interface IRInlineStrikethroughNode extends IRNode {
  type: 'inline-strikethrough';
  children: IRInlineNode[];
}

export type IRInlineNode =
  | IRInlineTextNode
  | IRInlineBoldNode
  | IRInlineItalicNode
  | IRInlineCodeNode
  | IRInlineLinkNode
  | IRInlineStrikethroughNode;

// Type guards for inline nodes
export function isIRInlineText(node: IRInlineNode): node is IRInlineTextNode { return node.type === 'inline-text'; }
export function isIRInlineBold(node: IRInlineNode): node is IRInlineBoldNode { return node.type === 'inline-bold'; }
export function isIRInlineItalic(node: IRInlineNode): node is IRInlineItalicNode { return node.type === 'inline-italic'; }
export function isIRInlineCode(node: IRInlineNode): node is IRInlineCodeNode { return node.type === 'inline-code'; }
export function isIRInlineLink(node: IRInlineNode): node is IRInlineLinkNode { return node.type === 'inline-link'; }
export function isIRInlineStrikethrough(node: IRInlineNode): node is IRInlineStrikethroughNode { return node.type === 'inline-strikethrough'; }

// Utility: flatten inline nodes to plain string
export function flattenInline(nodes: IRInlineNode[]): string {
  return nodes.map(node => {
    switch (node.type) {
      case 'inline-text': return node.content;
      case 'inline-bold': return flattenInline(node.children);
      case 'inline-italic': return flattenInline(node.children);
      case 'inline-code': return node.content;
      case 'inline-link': return flattenInline(node.children);
      case 'inline-strikethrough': return flattenInline(node.children);
      default: return '';
    }
  }).join('');
}

export interface IRDocument extends IRNode {
  type: 'document';
  version: number;
  title: string;
  children: IRBlockNode[];
  frontmatter?: Record<string, unknown>;
  createdAt: string;
}

export interface IRSectionNode extends IRNode {
  type: 'section';
  level: number;
  title: string;
  children: IRBlockNode[];
}

export interface IRParagraphNode extends IRNode {
  type: 'paragraph';
  content: string;
  inline?: IRInlineNode[];
}

export interface IRListNode extends IRNode {
  type: 'list';
  ordered: boolean;
  items: IRListItem[];
}

export interface IRListItem {
  content: string;
  inline?: IRInlineNode[];
  children?: IRBlockNode[];
}

export interface IRTableNode extends IRNode {
  type: 'table';
  headers: string[];
  rows: string[][];
}

export interface IRDiagramNode extends IRNode {
  type: 'diagram';
  content: string;
  engine: 'mermaid' | 'unknown';
}

export interface IRCodeNode extends IRNode {
  type: 'code';
  language: string;
  content: string;
}

export interface IRImageNode extends IRNode {
  type: 'image';
  src: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface IRFrontmatterNode extends IRNode {
  type: 'frontmatter';
  data: Record<string, unknown>;
}

export interface IRPageBreakNode extends IRNode {
  type: 'pageBreak';
}

export interface IRTocNode extends IRNode {
  type: 'toc';
}

export interface IRFootnoteNode extends IRNode {
  type: 'footnote';
  label: string;
  content: string;
}

export interface IRReferenceNode extends IRNode {
  type: 'reference';
  label: string;
  content: string;
}

export interface IRQuoteNode extends IRNode {
  type: 'quote';
  content: string;
  inline?: IRInlineNode[];
  author?: string;
}

export interface IRSlideNode extends IRNode {
  type: 'slide';
  title: string;
  children: IRBlockNode[];
}

export interface IRMathNode extends IRNode {
  type: 'math';
  content: string;
  inline: boolean;
}

export type IRBlockNode =
  | IRSectionNode
  | IRParagraphNode
  | IRListNode
  | IRTableNode
  | IRDiagramNode
  | IRCodeNode
  | IRImageNode
  | IRFrontmatterNode
  | IRPageBreakNode
  | IRTocNode
  | IRFootnoteNode
  | IRReferenceNode
  | IRQuoteNode
  | IRSlideNode
  | IRMathNode;

// Type guards
export function isIRDocument(node: IRNode): node is IRDocument { return node.type === 'document'; }
export function isIRSection(node: IRNode): node is IRSectionNode { return node.type === 'section'; }
export function isIRParagraph(node: IRNode): node is IRParagraphNode { return node.type === 'paragraph'; }
export function isIRList(node: IRNode): node is IRListNode { return node.type === 'list'; }
export function isIRTable(node: IRNode): node is IRTableNode { return node.type === 'table'; }
export function isIRDiagram(node: IRNode): node is IRDiagramNode { return node.type === 'diagram'; }
export function isIRCode(node: IRNode): node is IRCodeNode { return node.type === 'code'; }
export function isIRImage(node: IRNode): node is IRImageNode { return node.type === 'image'; }
export function isIRFrontmatter(node: IRNode): node is IRFrontmatterNode { return node.type === 'frontmatter'; }
export function isIRPageBreak(node: IRNode): node is IRPageBreakNode { return node.type === 'pageBreak'; }
export function isIRToc(node: IRNode): node is IRTocNode { return node.type === 'toc'; }
export function isIRFootnote(node: IRNode): node is IRFootnoteNode { return node.type === 'footnote'; }
export function isIRReference(node: IRNode): node is IRReferenceNode { return node.type === 'reference'; }
export function isIRQuote(node: IRNode): node is IRQuoteNode { return node.type === 'quote'; }
export function isIRSlide(node: IRNode): node is IRSlideNode { return node.type === 'slide'; }
export function isIRMath(node: IRNode): node is IRMathNode { return node.type === 'math'; }

// ---------------------------------------------------------------------------
// Worker / Conversion Types
// ---------------------------------------------------------------------------

export type InputFormat = 'md' | 'csv' | 'txt' | 'mermaid' | 'latex' | 'docx' | 'xlsx' | 'pptx' | 'html' | 'json' | 'yaml' | 'rtf' | 'epub';

export type OutputFormat = 'pdf' | 'md' | 'txt' | 'html' | 'docx' | 'xlsx' | 'pptx' | 'csv' | 'latex' | 'epub';

export interface ParseInput {
  content: string;
  filePath: string;
  options?: ParseOptions;
}

export interface ParseOptions {
  title?: string;
  flavor?: string;
}

export interface WorkerInput {
  ir: IRDocument;
  constraints?: ConstraintSet;
  outputDir: string;
  sourceFile?: string;
}

export interface WorkerResult {
  success: boolean;
  artifacts: GeneratedArtifact[];
  errors: string[];
  warnings: string[];
  duration: number;
}

export interface GeneratedArtifact {
  filename: string;
  data: Uint8Array;
  format: OutputFormat;
  size: number;
}

export interface ConversionResult {
  success: boolean;
  outputPath: string;
  fileSize: number;
  duration: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constraint Types
// ---------------------------------------------------------------------------

export interface PDFConstraints {
  paperSize?: 'a4' | 'letter' | 'legal' | 'a3' | 'a5';
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  fontSize?: number;
  lineHeight?: number;
  includeToc?: boolean;
  darkMode?: boolean;
}

export interface MarkdownConstraints {
  flavor?: 'github' | 'commonmark' | 'gfm';
  includeFrontmatter?: boolean;
  diagramFormat?: 'svg' | 'png';
}

export interface TextConstraints {
  lineWrap?: number;
  preserveFormatting?: boolean;
}

export interface ConstraintSet {
  pdf?: PDFConstraints;
  markdown?: MarkdownConstraints;
  text?: TextConstraints;
}

// ---------------------------------------------------------------------------
// Task Types
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TransformationTask {
  id: string;
  workspaceId: string;
  sourceFiles: string[];
  outputFormat: OutputFormat;
  constraints?: ConstraintSet;
  status: TaskStatus;
  progress: number;
  results: WorkerResult[];
  error?: string;
  createdAt: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Workspace Types
// ---------------------------------------------------------------------------

export interface Workspace {
  id: string;
  path: string;
  name: string;
  createdAt: string;
  lastOpened: string;
}

export interface FileNode {
  id: string;
  workspaceId: string;
  path: string;
  name: string;
  format: InputFormat;
  hash?: string;
  size: number;
  modifiedAt: string;
  indexedAt: string;
}

// ---------------------------------------------------------------------------
// Settings Types
// ---------------------------------------------------------------------------

export interface Settings {
  theme: 'light' | 'dark' | 'system';
  maxWorkers: number;
  defaultFormat: OutputFormat;
  autoSave: boolean;
  lastWorkspace?: string;
}

// ---------------------------------------------------------------------------
// Export Types
// ---------------------------------------------------------------------------

export interface ExportRecord {
  id: string;
  taskId: string;
  sourcePath: string;
  outputPath: string;
  format: OutputFormat;
  fileSize: number;
  durationMs: number;
  workerName: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// CLI Types
// ---------------------------------------------------------------------------

export interface CLIConvertOptions {
  to: OutputFormat;
  output: string;
  workers?: number;
  timeout?: number;
}
