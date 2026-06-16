/**
 * Converter — Direct file format conversion (bypasses the full IR pipeline).
 *
 * Unlike the pipeline (Source → Parser → IR → Workers → Export), the converter
 * performs simpler, direct transformations that preserve content while changing
 * the representation format. This is ideal for "Save As..." style operations.
 *
 * Supported conversions:
 *   md  → txt   Strip markdown syntax, produce clean plain text
 *   md  → html  Convert markdown to proper HTML with tables, code, mermaid
 *   csv → txt   Format CSV as aligned plain-text table
 *   csv → md    Format CSV as a Markdown table
 *   csv → html  Format CSV as an HTML table
 *   txt → md    Wrap paragraphs with markdown conventions
 *   txt → html  Convert plain text to HTML
 *   mermaid → html  Render mermaid diagram in HTML with mermaid.js
 */

import fs from 'fs';
import path from 'path';
import { deflateSync } from 'zlib';
import { execFileSync } from 'child_process';
import mammoth from 'mammoth';
import PDFDocument from 'pdfkit';
import * as fontkit from 'fontkit';
import { logger, sanitizeFilename, getUniqueFilename } from '@papyrus/shared';
import { parseCSVRows } from '@papyrus/parsers';

// Configure pdfkit font data path for Electron bundled app
function getPdfkitFontDataPath(): string {
  const candidates = [
    path.join(__dirname, 'data'),
    path.join(__dirname, '..', 'data'),
    path.join(__dirname, '..', '..', '..', 'apps', 'desktop', 'dist', 'electron', 'data'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return path.join(__dirname, '..', 'node_modules', 'pdfkit', 'js', 'data');
}

// Register custom fonts with pdfkit using fontkit
function registerPdfkitFonts(doc: PDFKit.PDFDocument): void {
  const fontDataPath = getPdfkitFontDataPath();
  if (!fs.existsSync(fontDataPath)) return;

  const fontFiles = [
    { name: 'Helvetica', file: 'Helvetica.afm' },
    { name: 'Helvetica-Bold', file: 'Helvetica-Bold.afm' },
    { name: 'Helvetica-Oblique', file: 'Helvetica-Oblique.afm' },
    { name: 'Helvetica-BoldOblique', file: 'Helvetica-BoldOblique.afm' },
    { name: 'Times-Roman', file: 'Times-Roman.afm' },
    { name: 'Times-Bold', file: 'Times-Bold.afm' },
    { name: 'Times-Italic', file: 'Times-Italic.afm' },
    { name: 'Times-BoldItalic', file: 'Times-BoldItalic.afm' },
    { name: 'Courier', file: 'Courier.afm' },
    { name: 'Courier-Bold', file: 'Courier-Bold.afm' },
    { name: 'Courier-Oblique', file: 'Courier-Oblique.afm' },
    { name: 'Courier-BoldOblique', file: 'Courier-BoldOblique.afm' },
  ];

  for (const { name, file } of fontFiles) {
    const fontPath = path.join(fontDataPath, file);
    if (fs.existsSync(fontPath)) {
      try {
        const font = fontkit.openSync(fontPath);
        // Register with pdfkit's internal font registry
        (doc as any).font(name, font);
      } catch { /* ignore font registration errors */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SourceFormat = 'md' | 'csv' | 'txt' | 'mermaid' | 'latex' | 'docx';
export type TargetFormat = 'txt' | 'html' | 'md' | 'docx' | 'csv' | 'latex' | 'pdf';

export const VALID_TARGET_FORMATS: readonly TargetFormat[] = ['txt', 'html', 'md', 'docx', 'csv', 'latex', 'pdf'] as const;

/** Options for HTML conversion */
export interface HtmlConversionOptions {
  textColor?: string;      // Default: '#1a1a1a' (black)
  bgColor?: string;        // Default: '#ffffff' (white)
  headingColor?: string;   // Default: '#A68B4B' (papyrus gold)
  darkMode?: boolean;      // Default: false
  includeMermaid?: boolean;// Default: true (include mermaid.js for diagram rendering)
  fontSize?: number;       // Default: 16
}

export interface ConversionResult {
  success: boolean;
  outputPath: string;
  targetFormat: TargetFormat;
  fileSize: number;
  duration: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Markdown → Plain Text
// ---------------------------------------------------------------------------

/**
 * Convert Markdown content to clean plain text.
 *
 * Stripping strategy (order matters):
 *  1. Fenced code blocks — preserved verbatim, wrapped with delimiters
 *  2. Inline code — unwrap backticks
 *  3. Images — replaced with [Image: alt]
 *  4. Links — keep link text, discard URL
 *  5. Bold / italic — unwrap markers
 *  6. Strikethrough — unwrap ~~
 *  7. Headings — uppercase + underline
 *  8. Block quotes — prefix with |
 *  9. Unordered list markers — replace with dashes
 * 10. Ordered list markers — keep numbers
 * 11. Horizontal rules — separator line
 * 12. HTML tags — strip entirely
 */
export function convertMarkdownToText(content: string): string {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeLanguage = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // --- Fenced code blocks ---
    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLanguage = line.trimStart().slice(3).trim();
        codeBlockLines = [];
        output.push(`--- Code${codeLanguage ? ` (${codeLanguage})` : ''} ---`);
      } else {
        inCodeBlock = false;
        output.push(...codeBlockLines);
        output.push('--- End Code ---');
        output.push('');
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // --- Blank lines ---
    if (line.trim() === '') {
      output.push('');
      continue;
    }

    // --- Headings ---
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = stripInline(headingMatch[2]);
      output.push('');
      if (level === 1) {
        output.push(text.toUpperCase());
        output.push('='.repeat(text.length));
      } else if (level === 2) {
        output.push(text.toUpperCase());
        output.push('-'.repeat(text.length));
      } else {
        output.push(text);
      }
      output.push('');
      continue;
    }

    // --- Horizontal rules ---
    if (/^[-*_]{3,}\s*$/.test(line)) {
      output.push('');
      output.push('—'.repeat(40));
      output.push('');
      continue;
    }

    // --- Block quotes ---
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(stripInline(lines[i].slice(2)));
        i++;
      }
      i--; // back up one since the outer loop will increment
      for (const ql of quoteLines) {
        output.push(`  | ${ql}`);
      }
      output.push('');
      continue;
    }

    // --- Unordered lists ---
    if (/^[\s]*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*+]\s+/.test(lines[i])) {
        items.push('  - ' + stripInline(lines[i].replace(/^[\s]*[-*+]\s+/, '')));
        i++;
      }
      i--;
      output.push(...items);
      output.push('');
      continue;
    }

    // --- Ordered lists ---
    if (/^[\s]*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      let num = 1;
      while (i < lines.length && /^[\s]*\d+\.\s+/.test(lines[i])) {
        items.push(`  ${num}. ` + stripInline(lines[i].replace(/^[\s]*\d+\.\s+/, '')));
        num++;
        i++;
      }
      i--;
      output.push(...items);
      output.push('');
      continue;
    }

    // --- Markdown tables → text table ---
    if (line.trim().includes('|') && i + 1 < lines.length && /^\|?\s*[-:]+[-|\s:]*$/.test(lines[i + 1].trim())) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().includes('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      i--;
      // Parse and format as aligned text
      const rows = tableLines
        .filter(l => !/^\|?\s*[-:]+[-|\s:]*$/.test(l.trim())) // skip separator
        .map(l => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
      if (rows.length > 0) {
        const colCount = Math.max(...rows.map(r => r.length));
        const widths: number[] = [];
        for (let col = 0; col < colCount; col++) {
          let maxW = 0;
          for (const row of rows) {
            const cell = col < row.length ? row[col] : '';
            maxW = Math.max(maxW, cell.length);
          }
          widths.push(maxW);
        }
        // Header row
        output.push(formatRow(rows[0], widths));
        output.push(widths.map(w => '-'.repeat(w)).join('  '));
        // Data rows
        for (let ri = 1; ri < rows.length; ri++) {
          output.push(formatRow(rows[ri], widths));
        }
        output.push('');
      }
      continue;
    }

    // --- Regular paragraph text ---
    output.push(stripInline(line));
  }

  // Collapse multiple blank lines to at most two
  return collapseBlankLines(output.join('\n')).trim() + '\n';
}

// ---------------------------------------------------------------------------
// Markdown → HTML (ENHANCED — tables, mermaid, proper formatting)
// ---------------------------------------------------------------------------

/**
 * Convert Markdown content to a proper, well-formatted HTML document.
 * Supports tables, code blocks, mermaid diagrams, blockquotes, lists,
 * inline formatting (bold, italic, code, links, images), and more.
 *
 * Produces a self-contained HTML document with embedded CSS.
 * Mermaid diagrams are rendered client-side using mermaid.js CDN.
 */
export function convertMarkdownToHtml(content: string, options?: HtmlConversionOptions): string {
  const opts: HtmlConversionOptions = {
    textColor: options?.textColor ?? '#1a1a1a',
    bgColor: options?.bgColor ?? (options?.darkMode ? '#1a1a2e' : '#ffffff'),
    headingColor: options?.headingColor ?? (options?.darkMode ? '#D4B87A' : '#A68B4B'),
    darkMode: options?.darkMode ?? false,
    includeMermaid: options?.includeMermaid ?? true,
    fontSize: options?.fontSize ?? 16,
  };

  const lines = content.split(/\r?\n/);
  const body: string[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeLanguage = '';
  let hasMermaid = false;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code blocks
    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLanguage = line.trimStart().slice(3).trim();
        codeBlockLines = [];
      } else {
        inCodeBlock = false;
        const escaped = escapeHtml(codeBlockLines.join('\n'));

        if (codeLanguage === 'mermaid' && opts.includeMermaid) {
          // Mermaid diagram — render with mermaid.js
          hasMermaid = true;
          body.push(`<div class="mermaid">${escapeHtml(codeBlockLines.join('\n'))}</div>`);
        } else {
          body.push(`<pre><code${codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : ''}>${escaped}</code></pre>`);
        }
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = applyInlineHtml(headingMatch[2]);
      const id = headingMatch[2].trim().toLowerCase().replace(/[^\w]+/g, '-');
      body.push(`<h${level} id="${escapeHtml(id)}">${text}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rules
    if (/^[-*_]{3,}\s*$/.test(line)) {
      body.push('<hr />');
      i++;
      continue;
    }

    // Block quotes
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(applyInlineHtml(lines[i].slice(2)));
        i++;
      }
      body.push(`<blockquote>${quoteLines.join('<br />')}</blockquote>`);
      continue;
    }

    // Markdown table detection: line with pipes, next line is separator
    if (line.trim().includes('|') && i + 1 < lines.length && /^\|?\s*[-:]+[-|\s:]*$/.test(lines[i + 1].trim())) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().includes('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      // Parse the table
      const parseRow = (l: string) =>
        l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

      const headers = parseRow(tableLines[0]);
      // Skip separator (tableLines[1])
      const dataRows = tableLines.slice(2).map(parseRow);

      let tableHtml = '<table><thead><tr>';
      for (const h of headers) {
        tableHtml += `<th>${applyInlineHtml(h)}</th>`;
      }
      tableHtml += '</tr></thead><tbody>';
      for (const row of dataRows) {
        tableHtml += '<tr>';
        for (let ci = 0; ci < headers.length; ci++) {
          tableHtml += `<td>${applyInlineHtml(row[ci] || '')}</td>`;
        }
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table>';
      body.push(tableHtml);
      continue;
    }

    // Unordered lists
    if (/^[\s]*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*+]\s+/.test(lines[i])) {
        items.push(`<li>${applyInlineHtml(lines[i].replace(/^[\s]*[-*+]\s+/, ''))}</li>`);
        i++;
      }
      body.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Ordered lists
    if (/^[\s]*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${applyInlineHtml(lines[i].replace(/^[\s]*\d+\.\s+/, ''))}</li>`);
        i++;
      }
      body.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Paragraph
    body.push(`<p>${applyInlineHtml(line)}</p>`);
    i++;
  }

  // Extract title from first heading
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : 'Document';

  const codeBg = opts.darkMode ? '#2a2a1e' : '#f5f0e5';
  const codeColor = opts.darkMode ? '#e0e0e0' : '#333';
  const blockquoteColor = opts.darkMode ? '#aaa' : '#555';
  const borderColor = opts.darkMode ? '#444' : '#ddd';
  const thBg = opts.darkMode ? '#2a2a1e' : '#f5f0e0';
  const linkColor = opts.darkMode ? '#6ab0f3' : '#2C7DA0';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      max-width: 800px;
      margin: 2em auto;
      padding: 0 1.5em;
      line-height: 1.7;
      color: ${opts.textColor};
      background-color: ${opts.bgColor};
      font-size: ${opts.fontSize}px;
    }
    h1, h2, h3, h4, h5, h6 { color: ${opts.headingColor}; margin-top: 1.5em; margin-bottom: 0.5em; }
    h1 { border-bottom: 2px solid ${opts.headingColor}; padding-bottom: 0.3em; font-size: 2em; }
    h2 { border-bottom: 1px solid ${opts.headingColor}40; padding-bottom: 0.2em; font-size: 1.5em; }
    h3 { font-size: 1.25em; }
    p { margin: 0.8em 0; }
    a { color: ${linkColor}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    pre {
      background: ${codeBg};
      padding: 1em;
      border-radius: 4px;
      overflow-x: auto;
      margin: 1em 0;
      font-size: 0.9em;
      line-height: 1.5;
    }
    code {
      font-family: 'Fira Code', 'SF Mono', 'Consolas', monospace;
      font-size: 0.9em;
    }
    p code, li code {
      background: ${codeBg};
      padding: 0.15em 0.4em;
      border-radius: 3px;
    }
    blockquote {
      border-left: 4px solid ${opts.headingColor};
      padding-left: 1em;
      margin: 1em 0;
      color: ${blockquoteColor};
      font-style: italic;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
      font-size: 0.95em;
    }
    th, td {
      border: 1px solid ${borderColor};
      padding: 0.6em 0.8em;
      text-align: left;
    }
    th {
      background: ${thBg};
      font-weight: 600;
      color: ${opts.headingColor};
    }
    tr:nth-child(even) td { background: ${opts.darkMode ? '#1e1e1e' : '#fafafa'}; }
    hr { border: none; border-top: 1px solid ${borderColor}; margin: 2em 0; }
    ul, ol { padding-left: 2em; margin: 0.5em 0; }
    li { margin: 0.3em 0; }
    img { max-width: 100%; height: auto; border-radius: 4px; }
    /* Mermaid diagram container */
    .mermaid {
      margin: 1.5em 0;
      text-align: center;
      background: ${opts.darkMode ? '#1a1a2e' : '#fafafa'};
      border: 1px solid ${borderColor};
      border-radius: 4px;
      padding: 1em;
    }
    @media print {
      body { max-width: 100%; margin: 0; }
      .mermaid { page-break-inside: avoid; }
    }
  </style>
  ${hasMermaid ? `<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script>mermaid.initialize({startOnLoad:true,theme:'${opts.darkMode ? 'dark' : 'default'}'});</script>` : ''}
</head>
<body>
${body.join('\n')}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// CSV → HTML
// ---------------------------------------------------------------------------

/**
 * Convert CSV content to a well-formatted HTML document with a styled table.
 */
export function convertCsvToHtml(content: string, options?: HtmlConversionOptions): string {
  const rows = parseCSVRows(content);
  if (rows.length === 0) return '<!DOCTYPE html><html><body><p>Empty CSV</p></body></html>';

  const opts: HtmlConversionOptions = {
    textColor: options?.textColor ?? '#1a1a1a',
    bgColor: options?.bgColor ?? (options?.darkMode ? '#1a1a2e' : '#ffffff'),
    headingColor: options?.headingColor ?? (options?.darkMode ? '#D4B87A' : '#A68B4B'),
    darkMode: options?.darkMode ?? false,
    fontSize: options?.fontSize ?? 16,
  };

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const colCount = Math.max(...rows.map(r => r.length));

  const borderColor = opts.darkMode ? '#444' : '#ddd';
  const thBg = opts.darkMode ? '#2a2a1e' : '#f5f0e0';

  let tableHtml = '<table><thead><tr>';
  for (let ci = 0; ci < colCount; ci++) {
    tableHtml += `<th>${escapeHtml(ci < headers.length ? headers[ci] : '')}</th>`;
  }
  tableHtml += '</tr></thead><tbody>';
  for (const row of dataRows) {
    tableHtml += '<tr>';
    for (let ci = 0; ci < colCount; ci++) {
      tableHtml += `<td>${escapeHtml(ci < row.length ? row[ci] : '')}</td>`;
    }
    tableHtml += '</tr>';
  }
  tableHtml += '</tbody></table>';

  const title = headers[0] || 'CSV Data';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 960px;
      margin: 2em auto;
      padding: 0 1.5em;
      line-height: 1.6;
      color: ${opts.textColor};
      background-color: ${opts.bgColor};
      font-size: ${opts.fontSize}px;
    }
    h1 { color: ${opts.headingColor}; border-bottom: 2px solid ${opts.headingColor}; padding-bottom: 0.3em; }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
      font-size: 0.9em;
    }
    th, td {
      border: 1px solid ${borderColor};
      padding: 0.5em 0.8em;
      text-align: left;
    }
    th {
      background: ${thBg};
      font-weight: 600;
      color: ${opts.headingColor};
    }
    tr:nth-child(even) td { background: ${opts.darkMode ? '#1e1e1e' : '#fafafa'}; }
    .meta { font-size: 0.85em; color: #888; margin-top: 1em; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${tableHtml}
  <p class="meta">${dataRows.length} rows, ${colCount} columns</p>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// CSV → Plain Text
// ---------------------------------------------------------------------------

/**
 * Convert CSV content to an aligned plain-text table.
 */
export function convertCsvToText(content: string): string {
  const rows = parseCSVRows(content);
  if (rows.length === 0) return '';

  // Calculate column widths
  const colCount = Math.max(...rows.map(r => r.length));
  const widths: number[] = [];
  for (let col = 0; col < colCount; col++) {
    let maxW = 0;
    for (const row of rows) {
      const cell = col < row.length ? row[col] : '';
      maxW = Math.max(maxW, cell.length);
    }
    widths.push(maxW);
  }

  const output: string[] = [];

  // Header row
  if (rows.length > 0) {
    output.push(formatRow(rows[0], widths));
    output.push(widths.map(w => '-'.repeat(w)).join('  '));
  }

  // Data rows
  for (let i = 1; i < rows.length; i++) {
    output.push(formatRow(rows[i], widths));
  }

  return output.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// CSV → Markdown
// ---------------------------------------------------------------------------

/**
 * Convert CSV content to a Markdown table.
 */
export function convertCsvToMarkdown(content: string): string {
  const rows = parseCSVRows(content);
  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map(r => r.length));

  const output: string[] = [];

  // Header row
  const header = rows[0];
  const headerCells: string[] = [];
  for (let col = 0; col < colCount; col++) {
    headerCells.push(col < header.length ? header[col] : '');
  }
  output.push(`| ${headerCells.join(' | ')} |`);
  output.push(`| ${headerCells.map(() => '---').join(' | ')} |`);

  // Data rows
  for (let i = 1; i < rows.length; i++) {
    const cells: string[] = [];
    for (let col = 0; col < colCount; col++) {
      cells.push(col < rows[i].length ? rows[i][col] : '');
    }
    output.push(`| ${cells.join(' | ')} |`);
  }

  return output.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Plain Text → Markdown
// ---------------------------------------------------------------------------

/**
 * Convert plain text to Markdown format.
 * Double newlines become paragraph separators, single newlines are joined.
 * Lines that look like titles get a # heading.
 */
export function convertTxtToMarkdown(content: string): string {
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const output: string[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i].trim();

    // First paragraph is likely the title if it's short and there are more paragraphs
    if (i === 0 && para.length < 80 && paragraphs.length > 1) {
      output.push(`# ${para}`);
      output.push('');
      continue;
    }

    // Join hard-wrapped lines within the paragraph
    const lines = para.split('\n');
    const joined = lines.map(l => l.trim()).join(' ');
    output.push(joined);
    output.push('');
  }

  return output.join('\n').trim() + '\n';
}

// ---------------------------------------------------------------------------
// Mermaid → HTML
// ---------------------------------------------------------------------------

/**
 * Convert Mermaid diagram source to an HTML document that renders the diagram.
 */
export function convertMermaidToHtml(content: string, options?: HtmlConversionOptions): string {
  const opts: HtmlConversionOptions = {
    textColor: options?.textColor ?? '#1a1a1a',
    bgColor: options?.bgColor ?? (options?.darkMode ? '#1a1a2e' : '#ffffff'),
    headingColor: options?.headingColor ?? (options?.darkMode ? '#D4B87A' : '#A68B4B'),
    darkMode: options?.darkMode ?? false,
    fontSize: options?.fontSize ?? 16,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mermaid Diagram</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 960px;
      margin: 2em auto;
      padding: 0 1.5em;
      line-height: 1.6;
      color: ${opts.textColor};
      background-color: ${opts.bgColor};
      font-size: ${opts.fontSize}px;
    }
    h1 { color: ${opts.headingColor}; border-bottom: 2px solid ${opts.headingColor}; padding-bottom: 0.3em; }
    .mermaid {
      margin: 1.5em 0;
      text-align: center;
      background: ${opts.darkMode ? '#1a1a2e' : '#fafafa'};
      border: 1px solid ${opts.darkMode ? '#444' : '#ddd'};
      border-radius: 4px;
      padding: 1.5em;
    }
    .source {
      margin-top: 2em;
      padding: 1em;
      background: ${opts.darkMode ? '#2a2a1e' : '#f5f0e5'};
      border-radius: 4px;
      font-family: 'Fira Code', monospace;
      font-size: 0.85em;
      white-space: pre-wrap;
      overflow-x: auto;
    }
  </style>
  <script>mermaid.initialize({startOnLoad:true,theme:'${opts.darkMode ? 'dark' : 'default'}'});</script>
</head>
<body>
  <h1>Mermaid Diagram</h1>
  <div class="mermaid">${escapeHtml(content.trim())}</div>
  <h2>Source</h2>
  <div class="source">${escapeHtml(content)}</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// CSV Export (from any format with table data)
// ---------------------------------------------------------------------------

/**
 * Convert Markdown content to CSV format.
 * Extracts tables from markdown and writes them as proper CSV.
 * If no tables are found, creates a simple key-value CSV from headings and paragraphs.
 */
export function convertMarkdownToCsv(content: string): string {
  const lines = content.split(/\r?\n/);
  const tables: string[][][] = []; // Array of tables, each table is array of rows
  let currentTable: string[][] | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect markdown table
    if (trimmed.includes('|') && i + 1 < lines.length && /^\|?\s*[-:]+[-|\s:]*$/.test(lines[i + 1].trim())) {
      currentTable = [];
      while (i < lines.length && lines[i].trim().includes('|')) {
        const rowLine = lines[i].trim();
        // Skip separator lines
        if (!/^\|?\s*[-:]+[-|\s:]*$/.test(rowLine)) {
          const cells = rowLine.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => csvEscapeCell(c.trim()));
          currentTable.push(cells);
        }
        i++;
      }
      if (currentTable && currentTable.length > 0) {
        tables.push(currentTable);
      }
      currentTable = null;
      continue;
    }

    i++;
  }

  if (tables.length === 0) {
    // No tables found — create a simple structure from headings/paragraphs
    const rows: string[][] = [['Section', 'Content']];
    let currentSection = 'Document';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('# ')) {
        currentSection = trimmed.slice(2);
        rows.push([csvEscapeCell(currentSection), '']);
      } else if (trimmed.startsWith('## ')) {
        currentSection = trimmed.slice(3);
        rows.push([csvEscapeCell(currentSection), '']);
      } else if (trimmed.startsWith('### ')) {
        currentSection = trimmed.slice(4);
        rows.push([csvEscapeCell(currentSection), '']);
      } else if (trimmed && !trimmed.startsWith('```') && !trimmed.startsWith('---')) {
        rows.push([csvEscapeCell(currentSection), csvEscapeCell(stripInline(trimmed))]);
      }
    }
    return rows.map(row => row.join(',')).join('\n') + '\n';
  }

  // Output all tables, separated by blank lines
  const output: string[] = [];
  for (let t = 0; t < tables.length; t++) {
    if (t > 0) output.push(''); // blank line between tables
    const table = tables[t];
    const colCount = Math.max(...table.map(r => r.length));
    for (const row of table) {
      // Pad rows to match column count
      const paddedRow = [...row];
      while (paddedRow.length < colCount) paddedRow.push('');
      output.push(paddedRow.join(','));
    }
  }

  return output.join('\n') + '\n';
}

/**
 * Convert CSV content to CSV (re-format/re-parse).
 * Handles quoted fields, mermaid code blocks, and malformed data professionally.
 */
export function convertCsvToCsv(content: string): string {
  const rows = parseCSVRows(content);
  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map(r => r.length));
  const output: string[] = [];

  for (const row of rows) {
    const paddedRow = [...row];
    while (paddedRow.length < colCount) paddedRow.push('');
    output.push(paddedRow.map(cell => csvEscapeCell(cell)).join(','));
  }

  return output.join('\n') + '\n';
}

/**
 * Convert plain text to CSV.
 * Treats each line as a row with a single column, or detects pipe/tab delimited data.
 */
export function convertTxtToCsv(content: string): string {
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

  // Detect if it looks like tab-separated or pipe-separated data
  const tabCount = lines.filter(l => l.includes('\t')).length;
  const pipeCount = lines.filter(l => l.includes('|') && !l.startsWith('|')).length;

  if (tabCount > lines.length * 0.5) {
    // Tab-separated — convert to CSV
    return lines.map(line =>
      line.split('\t').map(cell => csvEscapeCell(cell.trim())).join(',')
    ).join('\n') + '\n';
  }

  // Default: line-per-row CSV
  return 'Line,Content\n' + lines.map((line, i) =>
    `${i + 1},${csvEscapeCell(line)}`
  ).join('\n') + '\n';
}

/**
 * Convert Mermaid source to CSV (metadata extraction).
 */
export function convertMermaidToCsv(content: string): string {
  const lines = content.trim().split(/\r?\n/);
  const rows: string[][] = [['Line', 'Content', 'Type']];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    let type = 'code';
    if (line.startsWith('graph') || line.startsWith('flowchart')) type = 'graph-definition';
    else if (line.startsWith('sequenceDiagram')) type = 'sequence-definition';
    else if (line.startsWith('classDiagram')) type = 'class-definition';
    else if (line.startsWith('erDiagram')) type = 'er-definition';
    else if (line.startsWith('%%')) type = 'comment';
    else if (line.includes('-->')) type = 'arrow';
    else if (line.includes('---')) type = 'link';
    else if (line.startsWith('subgraph')) type = 'subgraph';
    else if (line === 'end') type = 'end';

    rows.push([String(i + 1), csvEscapeCell(line), type]);
  }

  return rows.map(row => row.join(',')).join('\n') + '\n';
}

/**
 * Convert Mermaid diagram source to plain text description.
 * Extracts node labels, edges, and key structural elements as readable text.
 */
export function convertMermaidToText(content: string): string {
  const lines = content.trim().split(/\r?\n/);
  const output: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    if (trimmed.startsWith('graph ') || trimmed.startsWith('flowchart ')) {
      output.push(`[Diagram: ${trimmed}]`);
      continue;
    }
    if (trimmed.startsWith('sequenceDiagram')) {
      output.push('[Sequence Diagram]');
      continue;
    }
    if (trimmed.startsWith('classDiagram')) {
      output.push('[Class Diagram]');
      continue;
    }
    if (trimmed.startsWith('erDiagram')) {
      output.push('[ER Diagram]');
      continue;
    }
    if (trimmed.startsWith('gantt')) {
      output.push('[Gantt Chart]');
      continue;
    }
    if (trimmed.startsWith('pie')) {
      output.push('[Pie Chart]');
      continue;
    }
    if (trimmed.startsWith('stateDiagram')) {
      output.push('[State Diagram]');
      continue;
    }
    const arrow = trimmed.match(/^(.+?)(-{2,}[>x]?|={2,}[>]?|--[>x]?)(.+)$/);
    if (arrow) {
      const src = arrow[1].trim().replace(/[\[\]\(\)"]/g, '');
      const dst = arrow[3].trim().replace(/[\[\]\(\)"]/g, '');
      output.push(`${src} -> ${dst}`);
      continue;
    }
    const node = trimmed.match(/^(\w+)\[([^\]]+)\]/);
    if (node) {
      output.push(`${node[1]}: ${node[2]}`);
      continue;
    }
    const node2 = trimmed.match(/^(\w+)\(([^\)]+)\)/);
    if (node2) {
      output.push(`${node2[1]}: ${node2[2]}`);
      continue;
    }
    output.push(trimmed);
  }

  return output.join('\n') || content;
}

/** CSV-escape a cell value (wrap in quotes if it contains comma, quote, or newline) */
function csvEscapeCell(value: string): string {
  if (!value) return '';
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

// ---------------------------------------------------------------------------
// DOCX Export (Office Open XML format — ZIP of XML files, no external deps)
// ---------------------------------------------------------------------------

/**
 * Convert Markdown content to a DOCX file (Office Open XML format).
 * Generates a valid .docx file using raw XML — no external libraries needed.
 * Supports headings, paragraphs, tables, lists, code blocks, and bold/italic.
 */
export async function convertMarkdownToDocx(content: string, options?: HtmlConversionOptions): Promise<Buffer> {
  // Minimal DOCX is a ZIP of XML files.
  // We'll use the built-in zlib to create a ZIP archive.

  const lines = content.split(/\r?\n/);
  const bodyParts: string[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeLanguage = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code blocks
    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLanguage = trimmed.slice(3).trim();
        codeBlockLines = [];
      } else {
        inCodeBlock = false;
        // Render code block as a monospace paragraph with shading
        const codeText = escapeXml(codeBlockLines.join('\n'));
        bodyParts.push(
          `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="18"/></w:rPr></w:pPr>` +
          `<w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${codeText}</w:t></w:r></w:p>`
        );
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      i++;
      continue;
    }

    // Empty line
    if (trimmed === '') {
      i++;
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = escapeXml(stripInline(headingMatch[2]));
      bodyParts.push(
        `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(trimmed)) {
      bodyParts.push(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>`);
      i++;
      continue;
    }

    // Markdown table
    if (trimmed.includes('|') && i + 1 < lines.length && /^\|?\s*[-:]+[-|\s:]*$/.test(lines[i + 1].trim())) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().includes('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const parseRow = (l: string) =>
        l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

      const headers = parseRow(tableLines[0]);
      const dataRows = tableLines.slice(2).map(parseRow);
      const colCount = headers.length;

      // Build DOCX table
      let tableXml = `<w:tbl><w:tblPr><w:tblBorders>` +
        `<w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
        `<w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
        `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
        `<w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
        `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
        `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
        `</w:tblBorders><w:tblW w:w="5000" w:type="pct"/></w:tblPr>`;

      // Header row with shading
      tableXml += `<w:tr>`;
      for (const h of headers) {
        tableXml += `<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="F0E6D0"/></w:tcPr>` +
          `<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(h)}</w:t></w:r></w:p></w:tc>`;
      }
      tableXml += `</w:tr>`;

      // Data rows
      for (const row of dataRows) {
        tableXml += `<w:tr>`;
        for (let ci = 0; ci < colCount; ci++) {
          tableXml += `<w:tc><w:p><w:r><w:t>${escapeXml(row[ci] || '')}</w:t></w:r></w:p></w:tc>`;
        }
        tableXml += `</w:tr>`;
      }

      tableXml += `</w:tbl>`;
      bodyParts.push(tableXml);
      continue;
    }

    // Unordered list
    if (/^[\s]*[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*+]\s+/.test(lines[i])) {
        items.push(stripInline(lines[i].replace(/^[\s]*[-*+]\s+/, '')));
        i++;
      }
      for (const item of items) {
        bodyParts.push(
          `<w:p><w:pPr><w:ind w:left="360"/><w:pBdr><w:left w:val="single" w:sz="4" w:space="4" w:color="A68B4B"/></w:pBdr></w:pPr>` +
          `<w:r><w:t xml:space="preserve">  ${escapeXml(item)}</w:t></w:r></w:p>`
        );
      }
      continue;
    }

    // Ordered list
    if (/^[\s]*\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*\d+\.\s+/.test(lines[i])) {
        items.push(stripInline(lines[i].replace(/^[\s]*\d+\.\s+/, '')));
        i++;
      }
      for (let idx = 0; idx < items.length; idx++) {
        bodyParts.push(
          `<w:p><w:pPr><w:ind w:left="360"/></w:pPr>` +
          `<w:r><w:t xml:space="preserve">${idx + 1}. ${escapeXml(items[idx])}</w:t></w:r></w:p>`
        );
      }
      continue;
    }

    // Regular paragraph
    bodyParts.push(`<w:p><w:r><w:t xml:space="preserve">${escapeXml(stripInline(trimmed))}</w:t></w:r></w:p>`);
    i++;
  }

  // Extract title
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : 'Document';

  // Build the DOCX ZIP archive
  return buildDocxZip(title, bodyParts.join('\n'));
}

/**
 * Convert CSV content to DOCX with a properly formatted table.
 */
export async function convertCsvToDocx(content: string, options?: HtmlConversionOptions): Promise<Buffer> {
  const rows = parseCSVRows(content);
  if (rows.length === 0) {
    return buildDocxZip('Empty CSV', '<w:p><w:r><w:t>No data</w:t></w:r></w:p>');
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const colCount = Math.max(...rows.map(r => r.length));

  // Build table XML
  let tableXml = `<w:tbl><w:tblPr><w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
    `<w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
    `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
    `<w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
    `</w:tblBorders><w:tblW w:w="5000" w:type="pct"/></w:tblPr>`;

  // Header row
  tableXml += `<w:tr>`;
  for (let ci = 0; ci < colCount; ci++) {
    tableXml += `<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="F0E6D0"/></w:tcPr>` +
      `<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(ci < headers.length ? headers[ci] : '')}</w:t></w:r></w:p></w:tc>`;
  }
  tableXml += `</w:tr>`;

  // Data rows
  for (const row of dataRows) {
    tableXml += `<w:tr>`;
    for (let ci = 0; ci < colCount; ci++) {
      tableXml += `<w:tc><w:p><w:r><w:t>${escapeXml(ci < row.length ? row[ci] : '')}</w:t></w:r></w:p></w:tc>`;
    }
    tableXml += `</w:tr>`;
  }
  tableXml += `</w:tbl>`;

  const title = headers[0] || 'CSV Data';
  const bodyXml = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escapeXml(title)}</w:t></w:r></w:p>` +
    tableXml +
    `<w:p><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="888888"/></w:rPr><w:t>${dataRows.length} rows, ${colCount} columns</w:t></w:r></w:p>`;

  return buildDocxZip(title, bodyXml);
}

/** Build a valid DOCX ZIP archive from body XML */
async function buildDocxZip(_title: string, bodyXml: string): Promise<Buffer> {
  const files: Record<string, Buffer> = {};

  // [Content_Types].xml
  files['[Content_Types].xml'] = Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);

  // _rels/.rels
  files['_rels/.rels'] = Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  // word/_rels/document.xml.rels
  files['word/_rels/document.xml.rels'] = Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

  // word/styles.xml
  files['word/styles.xml'] = Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="240" w:after="120"/><w:jc w:val="left"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="48"/><w:color w:val="A68B4B"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="A68B4B"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="A68B4B"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading4">
    <w:name w:val="heading 4"/>
    <w:pPr><w:spacing w:before="120" w:after="60"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading5">
    <w:name w:val="heading 5"/>
    <w:pPr><w:spacing w:before="100" w:after="40"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading6">
    <w:name w:val="heading 6"/>
    <w:pPr><w:spacing w:before="80" w:after="40"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="20"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr><w:spacing w:after="120"/><w:line w:val="360" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:sz w:val="24"/><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr>
  </w:style>
</w:styles>`);

  // word/document.xml
  files['word/document.xml'] = Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
${bodyXml}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>
    </w:sectPr>
  </w:body>
</w:document>`);

  // Build ZIP manually (minimal ZIP format)
  return buildZipBuffer(files);
}

/** Build a minimal ZIP file from a map of filename → Buffer */
function buildZipBuffer(files: Record<string, Buffer>): Buffer {
  const entries: Array<{ name: string; data: Buffer; compressed: Buffer; crc: number }> = [];

  for (const [name, data] of Object.entries(files)) {
    const compressed = deflateSync(data);
    const crc = crc32(data);
    entries.push({ name, data, compressed, crc });
  }

  // Calculate sizes
  let centralDirSize = 0;
  let offset = 0;

  for (const entry of entries) {
    centralDirSize += 46 + Buffer.byteLength(entry.name);
  }

  // Build the file
  const parts: Buffer[] = [];
  const localHeaders: Array<{ offset: number; name: string; crc: number; compressedSize: number; uncompressedSize: number }> = [];

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf-8');
    const localHeaderOffset = offset;

    // Local file header (30 + name length)
    const localHeader = Buffer.alloc(30 + nameBytes.length);
    localHeader.writeUInt32LE(0x04034b50, 0);  // Signature
    localHeader.writeUInt16LE(20, 4);           // Version needed
    localHeader.writeUInt16LE(0x0002, 6);       // Flags (max compression)
    localHeader.writeUInt16LE(8, 8);            // Compression method (deflate)
    localHeader.writeUInt16LE(0, 10);           // Mod time
    localHeader.writeUInt16LE(0, 12);           // Mod date
    localHeader.writeUInt32LE(entry.crc, 14);   // CRC-32
    localHeader.writeUInt32LE(entry.compressed.length, 18); // Compressed size
    localHeader.writeUInt32LE(entry.data.length, 22);       // Uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26);        // Name length
    localHeader.writeUInt16LE(0, 28);           // Extra field length
    nameBytes.copy(localHeader, 30);

    parts.push(localHeader);
    parts.push(entry.compressed);

    localHeaders.push({
      offset: localHeaderOffset,
      name: entry.name,
      crc: entry.crc,
      compressedSize: entry.compressed.length,
      uncompressedSize: entry.data.length,
    });

    offset += localHeader.length + entry.compressed.length;
  }

  // Central directory
  const centralDirOffset = offset;
  for (const header of localHeaders) {
    const nameBytes = Buffer.from(header.name, 'utf-8');
    const centralEntry = Buffer.alloc(46 + nameBytes.length);
    centralEntry.writeUInt32LE(0x02014b50, 0);    // Central dir signature
    centralEntry.writeUInt16LE(20, 4);             // Version made by
    centralEntry.writeUInt16LE(20, 6);             // Version needed
    centralEntry.writeUInt16LE(0x0002, 8);         // Flags
    centralEntry.writeUInt16LE(8, 10);             // Compression method
    centralEntry.writeUInt16LE(0, 12);             // Mod time
    centralEntry.writeUInt16LE(0, 14);             // Mod date
    centralEntry.writeUInt32LE(header.crc, 16);    // CRC-32
    centralEntry.writeUInt32LE(header.compressedSize, 20);  // Compressed size
    centralEntry.writeUInt32LE(header.uncompressedSize, 24); // Uncompressed size
    centralEntry.writeUInt16LE(nameBytes.length, 28);        // Name length
    centralEntry.writeUInt16LE(0, 30);             // Extra field length
    centralEntry.writeUInt16LE(0, 32);             // Comment length
    centralEntry.writeUInt16LE(0, 34);             // Disk number start
    centralEntry.writeUInt16LE(0, 36);             // Internal attrs
    centralEntry.writeUInt32LE(0, 38);             // External attrs
    centralEntry.writeUInt32LE(header.offset, 42); // Local header offset
    nameBytes.copy(centralEntry, 46);

    parts.push(centralEntry);
  }

  const centralDirEndOffset = centralDirOffset + parts.slice(localHeaders.length + entries.length).reduce((sum, b) => sum + b.length, 0);

  // Actually, let me just compute it from what we've written
  const endOfCentralDir = Buffer.alloc(22);
  endOfCentralDir.writeUInt32LE(0x06054b50, 0);   // End of central dir signature
  endOfCentralDir.writeUInt16LE(0, 4);             // Disk number
  endOfCentralDir.writeUInt16LE(0, 6);             // Disk with central dir
  endOfCentralDir.writeUInt16LE(entries.length, 8);  // Entries on this disk
  endOfCentralDir.writeUInt16LE(entries.length, 10); // Total entries
  // We need to calculate central dir size properly
  const cdParts = parts.slice(entries.length); // Central dir parts are after local file entries
  // Actually, parts contains: [local0, compressed0, local1, compressed1, ..., central0, central1, ...]
  // So let me count properly
  let cdSize = 0;
  for (let i = entries.length * 2; i < parts.length; i++) {
    cdSize += parts[i].length;
  }
  endOfCentralDir.writeUInt32LE(cdSize, 12);       // Central dir size
  endOfCentralDir.writeUInt32LE(centralDirOffset, 16); // Central dir offset
  endOfCentralDir.writeUInt16LE(0, 20);            // Comment length

  parts.push(endOfCentralDir);

  return Buffer.concat(parts);
}

/** CRC32 calculation for ZIP files */
function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const crc32Table: number[] = (() => {
  const table: number[] = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      if (c & 1) {
        c = 0xEDB88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table.push(c >>> 0);
  }
  return table;
})();

/** XML-escape text for DOCX content */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------------------
// LaTeX → Markdown (Parse LaTeX source and convert to Markdown)
// ---------------------------------------------------------------------------

/**
 * Convert LaTeX source to Markdown format.
 * Parses common LaTeX structures: sections, paragraphs, lists, tables,
 * math environments, code blocks, and inline formatting.
 */
export function convertLatexToMarkdown(content: string): string {
  const output: string[] = [];
  const lines = content.split(/\r?\n/);
  let i = 0;
  let inDocument = false;
  let inItemize = false;
  let inEnumerate = false;
  let enumCounter = 0;

  const stripComments = (line: string): string => {
    return line.replace(/(?<!\\)%.*$/, '');
  };

  while (i < lines.length) {
    // Check for verbatim/code blocks BEFORE comment stripping
    const preTrimmed = lines[i].trim();
    if (preTrimmed.startsWith('\\begin{verbatim}')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('\\end{verbatim}')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      output.push('', '```', codeLines.join('\n'), '```', '');
      continue;
    }
    if (preTrimmed.startsWith('\\begin{lstlisting}')) {
      const langMatch = preTrimmed.match(/\\begin\{lstlisting\}(?:\[.*?\])?\{?(\w*)\}?/);
      const lang = langMatch ? langMatch[1] : '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('\\end{lstlisting}')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      output.push('', `\`\`\`${lang}`, codeLines.join('\n'), '```', '');
      continue;
    }

    let line = stripComments(lines[i]);
    const trimmed = line.trim();

    if (!inDocument) {
      if (trimmed.startsWith('\\begin{document}')) {
        inDocument = true;
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (trimmed.startsWith('\\end{document}')) {
      break;
    }

    if (trimmed.startsWith('\\title{')) {
      const title = extractBraceContent(trimmed, '\\title{');
      if (title) output.push(`# ${title}`, '');
      i++; continue;
    }
    if (trimmed.startsWith('\\author{')) {
      const author = extractBraceContent(trimmed, '\\author{');
      if (author) output.push(`> Author: ${author}`, '');
      i++; continue;
    }
    if (trimmed.startsWith('\\date{')) {
      const date = extractBraceContent(trimmed, '\\date{');
      if (date) output.push(`> Date: ${date}`, '');
      i++; continue;
    }
    if (trimmed === '\\maketitle') {
      i++; continue;
    }
    if (trimmed.startsWith('\\tableofcontents')) {
      output.push('## Table of Contents', '', '*(Auto-generated)*', '');
      i++; continue;
    }

    // --- Sections ---
    if (trimmed.startsWith('\\section{')) {
      const text = extractBraceContent(trimmed, '\\section{');
      if (inItemize) { output.push('</list>'); inItemize = false; }
      if (inEnumerate) { output.push('</olist>'); inEnumerate = false; }
      output.push('', `## ${convertLatexInlineToMd(text)}`, '');
      i++; continue;
    }
    if (trimmed.startsWith('\\subsection{')) {
      const text = extractBraceContent(trimmed, '\\subsection{');
      output.push('', `### ${convertLatexInlineToMd(text)}`, '');
      i++; continue;
    }
    if (trimmed.startsWith('\\subsubsection{')) {
      const text = extractBraceContent(trimmed, '\\subsubsection{');
      output.push('', `#### ${convertLatexInlineToMd(text)}`, '');
      i++; continue;
    }
    if (trimmed.startsWith('\\paragraph{')) {
      const text = extractBraceContent(trimmed, '\\paragraph{');
      output.push('', `##### ${convertLatexInlineToMd(text)}`, '');
      i++; continue;
    }

    // --- Section with star (unnumbered) ---
    if (trimmed.startsWith('\\section*{')) {
      const text = extractBraceContent(trimmed, '\\section*{');
      output.push('', `## ${convertLatexInlineToMd(text)}`, '');
      i++; continue;
    }
    if (trimmed.startsWith('\\subsection*{')) {
      const text = extractBraceContent(trimmed, '\\subsection*{');
      output.push('', `### ${convertLatexInlineToMd(text)}`, '');
      i++; continue;
    }

    // --- Lists ---
    if (trimmed.startsWith('\\begin{itemize}')) {
      inItemize = true;
      i++; continue;
    }
    if (trimmed.startsWith('\\end{itemize}')) {
      inItemize = false;
      output.push('');
      i++; continue;
    }
    if (trimmed.startsWith('\\begin{enumerate}')) {
      inEnumerate = true;
      enumCounter = 1;
      i++; continue;
    }
    if (trimmed.startsWith('\\end{enumerate}')) {
      inEnumerate = false;
      output.push('');
      i++; continue;
    }
    if (trimmed.startsWith('\\item')) {
      const itemText = trimmed.slice(5).trim();
      if (inEnumerate) {
        output.push(`${enumCounter}. ${convertLatexInlineToMd(itemText)}`);
        enumCounter++;
      } else {
        output.push(`- ${convertLatexInlineToMd(itemText)}`);
      }
      i++; continue;
    }

    // --- Math environments ---
    if (trimmed.startsWith('\\begin{equation}') || trimmed.startsWith('\\begin{align}') || trimmed.startsWith('\\begin{gather}')) {
      const envName = trimmed.match(/\\begin\{(\w+)\}/)?.[1] || 'equation';
      const mathLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(`\\end{${envName}}`)) {
        mathLines.push(lines[i]);
        i++;
      }
      i++; // skip \end{env}
      output.push('', `$$`, mathLines.join('\n').trim(), `$$`, '');
      continue;
    }

    // --- Tables ---
    if (trimmed.startsWith('\\begin{tabular}') || trimmed.startsWith('\\begin{table}')) {
      const tableLines: string[] = [];
      let inTabular = false;
      // Collect everything until \end{tabular} or \end{table}
      while (i < lines.length) {
        const tl = stripComments(lines[i]).trim();
        if (tl.startsWith('\\begin{tabular}')) {
          inTabular = true;
          i++; continue;
        }
        if (tl.startsWith('\\end{tabular}')) {
          i++; continue;
        }
        if (tl.startsWith('\\end{table}')) {
          i++; break;
        }
        if (tl.startsWith('\\caption{')) {
          const caption = extractBraceContent(tl, '\\caption{');
          if (caption) tableLines.push(`**${caption}**`);
          i++; continue;
        }
        if (tl.startsWith('\\hline') || tl.startsWith('\\toprule') || tl.startsWith('\\midrule') || tl.startsWith('\\bottomrule')) {
          i++; continue;
        }
        if (inTabular && tl && !tl.startsWith('\\')) {
          // Parse table row: cells separated by &
          const cells = tl.replace(/\\\\$/, '').split('&').map(c => convertLatexInlineToMd(c.trim()));
          tableLines.push(`| ${cells.join(' | ')} |`);
        }
        i++;
      }
      if (tableLines.length > 0) {
        // Add separator after first row
        const firstRow = tableLines[0];
        const colCount = (firstRow.match(/\|/g) || []).length - 1;
        output.push('', firstRow);
        output.push(`| ${Array(colCount).fill('---').join(' | ')} |`);
        for (let ti = 1; ti < tableLines.length; ti++) {
          output.push(tableLines[ti]);
        }
        output.push('');
      }
      continue;
    }

    // --- Block quotes ---
    if (trimmed.startsWith('\\begin{quote}') || trimmed.startsWith('\\begin{quotation}')) {
      const quoteLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('\\end{quote}') && !lines[i].trim().startsWith('\\end{quotation}')) {
        quoteLines.push(convertLatexInlineToMd(stripComments(lines[i]).trim()));
        i++;
      }
      i++;
      for (const ql of quoteLines) {
        if (ql) output.push(`> ${ql}`);
      }
      output.push('');
      continue;
    }

    // --- Horizontal rule ---
    if (trimmed.startsWith('\\newpage') || trimmed.startsWith('\\pagebreak') || trimmed.startsWith('\\clearpage')) {
      output.push('', '---', '');
      i++; continue;
    }

    // --- Skip common non-content commands ---
    if (trimmed.startsWith('\\usepackage') || trimmed.startsWith('\\documentclass') ||
        trimmed.startsWith('\\setlength') || trimmed.startsWith('\\setcounter') ||
        trimmed.startsWith('\\definecolor') || trimmed.startsWith('\\geometry') ||
        trimmed.startsWith('\\linespread') || trimmed.startsWith('\\pagestyle') ||
        trimmed.startsWith('\\thispagestyle') || trimmed.startsWith('\\noindent') ||
        trimmed.startsWith('\\vspace') || trimmed.startsWith('\\hspace') ||
        trimmed.startsWith('\\vfill') || trimmed.startsWith('\\hfill') ||
        trimmed.startsWith('\\centering') || trimmed.startsWith('\\raggedright') ||
        trimmed.startsWith('\\label{') || trimmed.startsWith('\\ref{') ||
        trimmed.startsWith('\\cite{') || trimmed.startsWith('\\bibliographystyle') ||
        trimmed.startsWith('\\bibliography{') || trimmed.startsWith('\\printbibliography') ||
        trimmed.startsWith('\\addbibresource') || trimmed.startsWith('\\footnotetext') ||
        trimmed.startsWith('\\marginpar') || trimmed === '') {
      i++; continue;
    }

    // --- Footnote ---
    if (trimmed.startsWith('\\footnote{')) {
      const fn = extractBraceContent(trimmed, '\\footnote{');
      output.push(`[^footnote]: ${convertLatexInlineToMd(fn)}`);
      i++; continue;
    }

    // --- Skip \begin/\end for environments we don't specially handle ---
    if (trimmed.startsWith('\\begin{') && !trimmed.startsWith('\\begin{document}')) {
      // Skip unknown environments
      const envName = trimmed.match(/\\begin\{(\w+)\}/)?.[1];
      if (envName && !['itemize', 'enumerate', 'verbatim', 'lstlisting', 'equation', 'align', 'gather', 'tabular', 'table', 'quote', 'quotation'].includes(envName)) {
        // Just skip the environment, output content as-is
        i++;
        let depth = 1;
        while (i < lines.length && depth > 0) {
          const l = lines[i].trim();
          if (l.match(/\\begin\{/)) depth++;
          if (l.match(/\\end\{/)) depth--;
          if (depth > 0) {
            const content = convertLatexInlineToMd(stripComments(lines[i]).trim());
            if (content) output.push(content);
          }
          i++;
        }
        continue;
      }
    }

    // --- Display math $$ ... $$ ---
    if (trimmed.startsWith('$$') || trimmed.startsWith('\\[')) {
      const mathLines: string[] = [];
      const endMarker = trimmed.startsWith('$$') ? '$$' : '\\]';
      if (trimmed.endsWith(endMarker) && trimmed.length > 2) {
        // Single-line display math
        const math = trimmed.slice(2, trimmed.endsWith(endMarker) ? -2 : undefined);
        output.push('', `$$${math.trim()}$$`, '');
        i++; continue;
      }
      i++;
      while (i < lines.length) {
        const ml = lines[i].trim();
        if (ml.endsWith(endMarker)) {
          mathLines.push(ml.slice(0, -endMarker.length));
          i++; break;
        }
        mathLines.push(ml);
        i++;
      }
      output.push('', '$$', mathLines.join('\n').trim(), '$$', '');
      continue;
    }

    // --- Regular paragraph text ---
    const converted = convertLatexInlineToMd(trimmed);
    if (converted) {
      output.push(converted);
      output.push('');
    }
    i++;
  }

  return collapseBlankLines(output.join('\n')).trim() + '\n';
}

/** Extract content from \command{...} pattern */
function extractBraceContent(line: string, prefix: string): string {
  const startIdx = line.indexOf(prefix);
  if (startIdx === -1) return '';
  const braceStart = startIdx + prefix.length - 1; // position of {
  let depth = 0;
  let content = '';
  for (let i = braceStart; i < line.length; i++) {
    if (line[i] === '{') {
      if (depth > 0) content += line[i];
      depth++;
    } else if (line[i] === '}') {
      depth--;
      if (depth === 0) break;
      content += line[i];
    } else {
      content += line[i];
    }
  }
  return content.trim();
}

/** Convert LaTeX inline formatting to Markdown */
function convertLatexInlineToMd(text: string): string {
  if (!text) return '';
  return text
    // Bold: \textbf{...} → **...**
    .replace(/\\textbf\{([^}]*)\}/g, '**$1**')
    // Italic: \textit{...} or \emph{...} → *...*
    .replace(/\\textit\{([^}]*)\}/g, '*$1*')
    .replace(/\\emph\{([^}]*)\}/g, '*$1*')
    // Monospace: \texttt{...} or \verb|...| → `...`
    .replace(/\\texttt\{([^}]*)\}/g, '`$1`')
    .replace(/\\verb\|([^|]*)\|/g, '`$1`')
    .replace(/\\verb\+([^+]*)\+/g, '`$1`')
    .replace(/\\verb\!([^!]*)\!/g, '`$1`')
    // Small caps: \textsc{...} → just the text
    .replace(/\\textsc\{([^}]*)\}/g, '$1')
    // Underline: \underline{...} → just the text
    .replace(/\\underline\{([^}]*)\}/g, '$1')
    // Strikethrough (from ulem package): \sout{...} → ~~...~~
    .replace(/\\sout\{([^}]*)\}/g, '~~$1~~')
    // Inline math: $...$ → $...$ (preserve for markdown math)
    .replace(/\\\(([^)]*)\\\)/g, '$$$1$$$')  // \(...\) → $...$
    // Links: \href{url}{text} → [text](url) — encode tildes to %7E first
    .replace(/\\href\{([^}]*)\}\{([^}]*)\}/g, (_, url: string, text: string) => `[${text}](${url.replace(/~/g, '%7E')})`)
    // URL: \url{...} → just the URL (preserve tildes as %7E for URLs)
    .replace(/\\url\{([^}]*)\}/g, (_, url: string) => url.replace(/~/g, '%7E'))
    // Line breaks
    .replace(/\\\\/g, '  ')
    .replace(/\\newline/g, '  ')
    // Non-breaking space
    .replace(/~/g, ' ')
    // Dashes
    .replace(/---/g, '\u2014')  // em-dash
    .replace(/--/g, '\u2013')   // en-dash
    // Common LaTeX symbols
    .replace(/\\&/g, '&')
    .replace(/\\%/g, '%')
    .replace(/\\\$/g, '$')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\{/g, '{')
    .replace(/\\}/g, '}')
    .replace(/\\LaTeX/g, 'LaTeX')
    .replace(/\\TeX/g, 'TeX')
    .replace(/\\ldots/g, '...')
    .replace(/\\dots/g, '...')
    // Remove remaining unrecognized commands (just keep the argument)
    .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1')
    // Remove any remaining backslash commands
    .replace(/\\[a-zA-Z]+/g, '')
    // Clean up multiple spaces
    .replace(/  +/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// LaTeX → HTML (Parse LaTeX source and render as HTML)
// ---------------------------------------------------------------------------

/**
 * Convert LaTeX source to a self-contained HTML document.
 * Parses common LaTeX structures and renders them as formatted HTML.
 */
export function convertLatexToHtml(content: string, options?: HtmlConversionOptions): string {
  // Convert LaTeX → Markdown first, then Markdown → HTML
  // This leverages the existing Markdown → HTML converter
  const markdown = convertLatexToMarkdown(content);
  return convertMarkdownToHtml(markdown, options);
}

// ---------------------------------------------------------------------------
// LaTeX → Plain Text
// ---------------------------------------------------------------------------

/**
 * Convert LaTeX source to clean plain text.
 * Strips all LaTeX commands and extracts only the textual content.
 */
export function convertLatexToText(content: string): string {
  // Convert LaTeX → Markdown first, then Markdown → Text
  const markdown = convertLatexToMarkdown(content);
  return convertMarkdownToText(markdown);
}

// ---------------------------------------------------------------------------
// LaTeX → DOCX
// ---------------------------------------------------------------------------

/**
 * Convert LaTeX source to a DOCX file.
 * Uses the intermediate Markdown representation for conversion.
 */
export async function convertLatexToDocx(content: string, options?: HtmlConversionOptions): Promise<Buffer> {
  const markdown = convertLatexToMarkdown(content);
  return convertMarkdownToDocx(markdown, options);
}

// ---------------------------------------------------------------------------
// Markdown → LaTeX (Generate LaTeX source from Markdown)
// ---------------------------------------------------------------------------

/**
 * Convert Markdown content to LaTeX source format.
 * Generates a complete, compilable LaTeX document with proper
 * section structure, lists, tables, code blocks, and inline formatting.
 */
export function convertMarkdownToLatex(content: string): string {
  const lines = content.split(/\r?\n/);
  const body: string[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeLanguage = '';
  let title = 'Document';
  let hasInlineMath = false;
  let hasDisplayMath = false;
  let hasCode = false;
  let hasTables = false;
  let i = 0;

  // First pass: detect features for preamble
  for (const line of lines) {
    if (/\$[^$]+\$/.test(line)) hasInlineMath = true;
    if (/\$\$[\s\S]*?\$\$/.test(line)) hasDisplayMath = true;
    if (line.trimStart().startsWith('```')) hasCode = true;
    if (line.trim().includes('|') && line.trim().includes('---')) hasTables = true;
    const titleMatch = line.match(/^#\s+(.+)$/);
    if (titleMatch) title = titleMatch[1].trim();
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced code blocks
    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLanguage = trimmed.slice(3).trim();
        codeBlockLines = [];
      } else {
        inCodeBlock = false;
        if (codeLanguage === 'mermaid') {
          // Mermaid diagrams — output as a centered code block
          body.push('\\begin{center}');
          body.push('\\begin{minipage}{0.9\\textwidth}');
          body.push('\\begin{verbatim}');
          body.push(...codeBlockLines);
          body.push('\\end{verbatim}');
          body.push('\\end{minipage}');
          body.push('\\end{center}');
          body.push('');
        } else {
          body.push('\\begin{verbatim}');
          body.push(...codeBlockLines);
          body.push('\\end{verbatim}');
          body.push('');
        }
      }
      i++; continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      i++; continue;
    }

    // Blank line
    if (trimmed === '') {
      i++; continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = convertMdInlineToLatex(headingMatch[2]);
      switch (level) {
        case 1: body.push(`\\section{${text}}`); break;
        case 2: body.push(`\\subsection{${text}}`); break;
        case 3: body.push(`\\subsubsection{${text}}`); break;
        case 4: body.push(`\\paragraph{${text}}`); break;
        default: body.push(`\\paragraph{${text}}`); break;
      }
      body.push('');
      i++; continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(trimmed)) {
      body.push('\\noindent\\rule{\\textwidth}{0.4pt}');
      body.push('');
      i++; continue;
    }

    // Block quotes
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(convertMdInlineToLatex(lines[i].slice(2)));
        i++;
      }
      body.push('\\begin{quote}');
      for (const ql of quoteLines) {
        body.push(ql + ' \\\\');
      }
      body.push('\\end{quote}');
      body.push('');
      continue;
    }

    // Markdown table
    if (trimmed.includes('|') && i + 1 < lines.length && /^\|?\s*[-:]+[-|\s:]*$/.test(lines[i + 1].trim())) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().includes('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const parseRow = (l: string) =>
        l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

      const headers = parseRow(tableLines[0]);
      const dataRows = tableLines.slice(2).map(parseRow);
      const colCount = headers.length;

      // Calculate column spec
      const colSpec = Array(colCount).fill('l').join(' | ');

      body.push('\\begin{table}[htbp]');
      body.push('\\centering');
      body.push(`\\begin{tabular}{${colSpec}}`);
      body.push('\\hline');

      // Header row
      const headerCells = headers.map(h => `\\textbf{${convertMdInlineToLatex(h)}}`);
      body.push(headerCells.join(' & ') + ' \\\\');
      body.push('\\hline');

      // Data rows
      for (const row of dataRows) {
        const cells = [];
        for (let ci = 0; ci < colCount; ci++) {
          cells.push(convertMdInlineToLatex(row[ci] || ''));
        }
        body.push(cells.join(' & ') + ' \\\\');
      }
      body.push('\\hline');
      body.push('\\end{tabular}');
      body.push('\\end{table}');
      body.push('');
      continue;
    }

    // Unordered lists
    if (/^[\s]*[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*+]\s+/.test(lines[i])) {
        items.push(convertMdInlineToLatex(lines[i].replace(/^[\s]*[-*+]\s+/, '')));
        i++;
      }
      body.push('\\begin{itemize}');
      for (const item of items) {
        body.push(`  \\item ${item}`);
      }
      body.push('\\end{itemize}');
      body.push('');
      continue;
    }

    // Ordered lists
    if (/^[\s]*\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*\d+\.\s+/.test(lines[i])) {
        items.push(convertMdInlineToLatex(lines[i].replace(/^[\s]*\d+\.\s+/, '')));
        i++;
      }
      body.push('\\begin{enumerate}');
      for (const item of items) {
        body.push(`  \\item ${item}`);
      }
      body.push('\\end{enumerate}');
      body.push('');
      continue;
    }

    // Regular paragraph
    body.push(convertMdInlineToLatex(trimmed));
    body.push('');
    i++;
  }

  // Build complete LaTeX document
  const packages: string[] = [];
  if (hasInlineMath || hasDisplayMath) {
    packages.push('\\usepackage{amsmath}');
    packages.push('\\usepackage{amssymb}');
  }
  if (hasCode) {
    packages.push('\\usepackage{listings}');
  }
  if (hasTables) {
    packages.push('\\usepackage{booktabs}');
  }

  const doc = [
    '\\documentclass[12pt,a4paper]{article}',
    '',
    ...packages,
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{hyperref}',
    '\\usepackage{graphicx}',
    '\\usepackage{geometry}',
    '\\geometry{margin=1in}',
    '',
    hasCode ? '\\lstset{basicstyle=\\ttfamily\\small,breaklines=true,frame=single,backgroundcolor=\\color{gray!10}}' : '',
    '',
    `\\title{${convertMdInlineToLatex(title)}}`,
    `\\date{}`,
    '',
    '\\begin{document}',
    '\\maketitle',
    '',
    ...body,
    '\\end{document}',
  ].filter((line, idx, arr) => {
    // Remove double blank lines
    if (line === '' && idx > 0 && arr[idx - 1] === '') return false;
    return true;
  });

  return doc.join('\n') + '\n';
}

/** Convert Markdown inline formatting to LaTeX */
function convertMdInlineToLatex(text: string): string {
  if (!text) return '';

  // Extract display math ($$...$$) and inline math ($...$) BEFORE escaping
  const mathMap = new Map<string, { content: string; display: boolean }>();
  let mathIdx = 0;
  let processed = text
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
      const key = `MATH${mathIdx++}`;
      mathMap.set(key, { content: math.trim(), display: true });
      return key;
    })
    .replace(/\$([^\$]+?)\$/g, (_, math) => {
      const key = `MATH${mathIdx++}`;
      mathMap.set(key, { content: math.trim(), display: false });
      return key;
    });

  // Escape LaTeX special characters
  processed = processed
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    // Bold: **text** → \textbf{text}
    .replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}')
    // Italic: *text* → \textit{text}
    .replace(/\*(.+?)\*/g, '\\textit{$1}')
    // Strikethrough: ~~text~~ → \sout{text}
    .replace(/~~(.+?)~~/g, '\\sout{$1}')
    // Inline code: `text` → \texttt{text}
    .replace(/`(.+?)`/g, '\\texttt{$1}')
    // Images: ![alt](url) → \includegraphics{url}
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '\\includegraphics[width=0.8\\textwidth]{$2}')
    // Links: [text](url) → \href{url}{text}
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '\\href{$2}{$1}');

  // Restore math expressions from placeholders
  processed = processed.replace(/MATH(\d+)/g, (_, idx) => {
    const key = `MATH${idx}`;
    const entry = mathMap.get(key);
    if (!entry) return key;
    return entry.display ? `\\[${entry.content}\\]` : `\\(${entry.content}\\)`;
  });

  return processed.trim();
}

// ---------------------------------------------------------------------------
// CSV → LaTeX (Generate LaTeX tabular from CSV)
// ---------------------------------------------------------------------------

/**
 * Convert CSV content to a LaTeX document with a table.
 * Generates a compilable LaTeX document with proper tabular environment.
 */
export function convertCsvToLatex(content: string): string {
  const rows = parseCSVRows(content);
  if (rows.length === 0) {
    return '\\documentclass{article}\n\\begin{document}\nNo data\n\\end{document}\n';
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const colCount = Math.max(...rows.map(r => r.length));
  const colSpec = Array(colCount).fill('l').join(' | ');

  const tableLines: string[] = [];
  tableLines.push('\\begin{table}[htbp]');
  tableLines.push('\\centering');
  tableLines.push(`\\begin{tabular}{${colSpec}}`);
  tableLines.push('\\hline');

  // Header row
  const headerCells = headers.slice(0, colCount).map(h => `\\textbf{${escapeLatex(h || '')}}`);
  while (headerCells.length < colCount) headerCells.push('');
  tableLines.push(headerCells.join(' & ') + ' \\\\');
  tableLines.push('\\hline');

  // Data rows
  for (const row of dataRows) {
    const cells: string[] = [];
    for (let ci = 0; ci < colCount; ci++) {
      cells.push(escapeLatex(ci < row.length ? row[ci] : ''));
    }
    tableLines.push(cells.join(' & ') + ' \\\\');
  }
  tableLines.push('\\hline');
  tableLines.push('\\end{tabular}');
  tableLines.push('\\end{table}');

  const title = escapeLatex(headers[0] || 'CSV Data');

  return [
    '\\documentclass[12pt,a4paper]{article}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{booktabs}',
    '\\usepackage{geometry}',
    '\\geometry{margin=1in}',
    '',
    `\\title{${title}}`,
    `\\date{}`,
    '',
    '\\begin{document}',
    '\\maketitle',
    '',
    ...tableLines,
    '',
    '\\end{document}',
  ].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Plain Text → LaTeX (Generate LaTeX from plain text)
// ---------------------------------------------------------------------------

/**
 * Convert plain text to a LaTeX document.
 * Wraps paragraphs in proper LaTeX formatting.
 */
export function convertTxtToLatex(content: string): string {
  // Convert txt → md first, then md → latex
  const markdown = convertTxtToMarkdown(content);
  return convertMarkdownToLatex(markdown);
}

// ---------------------------------------------------------------------------
// DOCX conversion (via mammoth)
// ---------------------------------------------------------------------------

/**
 * Convert a .docx file to Markdown using mammoth.
 * @param contentOrPath  .docx file content (Buffer) or file path (string)
 */
export async function convertDocxToMarkdown(contentOrPath: Buffer | string): Promise<string> {
    let result;
    if (Buffer.isBuffer(contentOrPath)) {
      result = await (mammoth as any).convertToMarkdown({ buffer: contentOrPath });
    } else {
      result = await (mammoth as any).convertToMarkdown({ path: contentOrPath });
    }
  return result.value;
}

/**
 * Convert DOCX to plain text via Markdown.
 */
export async function convertDocxToText(contentOrPath: Buffer | string): Promise<string> {
  return convertMarkdownToText(await convertDocxToMarkdown(contentOrPath));
}

/**
 * Convert DOCX to HTML via mammoth (native HTML output, not via Markdown).
 */
export async function convertDocxToHtml(contentOrPath: Buffer | string): Promise<string> {
  let result;
  if (Buffer.isBuffer(contentOrPath)) {
    result = await mammoth.convertToHtml({ buffer: contentOrPath });
  } else {
    result = await mammoth.convertToHtml({ path: contentOrPath });
  }
  return result.value;
}

/**
 * Convert DOCX to LaTeX via the path: docx → Markdown → LaTeX
 */
export async function convertDocxToLatex(contentOrPath: Buffer | string): Promise<string> {
  const md = await convertDocxToMarkdown(contentOrPath);
  return convertMarkdownToLatex(md);
}

/** Escape special LaTeX characters */
function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

// ---------------------------------------------------------------------------
// LaTeX → PDF
// ---------------------------------------------------------------------------

/**
 * Convert LaTeX source to PDF.
 * Tries system pdflatex first; falls back to HTML→PDF via pdfkit if unavailable.
 */
export async function convertLatexToPdf(
  content: string,
  outputDir: string,
  sourcePath: string,
  htmlOptions?: HtmlConversionOptions,
): Promise<Buffer> {
  // Check if pdflatex is available on the system
  try {
    execFileSync('pdflatex', ['--version'], { stdio: 'ignore', timeout: 5000 });
    // pdflatex is available — compile the LaTeX to PDF
    const baseName = path.basename(sourcePath, path.extname(sourcePath));
    const texFile = path.join(outputDir, `${baseName}.tex`);
    await fs.promises.writeFile(texFile, content, 'utf-8');

    const sanitizedOutputDir = path.resolve(outputDir);
    const sanitizedTexFile = path.resolve(texFile);
    execFileSync('pdflatex', ['-interaction=nonstopmode', `-output-directory=${sanitizedOutputDir}`, sanitizedTexFile], {
      stdio: 'ignore',
      timeout: 30000,
    });
    execFileSync('pdflatex', ['-interaction=nonstopmode', `-output-directory=${sanitizedOutputDir}`, sanitizedTexFile], {
      stdio: 'ignore',
      timeout: 30000,
    });

    const pdfFile = path.join(outputDir, `${baseName}.pdf`);
    const pdfBuffer = await fs.promises.readFile(pdfFile);

    // Clean up temporary .tex, .aux, .log files
    try {
      await fs.promises.unlink(texFile);
      await fs.promises.unlink(path.join(outputDir, `${baseName}.aux`));
      await fs.promises.unlink(path.join(outputDir, `${baseName}.log`));
    } catch { /* cleanup is best-effort */ }

    return pdfBuffer;
  } catch {
    // pdflatex not available — fall back to HTML → PDF via pdfkit
    logger.warn('pdflatex not found, falling back to HTML→PDF via pdfkit');
    return convertLatexToPdfViaHtml(content, outputDir, sourcePath, htmlOptions);
  }
}

/**
 * Fallback: Convert LaTeX → PDF using pdfkit with HTML-aware formatting.
 * Parses basic HTML tags (h1-h6, p, strong, em, code, ul, ol, li, br) and
 * applies corresponding pdfkit formatting commands to preserve document structure.
 */
async function convertLatexToPdfViaHtml(
  content: string,
  outputDir: string,
  sourcePath: string,
  htmlOptions?: HtmlConversionOptions,
): Promise<Buffer> {
  const html = convertLatexToHtml(content, htmlOptions);

  const baseName = path.basename(sourcePath, path.extname(sourcePath));

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    registerPdfkitFonts(doc);

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).font('Helvetica-Bold').text(baseName, { align: 'center' });
    doc.moveDown();

    // Strip script/style content, then parse HTML into pdfkit formatting
    let cleanHtml = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Decode HTML entities
    cleanHtml = cleanHtml
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Parse block-level elements and render with appropriate formatting
    const blocks = cleanHtml.split(/(<\/?(?:h[1-6]|p|ul|ol|li|pre|blockquote|hr|br)[^>]*>)/gi);
    let inList = false;
    let listOrdered = false;
    let listCounter = 0;

    for (const block of blocks) {
      const lower = block.toLowerCase().trim();
      if (!lower) continue;

      if (lower.startsWith('<h1')) { doc.fontSize(18).font('Helvetica-Bold'); continue; }
      if (lower.startsWith('<h2')) { doc.fontSize(16).font('Helvetica-Bold'); continue; }
      if (lower.startsWith('<h3')) { doc.fontSize(14).font('Helvetica-Bold'); continue; }
      if (lower.startsWith('<h4')) { doc.fontSize(12).font('Helvetica-Bold'); continue; }
      if (lower.startsWith('<h5') || lower.startsWith('<h6')) { doc.fontSize(11).font('Helvetica-Bold'); continue; }
      if (lower.startsWith('</h1') || lower.startsWith('</h2') || lower.startsWith('</h3') ||
          lower.startsWith('</h4') || lower.startsWith('</h5') || lower.startsWith('</h6')) {
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(11);
        continue;
      }
      if (lower.startsWith('<p')) { doc.font('Helvetica').fontSize(11); continue; }
      if (lower.startsWith('</p>')) { doc.moveDown(0.3); continue; }
      if (lower.startsWith('<ul')) { inList = true; listOrdered = false; continue; }
      if (lower.startsWith('</ul>')) { inList = false; doc.moveDown(0.3); continue; }
      if (lower.startsWith('<ol')) { inList = true; listOrdered = true; listCounter = 1; continue; }
      if (lower.startsWith('</ol>')) { inList = false; doc.moveDown(0.3); continue; }
      if (lower.startsWith('<li')) {
        if (inList) {
          const prefix = listOrdered ? `${listCounter}. ` : '- ';
          if (listOrdered) listCounter++;
          doc.font('Helvetica').fontSize(11);
          doc.text(prefix, { indent: 20, continued: false });
        }
        continue;
      }
      if (lower.startsWith('</li>')) { continue; }
      if (lower.startsWith('<pre')) { doc.font('Courier').fontSize(9); continue; }
      if (lower.startsWith('</pre>')) { doc.moveDown(0.3); doc.font('Helvetica').fontSize(11); continue; }
      if (lower.startsWith('<blockquote')) {
        doc.font('Helvetica-Oblique').fontSize(10);
        continue;
      }
      if (lower.startsWith('</blockquote>')) { doc.moveDown(0.3); doc.font('Helvetica').fontSize(11); continue; }
      if (lower.startsWith('<hr')) {
        doc.moveDown(0.5);
        const y = doc.y;
        doc.moveTo(50, y).lineTo(doc.page.width - 50, y).stroke();
        doc.moveDown(0.5);
        continue;
      }
      if (lower.startsWith('<br')) { doc.moveDown(0.2); continue; }

      // Text content — apply inline formatting
      const text = block
        .replace(/<strong>|<\/strong>/gi, '')
        .replace(/<b>|<\/b>/gi, '')
        .replace(/<em>|<\/em>/gi, '')
        .replace(/<i>|<\/i>/gi, '')
        .replace(/<code>|<\/code>/gi, '')
        .replace(/<[^>]+>/g, '')
        .trim();

      if (text) {
        doc.text(text, { align: 'left' });
      }
    }

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Generic convertFile
// ---------------------------------------------------------------------------

/**
 * Convert a source file to a different format and write the output to disk.
 *
 * @param sourcePath  Absolute path to the source file
 * @param sourceFormat Detected format of the source file
 * @param targetFormat Desired output format
 * @param outputDir   Directory where the converted file will be written
 * @param htmlOptions Optional settings for HTML output
 * @returns ConversionResult with success/failure info and output path
 */
export async function convertFile(
  sourcePath: string,
  sourceFormat: SourceFormat,
  targetFormat: TargetFormat,
  outputDir: string,
  htmlOptions?: HtmlConversionOptions,
): Promise<ConversionResult> {
  const startTime = Date.now();

  try {
    // Validate: source format must differ from target (except CSV re-formatting)
    if (sourceFormat === targetFormat && sourceFormat !== 'csv') {
      return fail(sourcePath, targetFormat, startTime, 'Source and target formats are the same — no conversion needed.');
    }

    // Validate: conversion is supported
    const conversionKey = `${sourceFormat}->${targetFormat}`;
    const supportedConversions: Record<string, boolean> = {
      'md->txt': true,
      'md->html': true,
      'md->csv': true,
      'md->docx': true,
      'md->latex': true,
      'csv->txt': true,
      'csv->md': true,
      'csv->html': true,
      'csv->docx': true,
      'csv->csv': true,
      'csv->latex': true,
      'txt->md': true,
      'txt->html': true,
      'txt->csv': true,
      'txt->docx': true,
      'txt->latex': true,
      'mermaid->txt': true,
      'mermaid->md': true,
      'mermaid->html': true,
      'mermaid->csv': true,
      'latex->md': true,
      'latex->html': true,
      'latex->txt': true,
      'latex->docx': true,
      'latex->pdf': true,
      'docx->txt': true,
      'docx->md': true,
      'docx->html': true,
      'docx->csv': true,
      'docx->latex': true,
      'docx->pdf': true,
    };

    if (!supportedConversions[conversionKey]) {
      return fail(sourcePath, targetFormat, startTime, `Conversion ${sourceFormat} → ${targetFormat} is not supported. Supported: md→txt/html/csv/docx/latex, csv→txt/md/html/docx/csv/latex, txt→md/html/csv/docx/latex, mermaid→txt/md/html/csv, latex→md/html/txt/docx/pdf, docx→txt/md/html/csv/latex/pdf`);
    }

    // Read source file (DOCX is binary, others are UTF-8 text)
    const isBinarySource = sourceFormat === 'docx';
    const content = isBinarySource
      ? await fs.promises.readFile(sourcePath)
      : await fs.promises.readFile(sourcePath, 'utf-8');

    // Convert
    let converted: string | Buffer;
    switch (conversionKey) {
      case 'md->txt':
        converted = convertMarkdownToText(content as string);
        break;
      case 'md->html':
        converted = convertMarkdownToHtml(content as string, htmlOptions);
        break;
      case 'md->csv':
        converted = convertMarkdownToCsv(content as string);
        break;
      case 'md->docx':
        converted = await convertMarkdownToDocx(content as string, htmlOptions);
        break;
      case 'csv->txt':
        converted = convertCsvToText(content as string);
        break;
      case 'csv->md':
        converted = convertCsvToMarkdown(content as string);
        break;
      case 'csv->html':
        converted = convertCsvToHtml(content as string, htmlOptions);
        break;
      case 'csv->docx':
        converted = await convertCsvToDocx(content as string, htmlOptions);
        break;
      case 'csv->csv':
        converted = convertCsvToCsv(content as string);
        break;
      case 'txt->md':
        converted = convertTxtToMarkdown(content as string);
        break;
      case 'txt->html':
        converted = convertMarkdownToHtml(convertTxtToMarkdown(content as string), htmlOptions);
        break;
      case 'txt->csv':
        converted = convertTxtToCsv(content as string);
        break;
      case 'txt->docx':
        converted = await convertMarkdownToDocx(convertTxtToMarkdown(content as string), htmlOptions);
        break;
      case 'mermaid->txt':
        converted = convertMermaidToText(content as string);
        break;
      case 'mermaid->md':
        converted = '```mermaid\n' + (content as string) + '\n```\n';
        break;
      case 'mermaid->html':
        converted = convertMermaidToHtml(content as string, htmlOptions);
        break;
      case 'mermaid->csv':
        converted = convertMermaidToCsv(content as string);
        break;
      // --- LaTeX as source ---
      case 'latex->md':
        converted = convertLatexToMarkdown(content as string);
        break;
      case 'latex->html':
        converted = convertLatexToHtml(content as string, htmlOptions);
        break;
      case 'latex->txt':
        converted = convertLatexToText(content as string);
        break;
      case 'latex->docx':
        converted = await convertLatexToDocx(content as string, htmlOptions);
        break;
      case 'latex->pdf':
        // LaTeX → PDF: try system pdflatex first, fall back to HTML→print
        converted = await convertLatexToPdf(content as string, outputDir, sourcePath, htmlOptions);
        break;
      // --- LaTeX as target ---
      case 'md->latex':
        converted = convertMarkdownToLatex(content as string);
        break;
      case 'csv->latex':
        converted = convertCsvToLatex(content as string);
        break;
      case 'txt->latex':
        converted = convertTxtToLatex(content as string);
        break;
      // --- DOCX as source ---
      case 'docx->txt':
        converted = await convertDocxToText(content as Buffer);
        break;
      case 'docx->md':
        converted = await convertDocxToMarkdown(content as Buffer);
        break;
      case 'docx->html':
        converted = await convertDocxToHtml(content as Buffer);
        break;
      case 'docx->csv':
        // DOCX→CSV: convert to markdown first, then to CSV
        converted = convertMarkdownToCsv(await convertDocxToMarkdown(content as Buffer));
        break;
      case 'docx->latex':
        converted = await convertDocxToLatex(content as Buffer);
        break;
      case 'docx->pdf':
        converted = await convertLatexToPdf(
          await convertDocxToLatex(content as Buffer),
          outputDir,
          sourcePath,
        );
        break;
      default:
        return fail(sourcePath, targetFormat, startTime, `No handler for ${conversionKey}`);
    }

    // Determine output filename
    const baseName = path.basename(sourcePath, path.extname(sourcePath));
    const sanitized = sanitizeFilename(baseName);
    const extensionMap: Record<string, string> = { txt: 'txt', html: 'html', md: 'md', docx: 'docx', csv: 'csv', latex: 'tex', pdf: 'pdf' };
    const extension = extensionMap[targetFormat] || targetFormat;
    const filename = getUniqueFilename(outputDir, sanitized, extension, (p) => fs.existsSync(p));
    const outputPath = path.join(outputDir, filename);

    // Ensure output directory exists
    await fs.promises.mkdir(outputDir, { recursive: true });

    // Write output (Buffer for binary formats like DOCX, string for text formats)
    const buffer = Buffer.isBuffer(converted) ? converted : Buffer.from(converted, 'utf-8');
    await fs.promises.writeFile(outputPath, buffer);

    const duration = Date.now() - startTime;
    logger.info(`Converted ${sourcePath} (${sourceFormat}) → ${outputPath} (${targetFormat}) in ${duration}ms`);

    return {
      success: true,
      outputPath,
      targetFormat,
      fileSize: buffer.length,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Conversion failed: ${message}`);
    return fail(sourcePath, targetFormat, duration, message);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function fail(sourcePath: string, targetFormat: TargetFormat, startTime: number, message: string): ConversionResult {
  return {
    success: false,
    outputPath: '',
    targetFormat,
    fileSize: 0,
    duration: Date.now() - startTime,
    error: message,
  };
}

/** Strip inline markdown formatting from a string */
function stripInline(text: string): string {
  return text
    // Images: ![alt](url) → [Image: alt]
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => `[Image: ${alt}]`)
    // Links: [text](url) → text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Reference links: [text][ref] → text
    .replace(/\[([^\]]*)\]\[([^\]]*)\]/g, '$1')
    // Bold: **text** or __text__ → text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    // Italic: *text* or _text_ → text
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    // Strikethrough: ~~text~~ → text
    .replace(/~~(.+?)~~/g, '$1')
    // Inline code: `text` → text
    .replace(/`(.+?)`/g, '$1')
    // Remove any remaining HTML tags
    .replace(/<[^>]+>/g, '');
}

/** Apply inline markdown → HTML conversions */
function applyInlineHtml(text: string): string {
  return escapeHtml(text)
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Strikethrough
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    // Inline code
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // Images
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '<img src="$2" alt="$1" />')
    // Links
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '<a href="$2">$1</a>');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Format a row of cells with given column widths */
function formatRow(cells: string[], widths: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < widths.length; i++) {
    const cell = i < cells.length ? cells[i] : '';
    parts.push(cell.padEnd(widths[i]));
  }
  return parts.join('  ');
}

/** Collapse 3+ consecutive blank lines into 2 */
function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}
