import { ParseInput, IRDocument, IRBlockNode } from '../../shared/types';
import { IRBuilder } from '../ir/builder';
import { generateId } from '../../shared/utils';
import type { Parser } from '../registry';

let mammothModule: any = null;
async function loadMammoth() {
  if (!mammothModule) {
    mammothModule = (await import('mammoth')).default;
  }
  return mammothModule;
}

export const docxParser: Parser = {
  id: 'docx',
  name: 'DOCX Parser',
  extensions: ['.docx'],

  async detect(content: Uint8Array): Promise<boolean> {
    const signature = new Uint8Array([0x50, 0x4B, 0x03, 0x04]);
    if (content.length < 4) return false;
    return (
      content[0] === signature[0] &&
      content[1] === signature[1] &&
      content[2] === signature[2] &&
      content[3] === signature[3]
    );
  },

  async parse(input: ParseInput): Promise<IRDocument> {
    if (!input.content || input.content.length === 0) {
      return new IRBuilder().setSourceFile(input.filePath).setTitle('Empty DOCX').build();
    }

    const buffer = Buffer.from(input.content, 'binary');

    let html: string;
    try {
      const mammoth = await loadMammoth();
      const result = await mammoth.convertToHtml({ buffer });
      html = result.value;
    } catch (err) {
      throw new Error(`DOCX parsing failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const builder = new IRBuilder();
    builder.setSourceFile(input.filePath);
    builder.setTitle(input.options?.title || extractTitleFromPath(input.filePath));

    htmlToIR(html, builder);

    return builder.build();
  },
};

function extractTitleFromPath(filePath: string): string {
  const basename = filePath.replace(/\\/g, '/').split('/').pop() || 'Untitled';
  return basename.replace(/\.[^.]+$/, '');
}

function htmlToIR(html: string, builder: IRBuilder): void {
  const doc = parseHTML(html);
  processNode(doc, builder);
}

function parseHTML(html: string): unknown {
  const g = globalThis as Record<string, unknown>;
  if (typeof g['document'] !== 'undefined') {
    const doc = g['document'] as { createElement: (tag: string) => { innerHTML: string } };
    const div = doc.createElement('div');
    div.innerHTML = html;
    return div;
  }

  const simpleParse = (tagContent: string): string[] => {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    let i = 0;
    while (i < tagContent.length) {
      if (tagContent[i] === '<') {
        const closeIdx = tagContent.indexOf('>', i);
        if (closeIdx === -1) {
          current += tagContent[i];
          i++;
          continue;
        }
        const tag = tagContent.slice(i, closeIdx + 1);
        const isClose = tag[1] === '/';
        const selfClosing = tag.endsWith('/>');
        if (isClose) {
          depth--;
          if (depth === 0) {
            parts.push(current);
            current = '';
          }
        } else if (!selfClosing) {
          if (depth === 0 && current.trim()) {
            parts.push(current);
            current = '';
          }
          depth++;
        }
        i = closeIdx + 1;
      } else {
        current += tagContent[i];
        i++;
      }
    }
    if (current.trim()) parts.push(current);
    return parts;
  };

  const wrapper = { innerHTML: html, childNodes: [] as unknown[] };
  const tags = simpleParse(html);

  for (const tag of tags) {
    const match = tag.match(/^<(\w+)[^>]*>([\s\S]*)$/);
    if (match) {
      const [, tagName, content] = match;
      const element = {
        tagName: tagName.toLowerCase(),
        innerHTML: content,
        innerText: content.replace(/<[^>]+>/g, ''),
        childNodes: [] as unknown[],
      };
      (wrapper.childNodes as unknown[]).push(element);
    }
  }

  return wrapper as unknown;
}

function processNode(node: unknown, builder: IRBuilder): void {
  const el = node as { tagName?: string; innerHTML?: string; innerText?: string; childNodes?: unknown[] };
  if (!el || !el.tagName) return;

  const tag = el.tagName.toLowerCase();
  const text = (el.innerText || el.innerHTML || '').trim();

  switch (tag) {
    case 'h1':
      builder.addSection(1, text);
      break;
    case 'h2':
      builder.addSection(2, text);
      break;
    case 'h3':
      builder.addSection(3, text);
      break;
    case 'h4':
      builder.addSection(4, text);
      break;
    case 'h5':
      builder.addSection(5, text);
      break;
    case 'h6':
      builder.addSection(6, text);
      break;
    case 'p':
      if (text) {
        builder.addParagraph(text);
      }
      break;
    case 'ul':
      processList(builder, el, false);
      break;
    case 'ol':
      processList(builder, el, true);
      break;
    case 'table':
      processTable(builder, el);
      break;
    case 'pre':
      processCodeBlock(builder, el);
      break;
    case 'blockquote':
      if (text) {
        builder.addQuote(text);
      }
      break;
    case 'img':
      processImage(builder, el);
      break;
    case 'hr':
      builder.addPageBreak();
      break;
    case 'div':
    case 'section':
    case 'article':
    case 'main':
      if (el.childNodes) {
        for (const child of el.childNodes) {
          processNode(child, builder);
        }
      }
      break;
  }
}

function processList(builder: IRBuilder, el: { childNodes?: unknown[] }, ordered: boolean): void {
  const items: { content: string; children?: IRBlockNode[] }[] = [];

  if (el.childNodes) {
    for (const child of el.childNodes) {
      const childEl = child as { tagName?: string; innerText?: string; innerHTML?: string; childNodes?: unknown[] };
      if (childEl && childEl.tagName && childEl.tagName.toLowerCase() === 'li') {
        const content = (childEl.innerText || '').trim();
        const nestedChildren: IRBlockNode[] = [];

        if (childEl.childNodes) {
          for (const nested of childEl.childNodes) {
            const nestedEl = nested as { tagName?: string; childNodes?: unknown[] };
            if (nestedEl && nestedEl.tagName) {
              const nestedTag = nestedEl.tagName.toLowerCase();
              if (nestedTag === 'ul') {
                const subItems = extractListItems(nestedEl);
                if (subItems.length > 0) {
                  nestedChildren.push({
                    id: generateId(),
                    type: 'list',
                    ordered: false,
                    items: subItems,
                  });
                }
              } else if (nestedTag === 'ol') {
                const subItems = extractListItems(nestedEl);
                if (subItems.length > 0) {
                  nestedChildren.push({
                    id: generateId(),
                    type: 'list',
                    ordered: true,
                    items: subItems,
                  });
                }
              }
            }
          }
        }

        items.push({
          content,
          children: nestedChildren.length > 0 ? nestedChildren : undefined,
        });
      }
    }
  }

  if (items.length > 0) {
    builder.addList(ordered, items);
  }
}

function extractListItems(el: { childNodes?: unknown[] }): { content: string; children?: IRBlockNode[] }[] {
  const items: { content: string; children?: IRBlockNode[] }[] = [];
  if (!el.childNodes) return items;

  for (const child of el.childNodes) {
    const childEl = child as { tagName?: string; innerText?: string };
    if (childEl && childEl.tagName && childEl.tagName.toLowerCase() === 'li') {
      const content = (childEl.innerText || '').trim();
      if (content) {
        items.push({ content });
      }
    }
  }

  return items;
}

function processTable(builder: IRBuilder, el: { childNodes?: unknown[] }): void {
  const headers: string[] = [];
  const rows: string[][] = [];
  let inHead = false;

  if (el.childNodes) {
    for (const child of el.childNodes) {
      const childEl = child as { tagName?: string; childNodes?: unknown[] };
      if (!childEl || !childEl.tagName) continue;

      const tag = childEl.tagName.toLowerCase();
      if (tag === 'thead') {
        inHead = true;
        extractTableRow(childEl, headers, rows, true);
        inHead = false;
      } else if (tag === 'tbody') {
        extractTableRow(childEl, headers, rows, false);
      } else if (tag === 'tr') {
        const cells = extractCells(childEl);
        if (inHead || headers.length === 0) {
          headers.push(...cells);
        } else {
          rows.push(cells);
        }
      }
    }
  }

  if (headers.length > 0 || rows.length > 0) {
    if (headers.length === 0 && rows.length > 0) {
      const colCount = rows[0].length;
      for (let i = 0; i < colCount; i++) {
        headers.push(`Column ${i + 1}`);
      }
    }
    builder.addTable(headers, rows);
  }
}

function extractTableRow(
  el: { childNodes?: unknown[] },
  headers: string[],
  rows: string[][],
  isHeader: boolean
): void {
  if (!el.childNodes) return;

  for (const child of el.childNodes) {
    const childEl = child as { tagName?: string; childNodes?: unknown[] };
    if (childEl && childEl.tagName && childEl.tagName.toLowerCase() === 'tr') {
      const cells = extractCells(childEl);
      if (isHeader) {
        headers.push(...cells);
      } else {
        rows.push(cells);
      }
    }
  }
}

function extractCells(trEl: { childNodes?: unknown[] }): string[] {
  const cells: string[] = [];
  if (!trEl.childNodes) return cells;

  for (const child of trEl.childNodes) {
    const cellEl = child as { tagName?: string; innerText?: string };
    if (cellEl && cellEl.tagName) {
      const tag = cellEl.tagName.toLowerCase();
      if (tag === 'td' || tag === 'th') {
        cells.push((cellEl.innerText || '').trim());
      }
    }
  }

  return cells;
}

function processCodeBlock(builder: IRBuilder, el: { innerHTML?: string; childNodes?: unknown[] }): void {
  let language = 'text';
  let content = '';

  if (el.childNodes) {
    for (const child of el.childNodes) {
      const childEl = child as { tagName?: string; className?: string; innerText?: string };
      if (childEl && childEl.tagName && childEl.tagName.toLowerCase() === 'code') {
        content = (childEl.innerText || '').trim();
        if (childEl.className) {
          const langMatch = childEl.className.match(/(?:language-|lang-)(\w+)/);
          if (langMatch) {
            language = langMatch[1];
          }
        }
      }
    }
  }

  if (!content && el.innerHTML) {
    content = el.innerHTML.replace(/<[^>]+>/g, '').trim();
  }

  if (content) {
    builder.addCode(language, content);
  }
}

function processImage(builder: IRBuilder, el: Record<string, unknown>): void {
  const src = (el.src as string) || '';
  const alt = (el.alt as string) || '';
  if (src) {
    builder.addImage(src, alt);
  }
}
