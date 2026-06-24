import fs from 'fs/promises';
import path from 'path';
import { WorkerInput, WorkerResult, GeneratedArtifact, IRBlockNode, IRSectionNode, IRParagraphNode, IRListNode, IRTableNode, IRCodeNode, IRQuoteNode, IRImageNode, IRDiagramNode, IRMathNode, IRFootnoteNode, IRReferenceNode, IRSlideNode, IRInlineNode } from '../../shared/types';
import { sanitizeFilename } from '../../shared/utils';
import type { Worker } from '../registry';
import { extractHeadings } from '../ir/traversal';

const CSS_STYLES = `
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f8f9fa;
  --bg-tertiary: #e9ecef;
  --text-primary: #212529;
  --text-secondary: #495057;
  --text-muted: #6c757d;
  --border-color: #dee2e6;
  --accent-color: #0d6efd;
  --accent-hover: #0b5ed7;
  --code-bg: #f4f4f5;
  --quote-bg: #f1f3f5;
  --quote-border: #868e96;
  --table-header-bg: #f8f9fa;
  --table-stripe: #f8f9fa;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.07);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.1);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #1a1b1e;
    --bg-secondary: #25262b;
    --bg-tertiary: #2c2e33;
    --text-primary: #c1c2c5;
    --text-secondary: #909296;
    --text-muted: #5c5f66;
    --border-color: #373a40;
    --accent-color: #4dabf7;
    --accent-hover: #339af0;
    --code-bg: #25262b;
    --quote-bg: #25262b;
    --quote-border: #5c5f66;
    --table-header-bg: #25262b;
    --table-stripe: #25262b;
  }
}

[data-theme="dark"] {
  --bg-primary: #1a1b1e;
  --bg-secondary: #25262b;
  --bg-tertiary: #2c2e33;
  --text-primary: #c1c2c5;
  --text-secondary: #909296;
  --text-muted: #5c5f66;
  --border-color: #373a40;
  --accent-color: #4dabf7;
  --accent-hover: #339af0;
  --code-bg: #25262b;
  --quote-bg: #25262b;
  --quote-border: #5c5f66;
  --table-header-bg: #25262b;
  --table-stripe: #25262b;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.6;
  padding: 2rem;
  max-width: 900px;
  margin: 0 auto;
}

h1 {
  font-size: 2.5rem;
  font-weight: 700;
  margin-bottom: 1.5rem;
  color: var(--text-primary);
  border-bottom: 2px solid var(--border-color);
  padding-bottom: 0.5rem;
}

h2 {
  font-size: 1.75rem;
  font-weight: 600;
  margin-top: 2rem;
  margin-bottom: 1rem;
  color: var(--text-primary);
}

h3 {
  font-size: 1.35rem;
  font-weight: 600;
  margin-top: 1.5rem;
  margin-bottom: 0.75rem;
  color: var(--text-primary);
}

h4, h5, h6 {
  font-size: 1.1rem;
  font-weight: 600;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
  color: var(--text-primary);
}

p {
  margin-bottom: 1rem;
  color: var(--text-primary);
}

ul, ol {
  margin-left: 1.5rem;
  margin-bottom: 1rem;
  color: var(--text-primary);
}

li {
  margin-bottom: 0.35rem;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 1.5rem;
  box-shadow: var(--shadow-sm);
  border-radius: 6px;
  overflow: hidden;
}

thead {
  background-color: var(--table-header-bg);
}

th {
  padding: 0.75rem 1rem;
  text-align: left;
  font-weight: 600;
  border-bottom: 2px solid var(--border-color);
  color: var(--text-primary);
}

td {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
}

tbody tr:nth-child(even) {
  background-color: var(--table-stripe);
}

tbody tr:hover {
  background-color: var(--bg-tertiary);
}

pre {
  background-color: var(--code-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 1rem;
  overflow-x: auto;
  margin-bottom: 1rem;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.875rem;
  line-height: 1.5;
}

code {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  background-color: var(--code-bg);
  padding: 0.2rem 0.4rem;
  border-radius: 3px;
  font-size: 0.875em;
}

pre code {
  background-color: transparent;
  padding: 0;
  font-size: inherit;
}

blockquote {
  border-left: 4px solid var(--quote-border);
  background-color: var(--quote-bg);
  padding: 1rem 1.5rem;
  margin-bottom: 1rem;
  border-radius: 0 6px 6px 0;
  font-style: italic;
  color: var(--text-secondary);
}

blockquote p:last-child {
  margin-bottom: 0;
}

blockquote cite {
  display: block;
  margin-top: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-muted);
  font-style: normal;
}

.toc {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 2rem;
}

.toc-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 1rem;
  color: var(--text-primary);
}

.toc ul {
  list-style: none;
  margin-left: 0;
}

.toc li {
  margin-bottom: 0.5rem;
}

.toc a {
  color: var(--accent-color);
  text-decoration: none;
  transition: color 0.2s;
}

.toc a:hover {
  color: var(--accent-hover);
  text-decoration: underline;
}

.toc .level-1 { margin-left: 0; }
.toc .level-2 { margin-left: 1.5rem; }
.toc .level-3 { margin-left: 3rem; }
.toc .level-4 { margin-left: 4.5rem; }

.image-container {
  margin-bottom: 1rem;
  text-align: center;
}

.image-container img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  box-shadow: var(--shadow-md);
}

.image-caption {
  font-size: 0.875rem;
  color: var(--text-muted);
  margin-top: 0.5rem;
  font-style: italic;
}

.diagram {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 1rem;
  margin-bottom: 1rem;
  font-family: monospace;
  font-size: 0.875rem;
  white-space: pre-wrap;
  color: var(--text-secondary);
}

.math {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.5rem 1rem;
  margin-bottom: 1rem;
  font-family: 'Times New Roman', serif;
  font-size: 1.1rem;
  text-align: center;
  color: var(--text-primary);
}

.footnote {
  font-size: 0.8rem;
  color: var(--text-muted);
  border-top: 1px solid var(--border-color);
  padding-top: 0.5rem;
  margin-top: 2rem;
}

.reference {
  font-size: 0.85rem;
  color: var(--text-secondary);
  padding: 0.5rem 1rem;
  background-color: var(--bg-secondary);
  border-radius: 4px;
  margin-bottom: 0.5rem;
}

.slide {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: var(--shadow-sm);
}

.slide-title {
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 1rem;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 0.5rem;
}

.page-break {
  page-break-after: always;
  border-bottom: 2px dashed var(--border-color);
  margin: 2rem 0;
  padding-bottom: 1rem;
  color: var(--text-muted);
  font-size: 0.8rem;
  text-align: center;
}

.theme-toggle {
  position: fixed;
  top: 1rem;
  right: 1rem;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 50%;
  width: 40px;
  height: 40px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  box-shadow: var(--shadow-md);
  transition: all 0.2s;
  z-index: 1000;
}

.theme-toggle:hover {
  background-color: var(--bg-tertiary);
  box-shadow: var(--shadow-lg);
}

@media print {
  body {
    padding: 0;
    max-width: none;
  }
  
  .theme-toggle {
    display: none;
  }
  
  pre {
    white-space: pre-wrap;
    word-wrap: break-word;
  }
}
`;

const THEME_TOGGLE_SCRIPT = `
<script>
  (function() {
    const toggle = document.getElementById('theme-toggle');
    const html = document.documentElement;
    
    const getSystemTheme = () => {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };
    
    const savedTheme = localStorage.getItem('theme');
    const initialTheme = savedTheme || getSystemTheme();
    
    if (initialTheme === 'dark') {
      html.setAttribute('data-theme', 'dark');
    }
    
    toggle.addEventListener('click', function() {
      const currentTheme = html.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      
      if (newTheme === 'dark') {
        html.setAttribute('data-theme', 'dark');
      } else {
        html.removeAttribute('data-theme');
      }
      
      localStorage.setItem('theme', newTheme);
      toggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
    });
    
    toggle.textContent = html.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
  })();
</script>
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function inlineToHtml(nodes: IRInlineNode[]): string {
  return nodes.map(node => {
    switch (node.type) {
      case 'inline-text':
        return escapeHtml(node.content);
      case 'inline-bold':
        return `<strong>${inlineToHtml(node.children)}</strong>`;
      case 'inline-italic':
        return `<em>${inlineToHtml(node.children)}</em>`;
      case 'inline-code':
        return `<code>${escapeHtml(node.content)}</code>`;
      case 'inline-link':
        return `<a href="${escapeHtml(node.href)}">${inlineToHtml(node.children)}</a>`;
      case 'inline-strikethrough':
        return `<del>${inlineToHtml(node.children)}</del>`;
      default:
        return '';
    }
  }).join('');
}

function renderNode(node: IRBlockNode): string {
  switch (node.type) {
    case 'section': {
      const section = node as IRSectionNode;
      const headingTag = `h${Math.min(section.level, 6)}`;
      const id = section.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const childrenHtml = section.children.map(renderNode).join('\n');
      return `
        <${headingTag} id="${id}">${escapeHtml(section.title)}</${headingTag}>
        ${childrenHtml}
      `;
    }
    
    case 'paragraph': {
      const para = node as IRParagraphNode;
      const content = para.inline && para.inline.length > 0
        ? inlineToHtml(para.inline)
        : escapeHtml(para.content);
      return `<p>${content}</p>`;
    }
    
    case 'list': {
      const list = node as IRListNode;
      const tag = list.ordered ? 'ol' : 'ul';
      const itemsHtml = list.items.map(item => {
        const childrenHtml = item.children ? item.children.map(renderNode).join('\n') : '';
        const content = item.inline && item.inline.length > 0
          ? inlineToHtml(item.inline)
          : escapeHtml(item.content);
        return `<li>${content}${childrenHtml}</li>`;
      }).join('\n');
      return `<${tag}>${itemsHtml}</${tag}>`;
    }
    
    case 'table': {
      const table = node as IRTableNode;
      const headersHtml = table.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('\n');
      const rowsHtml = table.rows.map(row => {
        const cellsHtml = row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('\n');
        return `<tr>${cellsHtml}</tr>`;
      }).join('\n');
      return `
        <table>
          <thead><tr>${headersHtml}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      `;
    }
    
    case 'code': {
      const code = node as IRCodeNode;
      const langClass = code.language ? ` class="language-${escapeHtml(code.language)}"` : '';
      return `<pre><code${langClass}>${escapeHtml(code.content)}</code></pre>`;
    }
    
    case 'quote': {
      const quote = node as IRQuoteNode;
      const content = quote.inline && quote.inline.length > 0
        ? inlineToHtml(quote.inline)
        : escapeHtml(quote.content);
      const authorHtml = quote.author ? `<cite>— ${escapeHtml(quote.author)}</cite>` : '';
      return `
        <blockquote>
          <p>${content}</p>
          ${authorHtml}
        </blockquote>
      `;
    }
    
    case 'image': {
      const img = node as IRImageNode;
      const altText = escapeHtml(img.alt || 'Image');
      return `
        <div class="image-container">
          <img src="${escapeHtml(img.src)}" alt="${altText}"${img.width ? ` width="${img.width}"` : ''}${img.height ? ` height="${img.height}"` : ''}>
          ${img.alt ? `<div class="image-caption">${altText}</div>` : ''}
        </div>
      `;
    }
    
    case 'diagram': {
      const diagram = node as IRDiagramNode;
      return `
        <div class="diagram">
          <strong>${escapeHtml(diagram.engine)} diagram:</strong>
          <pre>${escapeHtml(diagram.content)}</pre>
        </div>
      `;
    }
    
    case 'math': {
      const math = node as IRMathNode;
      return `<div class="math">${escapeHtml(math.content)}</div>`;
    }
    
    case 'toc': {
      return '<div class="toc-placeholder"></div>';
    }
    
    case 'pageBreak': {
      return '<div class="page-break">Page Break</div>';
    }
    
    case 'footnote': {
      const footnote = node as IRFootnoteNode;
      return `<div class="footnote"><strong>${escapeHtml(footnote.label)}:</strong> ${escapeHtml(footnote.content)}</div>`;
    }
    
    case 'reference': {
      const ref = node as IRReferenceNode;
      return `<div class="reference"><strong>[${escapeHtml(ref.label)}]</strong> ${escapeHtml(ref.content)}</div>`;
    }
    
    case 'slide': {
      const slide = node as IRSlideNode;
      const childrenHtml = slide.children.map(renderNode).join('\n');
      return `
        <div class="slide">
          <div class="slide-title">${escapeHtml(slide.title)}</div>
          ${childrenHtml}
        </div>
      `;
    }
    
    case 'frontmatter': {
      return '';
    }
    
    default:
      return '';
  }
}

function renderToc(headings: { level: number; title: string }[]): string {
  if (headings.length === 0) return '';
  
  const items = headings.map(h => {
    const id = h.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const indent = h.level - 1;
    return `<li class="level-${h.level}"><a href="#${id}">${escapeHtml(h.title)}</a></li>`;
  }).join('\n');
  
  return `
    <div class="toc">
      <div class="toc-title">Table of Contents</div>
      <ul>${items}</ul>
    </div>
  `;
}

export class HTMLWorker implements Worker {
  readonly id = 'html';
  readonly name = 'HTML Worker';
  readonly formats = ['html'];

  async execute(input: WorkerInput): Promise<WorkerResult> {
    const start = performance.now();
    const artifacts: GeneratedArtifact[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const headings = extractHeadings(input.ir);
      const tocHtml = renderToc(headings);
      
      const contentHtml = input.ir.children.map(renderNode).join('\n');
      
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(input.ir.title || 'Document')}</title>
  <style>${CSS_STYLES}</style>
</head>
<body>
  <button id="theme-toggle" class="theme-toggle" aria-label="Toggle dark mode">🌙</button>
  
  <main>
    <h1>${escapeHtml(input.ir.title || 'Document')}</h1>
    ${tocHtml}
    ${contentHtml}
  </main>
  
  ${THEME_TOGGLE_SCRIPT}
</body>
</html>`;

      const encoder = new TextEncoder();
      const data = encoder.encode(html);
      const filename = sanitizeFilename(input.ir.title || 'document') + '.html';
      const outputPath = path.join(input.outputDir, filename);

      await fs.mkdir(input.outputDir, { recursive: true });
      await fs.writeFile(outputPath, data);

      artifacts.push({
        filename,
        data,
        format: 'html',
        size: data.byteLength,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
    }

    const duration = performance.now() - start;
    return { success: errors.length === 0, artifacts, errors, warnings, duration };
  }
}

export const htmlWorker = new HTMLWorker();
