import fs from 'fs/promises';
import path from 'path';
import { WorkerInput, WorkerResult, GeneratedArtifact, IRDocument, IRBlockNode, IRSectionNode, IRParagraphNode, IRListNode, IRTableNode, IRCodeNode, IRQuoteNode, IRMathNode, IRImageNode, IRFootnoteNode, IRReferenceNode, IRInlineNode } from '../../shared/types';
import { generateId, formatFileSize, sanitizeFilename } from '../../shared/utils';
import type { Worker } from '../registry';
import { walkIR, findNodesByType } from '../ir/traversal';

function escapeLatex(text: string): string {
  return text
    .replace(/([&%$#_{}~^])/g, '\\$1')
    .replace(/\\/g, '\\textbackslash{}');
}

function renderInlineNodes(nodes: IRInlineNode[]): string {
  return nodes.map(node => {
    switch (node.type) {
      case 'inline-text':
        return escapeLatex(node.content);
      case 'inline-bold':
        return `\\textbf{${renderInlineNodes(node.children)}}`;
      case 'inline-italic':
        return `\\textit{${renderInlineNodes(node.children)}}`;
      case 'inline-code':
        return `\\texttt{${escapeLatex(node.content)}}`;
      case 'inline-link':
        return `\\href{${node.href}}{${renderInlineNodes(node.children)}}`;
      case 'inline-strikethrough':
        return `\\sout{${renderInlineNodes(node.children)}}`;
      default:
        return '';
    }
  }).join('');
}

function renderInline(text: string, inline?: IRInlineNode[]): string {
  if (inline && inline.length > 0) {
    return renderInlineNodes(inline);
  }
  return renderInlineText(text);
}

function renderInlineText(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\\') {
      const next = text[i + 1];
      if (next === '`' || next === "'" || next === '"') {
        result += '\\`';
        i += 2;
        continue;
      }
    }
    if (text[i] === '`' && text[i + 1] === '`') {
      result += '``';
      i += 2;
      continue;
    }
    if (text[i] === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== '`') j++;
      const inner = text.slice(i + 1, j);
      result += `\\texttt{${escapeLatex(inner)}}`;
      i = j + 1;
      continue;
    }
    if (text[i] === '*') {
      if (text[i + 1] === '*') {
        let j = i + 2;
        while (j < text.length - 1 && !(text[j] === '*' && text[j + 1] === '*')) j++;
        const inner = text.slice(i + 2, j);
        result += `\\textbf{${renderInlineText(inner)}}`;
        i = j + 2;
        continue;
      } else {
        let j = i + 1;
        while (j < text.length && text[j] !== '*') j++;
        const inner = text.slice(i + 1, j);
        result += `\\textit{${renderInlineText(inner)}}`;
        i = j + 1;
        continue;
      }
    }
    result += text[i];
    i++;
  }
  return result;
}

function renderNode(node: IRBlockNode): string {
  switch (node.type) {
    case 'section':
      return renderSection(node as IRSectionNode);
    case 'paragraph':
      return renderParagraph(node as IRParagraphNode);
    case 'list':
      return renderList(node as IRListNode);
    case 'table':
      return renderTable(node as IRTableNode);
    case 'code':
      return renderCode(node as IRCodeNode);
    case 'quote':
      return renderQuote(node as IRQuoteNode);
    case 'math':
      return renderMath(node as IRMathNode);
    case 'image':
      return renderImage(node as IRImageNode);
    case 'footnote':
      return renderFootnote(node as IRFootnoteNode);
    case 'reference':
      return renderReference(node as IRReferenceNode);
    case 'pageBreak':
      return '\\newpage\n';
    case 'toc':
      return '\\tableofcontents\n';
    default:
      return '';
  }
}

function renderSection(node: IRSectionNode): string {
  const env = node.level <= 2 ? 'section' : node.level === 3 ? 'subsection' : 'subsubsection';
  const lines: string[] = [];
  if (node.level <= 2) {
    lines.push(`\\${env}{${renderInline(node.title)}}\n`);
  } else {
    lines.push(`\\${env}{${renderInline(node.title)}}\n`);
  }
  for (const child of node.children) {
    lines.push(renderNode(child));
  }
  return lines.join('\n');
}

function renderParagraph(node: IRParagraphNode): string {
  return `${renderInline(node.content, node.inline)}\n`;
}

function renderList(node: IRListNode): string {
  const env = node.ordered ? 'enumerate' : 'itemize';
  const lines: string[] = [`\\begin{${env}}\n`];
  for (const item of node.items) {
    lines.push(`  \\item ${renderInline(item.content, item.inline)}\n`);
    if (item.children) {
      for (const child of item.children) {
        lines.push(renderNode(child));
      }
    }
  }
  lines.push(`\\end{${env}}\n`);
  return lines.join('\n');
}

function renderTable(node: IRTableNode): string {
  const cols = node.headers.length;
  const colSpec = 'l'.repeat(cols);
  const lines: string[] = [
    `\\begin{tabular}{${colSpec}}\n`,
    `  \\toprule\n`,
    `  ${node.headers.map(h => renderInline(h)).join(' & ')} \\\\\n`,
    `  \\midrule\n`,
  ];
  for (const row of node.rows) {
    lines.push(`  ${row.map(c => renderInline(c)).join(' & ')} \\\\\n`);
  }
  lines.push(`  \\bottomrule\n`);
  lines.push(`\\end{tabular}\n`);
  return lines.join('\n');
}

function renderCode(node: IRCodeNode): string {
  const lang = node.language || '';
  const langParam = lang ? `[language=${lang}]` : '';
  return `\\begin{lstlisting}${langParam}\n${node.content}\n\\end{lstlisting}\n`;
}

function renderQuote(node: IRQuoteNode): string {
  const lines: string[] = ['\\begin{quote}\n'];
  lines.push(`${renderInline(node.content, node.inline)}\n`);
  if (node.author) {
    lines.push(`\\hfill --- ${renderInline(node.author)}\n`);
  }
  lines.push('\\end{quote}\n');
  return lines.join('\n');
}

function renderMath(node: IRMathNode): string {
  if (node.inline) {
    return `$${node.content}$\n`;
  }
  return `\\[\n${node.content}\n\\]\n`;
}

function renderImage(node: IRImageNode): string {
  const lines: string[] = ['\\begin{figure}[htbp]\n', '  \\centering\n'];
  const opts: string[] = [];
  if (node.width) opts.push(`width=${node.width}pt`);
  if (node.height) opts.push(`height=${node.height}pt`);
  const optStr = opts.length > 0 ? `[${opts.join(', ')}]` : '';
  lines.push(`  \\includegraphics${optStr}{${node.src}}\n`);
  if (node.alt) {
    lines.push(`  \\caption{${renderInline(node.alt)}}\n`);
  }
  lines.push('\\end{figure}\n');
  return lines.join('\n');
}

function renderFootnote(node: IRFootnoteNode): string {
  return `\\footnote{${renderInline(node.content)}}\n`;
}

function renderReference(node: IRReferenceNode): string {
  return `${node.content}\\label{ref:${node.label}}\n`;
}

function buildPreamble(title: string): string {
  return `\\documentclass[12pt,a4paper]{article}

\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{amsthm}
\\usepackage{listings}
\\usepackage{booktabs}
\\usepackage{geometry}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\usepackage{xcolor}
\\usepackage{enumitem}

\\geometry{
  margin=1in,
}

\\lstset{
  basicstyle=\\ttfamily\\small,
  breaklines=true,
  frame=single,
  numbers=left,
  numberstyle=\\tiny\\color{gray},
  keywordstyle=\\color{blue},
  commentstyle=\\color{green!60!black},
  stringstyle=\\color{red!60!black},
}

\\title{${escapeLatex(title)}}
\\date{\\today}

\\begin{document}
\\maketitle
`;
}

function collectFootnotes(doc: IRDocument): IRFootnoteNode[] {
  return findNodesByType(doc, 'footnote') as IRFootnoteNode[];
}

function collectReferences(doc: IRDocument): IRReferenceNode[] {
  return findNodesByType(doc, 'reference') as IRReferenceNode[];
}

export const LaTeXWorker: Worker = {
  id: 'latex',
  name: 'LaTeX',
  formats: ['latex'],

  async execute(input: WorkerInput): Promise<WorkerResult> {
    const start = performance.now();
    const artifacts: GeneratedArtifact[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const { ir, outputDir } = input;
      const title = ir.title || 'Untitled Document';

      let body = '';
      for (const child of ir.children) {
        body += renderNode(child);
      }

      const footnotes = collectFootnotes(ir);
      if (footnotes.length > 0) {
        body += '\\section*{Footnotes}\n';
        body += '\\begin{enumerate}\n';
        for (const fn of footnotes) {
          body += `  \\item[${fn.label}] ${renderInline(fn.content)}\n`;
        }
        body += '\\end{enumerate}\n';
      }

      const references = collectReferences(ir);
      if (references.length > 0) {
        body += '\\section*{References}\n';
        body += '\\begin{description}\n';
        for (const ref of references) {
          body += `  \\item[${ref.label}] ${renderInline(ref.content)}\n`;
        }
        body += '\\end{description}\n';
      }

      const preamble = buildPreamble(title);
      const document = preamble + body + '\\end{document}\n';

      const baseName = sanitizeFilename(title.replace(/\s+/g, '_').toLowerCase());
      const filename = `${baseName}.tex`;
      const filePath = path.join(outputDir, filename);

      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(filePath, document, 'utf-8');

      const data = new Uint8Array(Buffer.from(document, 'utf-8'));
      artifacts.push({
        filename,
        data,
        format: 'latex',
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
