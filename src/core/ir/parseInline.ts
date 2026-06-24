import { IRInlineNode, IRInlineTextNode, IRInlineBoldNode, IRInlineItalicNode, IRInlineCodeNode, IRInlineLinkNode, IRInlineStrikethroughNode } from '../../shared/types';
import { generateId } from '../../shared/utils';

function textNode(content: string): IRInlineTextNode {
  return { id: generateId(), type: 'inline-text', content };
}

function boldNode(children: IRInlineNode[]): IRInlineBoldNode {
  return { id: generateId(), type: 'inline-bold', children };
}

function italicNode(children: IRInlineNode[]): IRInlineItalicNode {
  return { id: generateId(), type: 'inline-italic', children };
}

function codeNode(content: string): IRInlineCodeNode {
  return { id: generateId(), type: 'inline-code', content };
}

function linkNode(href: string, children: IRInlineNode[]): IRInlineLinkNode {
  return { id: generateId(), type: 'inline-link', href, children };
}

function strikethroughNode(children: IRInlineNode[]): IRInlineStrikethroughNode {
  return { id: generateId(), type: 'inline-strikethrough', children };
}

/**
 * Parse a markdown-style inline string into IRInlineNode[].
 *
 * Supports:
 *   **bold**
 *   *italic*
 *   `code`
 *   [text](url)
 *   ~~strikethrough~~
 */
export function parseInline(text: string): IRInlineNode[] {
  const result: IRInlineNode[] = [];
  let i = 0;

  while (i < text.length) {
    // ~~strikethrough~~
    if (text[i] === '~' && text[i + 1] === '~') {
      let j = i + 2;
      while (j < text.length - 1 && !(text[j] === '~' && text[j + 1] === '~')) j++;
      if (j < text.length - 1) {
        const inner = text.slice(i + 2, j);
        result.push(strikethroughNode(parseInline(inner)));
        i = j + 2;
        continue;
      }
    }

    // **bold**
    if (text[i] === '*' && text[i + 1] === '*') {
      let j = i + 2;
      while (j < text.length - 1 && !(text[j] === '*' && text[j + 1] === '*')) j++;
      if (j < text.length - 1) {
        const inner = text.slice(i + 2, j);
        result.push(boldNode(parseInline(inner)));
        i = j + 2;
        continue;
      }
    }

    // *italic*
    if (text[i] === '*' && text[i + 1] !== '*') {
      let j = i + 1;
      while (j < text.length && text[j] !== '*') j++;
      if (j < text.length) {
        const inner = text.slice(i + 1, j);
        result.push(italicNode(parseInline(inner)));
        i = j + 1;
        continue;
      }
    }

    // `code`
    if (text[i] === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== '`') j++;
      if (j < text.length) {
        const inner = text.slice(i + 1, j);
        result.push(codeNode(inner));
        i = j + 1;
        continue;
      }
    }

    // [text](url)
    if (text[i] === '[') {
      const linkEnd = text.indexOf(']', i);
      if (linkEnd !== -1 && linkEnd > i + 1) {
        const hrefStart = text.indexOf('(', linkEnd);
        if (hrefStart === linkEnd + 1) {
          const hrefEnd = text.indexOf(')', hrefStart);
          if (hrefEnd !== -1) {
            const label = text.slice(i + 1, linkEnd);
            const href = text.slice(hrefStart + 1, hrefEnd);
            result.push(linkNode(href, parseInline(label)));
            i = hrefEnd + 1;
            continue;
          }
        }
      }
    }

    // Plain text — collect until next special character
    let j = i + 1;
    while (j < text.length) {
      if (
        (text[j] === '*' && text[j + 1] === '*') ||
        (text[j] === '*' && (j === 0 || text[j - 1] !== '*')) ||
        text[j] === '`' ||
        text[j] === '~' && text[j + 1] === '~' ||
        text[j] === '['
      ) {
        break;
      }
      j++;
    }
    if (j > i) {
      result.push(textNode(text.slice(i, j)));
    }
    i = j;
  }

  return result;
}
