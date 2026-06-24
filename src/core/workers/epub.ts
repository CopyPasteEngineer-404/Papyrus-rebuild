import fs from 'fs/promises';
import path from 'path';
import EPub from 'epub-gen';
import { WorkerInput, WorkerResult, GeneratedArtifact, IRDocument, IRBlockNode, IRSectionNode, IRParagraphNode, IRListNode, IRTableNode, IRCodeNode, IRQuoteNode, IRMathNode, IRImageNode, IRInlineNode } from '../../shared/types';
import { generateId, formatFileSize, sanitizeFilename } from '../../shared/utils';
import type { Worker } from '../registry';
import { walkIR, findNodesByType } from '../ir/traversal';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineNodesHtml(nodes: IRInlineNode[]): string {
  return nodes.map(node => {
    switch (node.type) {
      case 'inline-text':
        return escapeHtml(node.content);
      case 'inline-bold':
        return `<strong>${renderInlineNodesHtml(node.children)}</strong>`;
      case 'inline-italic':
        return `<em>${renderInlineNodesHtml(node.children)}</em>`;
      case 'inline-code':
        return `<code>${escapeHtml(node.content)}</code>`;
      case 'inline-link':
        return `<a href="${escapeHtml(node.href)}">${renderInlineNodesHtml(node.children)}</a>`;
      case 'inline-strikethrough':
        return `<del>${renderInlineNodesHtml(node.children)}</del>`;
      default:
        return '';
    }
  }).join('');
}

function renderInlineHtml(text: string, inline?: IRInlineNode[]): string {
  if (inline && inline.length > 0) {
    return renderInlineNodesHtml(inline);
  }
  return renderInlineTextHtml(text);
}

function renderInlineTextHtml(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== '`') j++;
      const inner = text.slice(i + 1, j);
      result += `<code>${escapeHtml(inner)}</code>`;
      i = j + 1;
      continue;
    }
    if (text[i] === '*' && text[i + 1] === '*') {
      let j = i + 2;
      while (j < text.length - 1 && !(text[j] === '*' && text[j + 1] === '*')) j++;
      const inner = text.slice(i + 2, j);
      result += `<strong>${renderInlineTextHtml(inner)}</strong>`;
      i = j + 2;
      continue;
    }
    if (text[i] === '*') {
      let j = i + 1;
      while (j < text.length && text[j] !== '*') j++;
      const inner = text.slice(i + 1, j);
      result += `<em>${renderInlineTextHtml(inner)}</em>`;
      i = j + 1;
      continue;
    }
    if (text[i] === '[' && text.indexOf('](', i) !== -1) {
      const linkEnd = text.indexOf(']', i);
      const hrefStart = text.indexOf('(', linkEnd);
      const hrefEnd = text.indexOf(')', hrefStart);
      if (linkEnd !== -1 && hrefStart !== -1 && hrefEnd !== -1) {
        const label = text.slice(i + 1, linkEnd);
        const href = text.slice(hrefStart + 1, hrefEnd);
        result += `<a href="${escapeHtml(href)}">${renderInlineTextHtml(label)}</a>`;
        i = hrefEnd + 1;
        continue;
      }
    }
    result += escapeHtml(text[i]);
    i++;
  }
  return result;
}

function renderNodeHtml(node: IRBlockNode): string {
  switch (node.type) {
    case 'section':
      return renderSectionHtml(node as IRSectionNode);
    case 'paragraph':
      return renderParagraphHtml(node as IRParagraphNode);
    case 'list':
      return renderListHtml(node as IRListNode);
    case 'table':
      return renderTableHtml(node as IRTableNode);
    case 'code':
      return renderCodeHtml(node as IRCodeNode);
    case 'quote':
      return renderQuoteHtml(node as IRQuoteNode);
    case 'math':
      return renderMathHtml(node as IRMathNode);
    case 'image':
      return renderImageHtml(node as IRImageNode);
    case 'pageBreak':
      return '<hr class="page-break" />';
    case 'toc':
      return '<nav id="toc"><h2>Table of Contents</h2></nav>';
    default:
      return '';
  }
}

function renderSectionHtml(node: IRSectionNode): string {
  const tag = node.level <= 2 ? `h${node.level}` : `h${Math.min(node.level, 6)}`;
  const lines: string[] = [`<${tag}>${renderInlineHtml(node.title)}</${tag}>\n`];
  for (const child of node.children) {
    lines.push(renderNodeHtml(child));
  }
  return lines.join('\n');
}

function renderParagraphHtml(node: IRParagraphNode): string {
  return `<p>${renderInlineHtml(node.content, node.inline)}</p>\n`;
}

function renderListHtml(node: IRListNode): string {
  const tag = node.ordered ? 'ol' : 'ul';
  const lines: string[] = [`<${tag}>\n`];
  for (const item of node.items) {
    lines.push(`  <li>${renderInlineHtml(item.content, item.inline)}</li>\n`);
    if (item.children) {
      for (const child of item.children) {
        lines.push(`    ${renderNodeHtml(child)}`);
      }
    }
  }
  lines.push(`</${tag}>\n`);
  return lines.join('\n');
}

function renderTableHtml(node: IRTableNode): string {
  const lines: string[] = ['<table>\n', '  <thead>\n    <tr>\n'];
  for (const h of node.headers) {
    lines.push(`      <th>${renderInlineHtml(h)}</th>\n`);
  }
  lines.push('    </tr>\n  </thead>\n  <tbody>\n');
  for (const row of node.rows) {
    lines.push('    <tr>\n');
    for (const cell of row) {
      lines.push(`      <td>${renderInlineHtml(cell)}</td>\n`);
    }
    lines.push('    </tr>\n');
  }
  lines.push('  </tbody>\n</table>\n');
  return lines.join('\n');
}

function renderCodeHtml(node: IRCodeNode): string {
  const lang = node.language ? ` class="language-${escapeHtml(node.language)}"` : '';
  return `<pre><code${lang}>${escapeHtml(node.content)}</code></pre>\n`;
}

function renderQuoteHtml(node: IRQuoteNode): string {
  let html = '<blockquote>\n';
  html += `  <p>${renderInlineHtml(node.content, node.inline)}</p>\n`;
  if (node.author) {
    html += `  <footer>— ${renderInlineHtml(node.author)}</footer>\n`;
  }
  html += '</blockquote>\n';
  return html;
}

function renderMathHtml(node: IRMathNode): string {
  if (node.inline) {
    return `<span class="math inline">${escapeHtml(node.content)}</span>`;
  }
  return `<div class="math display">${escapeHtml(node.content)}</div>\n`;
}

function renderImageHtml(node: IRImageNode): string {
  const alt = node.alt ? escapeHtml(node.alt) : '';
  const attrs: string[] = [];
  if (node.width) attrs.push(`width="${node.width}"`);
  if (node.height) attrs.push(`height="${node.height}"`);
  const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
  return `<figure>\n  <img src="${escapeHtml(node.src)}" alt="${alt}"${attrStr} />\n` +
    (node.alt ? `  <figcaption>${renderInlineHtml(node.alt)}</figcaption>\n` : '') +
    '</figure>\n';
}

function extractChapters(ir: IRDocument): IRSectionNode[] {
  const chapters: IRSectionNode[] = [];
  for (const child of ir.children) {
    if (child.type === 'section') {
      chapters.push(child as IRSectionNode);
    }
  }
  if (chapters.length === 0) {
    chapters.push({
      id: generateId(),
      type: 'section',
      level: 1,
      title: ir.title || 'Document',
      children: ir.children,
    });
  }
  return chapters;
}

function renderChapterHtml(chapter: IRSectionNode): string {
  const lines: string[] = [];
  lines.push(`<h1>${escapeHtml(chapter.title)}</h1>\n`);
  for (const child of chapter.children) {
    lines.push(renderNodeHtml(child));
  }
  return lines.join('\n');
}

function renderBodyHtml(ir: IRDocument): string {
  const lines: string[] = [];
  lines.push('<html><head>\n');
  lines.push('<style>\n');
  lines.push('body { font-family: serif; margin: 1em; }\n');
  lines.push('pre { background: #f5f5f5; padding: 0.5em; overflow-x: auto; }\n');
  lines.push('code { background: #f5f5f5; padding: 0.1em 0.3em; }\n');
  lines.push('table { border-collapse: collapse; width: 100%; }\n');
  lines.push('th, td { border: 1px solid #ccc; padding: 0.5em; text-align: left; }\n');
  lines.push('blockquote { border-left: 3px solid #ccc; margin-left: 1em; padding-left: 1em; color: #555; }\n');
  lines.push('img { max-width: 100%; height: auto; }\n');
  lines.push('.math { font-style: italic; }\n');
  lines.push('.page-break { page-break-after: always; }\n');
  lines.push('</style>\n');
  lines.push('</head><body>\n');

  for (const child of ir.children) {
    lines.push(renderNodeHtml(child));
  }

  lines.push('</body></html>\n');
  return lines.join('\n');
}

export const EPUBWorker: Worker = {
  id: 'epub',
  name: 'EPUB',
  formats: ['epub'],

  async execute(input: WorkerInput): Promise<WorkerResult> {
    const start = performance.now();
    const artifacts: GeneratedArtifact[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const { ir, outputDir } = input;
      const title = ir.title || 'Untitled Document';

      const chapters = extractChapters(ir);
      const content = chapters.map((ch) => ({
        title: ch.title,
        data: renderChapterHtml(ch),
      }));

      const baseName = sanitizeFilename(title.replace(/\s+/g, '_').toLowerCase());
      const filename = `${baseName}.epub`;
      const filePath = path.join(outputDir, filename);

      await fs.mkdir(outputDir, { recursive: true });

      const options = {
        title,
        author: (ir.frontmatter?.author as string) || 'Unknown',
        publisher: (ir.frontmatter?.publisher as string) || 'Papyrus',
        date: new Date().toISOString().split('T')[0],
        css: 'body { font-family: serif; margin: 1em; } pre { background: #f5f5f5; padding: 0.5em; } table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #ccc; padding: 0.5em; }',
        fonts: [] as string[],
        customFiles: [] as string[],
        content,
        verbose: false,
      };

      const book = new EPub(options, filePath);

      // epub-gen uses an internal Q promise — await it for completion
      await (book as any).promise;

      const fileData = await fs.readFile(filePath);
      const data = new Uint8Array(fileData);
      artifacts.push({
        filename,
        data,
        format: 'epub',
        size: data.byteLength,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
    }

    const duration = performance.now() - start;
    return { success: errors.length === 0, artifacts, errors, warnings, duration };
  },
};
