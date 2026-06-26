import type { CheerioAPI, Cheerio } from 'cheerio';
import { ParseInput, IRDocument, IRBlockNode, IRInlineNode } from '../../shared/types';
import { IRBuilder, SectionBuilder } from '../ir/builder';
import { generateId } from '../../shared/utils';
import type { Parser } from '../registry';

let cheerioModule: any = null;
async function loadCheerio() {
  if (!cheerioModule) {
    cheerioModule = await import('cheerio');
  }
  return cheerioModule;
}

type BuilderLike = IRBuilder | SectionBuilder;

function parseInlineFromHtml($: CheerioAPI, el: Cheerio<any>): IRInlineNode[] {
  const nodes: IRInlineNode[] = [];
  el.contents().each((_, child) => {
    if (!child) return;
    if (child.type === 'text') {
      const text = $(child).text();
      if (text) {
        nodes.push({ id: generateId(), type: 'inline-text', content: text });
      }
    } else if (child.type === 'tag') {
      const tag = child.tagName?.toLowerCase();
      if (!tag) return;
      if (tag === 'strong' || tag === 'b') {
        const children = parseInlineFromHtml($, $(child));
        if (children.length > 0) {
          nodes.push({ id: generateId(), type: 'inline-bold', children });
        }
      } else if (tag === 'em' || tag === 'i') {
        const children = parseInlineFromHtml($, $(child));
        if (children.length > 0) {
          nodes.push({ id: generateId(), type: 'inline-italic', children });
        }
      } else if (tag === 'code') {
        const content = $(child).text();
        nodes.push({ id: generateId(), type: 'inline-code', content });
      } else if (tag === 'a') {
        const href = $(child).attr('href') || '';
        const children = parseInlineFromHtml($, $(child));
        if (children.length > 0) {
          nodes.push({ id: generateId(), type: 'inline-link', href, children });
        }
      } else if (tag === 'del' || tag === 's' || tag === 'strike') {
        const children = parseInlineFromHtml($, $(child));
        if (children.length > 0) {
          nodes.push({ id: generateId(), type: 'inline-strikethrough', children });
        }
      } else {
        // For other tags (span, etc.), just traverse children
        const children = parseInlineFromHtml($, $(child));
        nodes.push(...children);
      }
    }
  });
  return nodes;
}

export const htmlParser: Parser = {
  id: 'html',
  name: 'HTML Parser',
  extensions: ['.html', '.htm'],

  async detect(content: Uint8Array): Promise<boolean> {
    const text = new TextDecoder().decode(content).slice(0, 1024).toLowerCase();
    return text.includes('<html') || text.includes('<!doctype html') || text.includes('<head');
  },

  async parse(input: ParseInput): Promise<IRDocument> {
    let $: CheerioAPI;
    try {
      const cheerio = await loadCheerio();
      $ = cheerio.load(input.content);
    } catch (err) {
      throw new Error(`HTML parsing failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const builder = new IRBuilder().setSourceFile(input.filePath);

    const title =
      input.options?.title ||
      $('title').first().text().trim() ||
      $('h1').first().text().trim() ||
      'Untitled HTML Document';
    builder.setTitle(title);

    function getText(el: Cheerio<any>): string {
      return el.text().trim().replace(/\s+/g, ' ');
    }

    $('body, main, article, #content, .content, body > div').each((_, container) => {
      if (!container) return;
      const el = $(container);
      el.children().each((_, child) => {
        if (!child) return;
        processNode($, $(child), builder);
      });
    });

    if (builder.build().children.length === 0) {
      $('*').each((_, el) => {
        if (!el || el.type !== 'tag') return;
        const tag = el.tagName?.toLowerCase();
        if (!tag) return;
        const parent = $(el).parent();
        if (parent.length && parent.is('body, main, article')) {
          processNode($, $(el), builder);
        }
      });
    }

    return builder.build();
  },
};

function processNode(
  $: CheerioAPI,
  el: Cheerio<any>,
  builder: IRBuilder,
  parentBuilder?: BuilderLike,
) {
  const tag = el.prop('tagName')?.toLowerCase();
  if (!tag) return;

  const target = parentBuilder || builder;

  if (/^h[1-6]$/.test(tag)) {
    const level = parseInt(tag[1], 10);
    const title = el.text().trim().replace(/\s+/g, ' ');
    if (!title) return;

    const section = target.addSection(level, title);
    el.children().each((_, child) => {
      if (!child) return;
      processNode($, $(child), builder, section);
    });
    return;
  }

  if (tag === 'p') {
    const text = el.text().trim().replace(/\s+/g, ' ');
    if (text) {
      const inline = parseInlineFromHtml($, el);
      target.addParagraph(text, inline);
    }
    return;
  }

  if (tag === 'ul' || tag === 'ol') {
    const ordered = tag === 'ol';
    const items: { content: string; inline: IRInlineNode[] }[] = [];
    el.children('li').each((_, li) => {
      const liEl = $(li);
      // Get text content excluding nested lists
      const text = liEl.contents().not('ul, ol').text().trim().replace(/\s+/g, ' ');
      if (text) {
        // Get inline nodes from direct content (excluding nested lists)
        const inlineNodes: IRInlineNode[] = [];
        liEl.contents().each((_, child) => {
          if (!child) return;
          if (child.type === 'tag') {
            const childTag = child.tagName?.toLowerCase();
            if (childTag === 'ul' || childTag === 'ol') return;
          }
          if (child.type === 'text') {
            const t = $(child).text();
            if (t.trim()) {
              inlineNodes.push({ id: generateId(), type: 'inline-text', content: t });
            }
          } else if (child.type === 'tag') {
            inlineNodes.push(...parseInlineFromHtml($, $(child)));
          }
        });
        items.push({ content: text, inline: inlineNodes });
      }
    });
    if (items.length > 0) {
      target.addList(ordered, items);
    }
    return;
  }

  if (tag === 'table') {
    const headers: string[] = [];
    const rows: string[][] = [];

    el.find('thead th, thead td').each((_, th) => {
      headers.push($(th).text().trim());
    });

    if (headers.length === 0) {
      el.find('tr').first().children('th, td').each((_, cell) => {
        headers.push($(cell).text().trim());
      });
    }

    const bodyRows = el.find('tbody tr').length > 0 ? el.find('tbody tr') : el.find('tr');
    bodyRows.each((_, tr) => {
      const cells: string[] = [];
      $(tr).children('td, th').each((_, td) => {
        cells.push($(td).text().trim());
      });
      if (cells.length > 0) rows.push(cells);
    });

    if (headers.length === 0 && rows.length > 0) {
      headers.push(...rows.shift()!);
    }

    if (headers.length > 0) {
      target.addTable(headers, rows);
    }
    return;
  }

  if (tag === 'pre') {
    const codeEl = el.find('code');
    const language = codeEl.attr('class')?.replace(/language-|lang-/, '') || '';
    const content = (codeEl.length > 0 ? codeEl : el).text();
    if (content.trim()) {
      target.addCode(language, content);
    }
    return;
  }

  if (tag === 'blockquote') {
    const content = el.text().trim().replace(/\s+/g, ' ');
    if (content) {
      const inline = parseInlineFromHtml($, el);
      target.addQuote(content, undefined, inline);
    }
    return;
  }

  if (tag === 'img') {
    const src = el.attr('src') || '';
    const alt = el.attr('alt') || '';
    if (src) {
      (target as IRBuilder).addImage(src, alt);
    }
    return;
  }

  if (tag === 'hr') {
    return;
  }

  if (tag === 'div' || tag === 'section' || tag === 'article') {
    const sectionTitle = el.attr('id') || el.attr('title') || el.attr('aria-label') || '';
    if (sectionTitle) {
      const section = target.addSection(2, sectionTitle);
      el.children().each((_, child) => {
        if (!child) return;
        processNode($, $(child), builder, section);
      });
    } else {
      el.children().each((_, child) => {
        if (!child) return;
        processNode($, $(child), builder, parentBuilder);
      });
    }
    return;
  }

  if (tag === 'script' || tag === 'style' || tag === 'noscript') {
    return;
  }

  if (tag === 'br') {
    return;
  }

  const directText = el.clone().children().remove().end().text().trim();
  if (directText && !el.children().length) {
    target.addParagraph(directText.replace(/\s+/g, ' '));
  }
}
