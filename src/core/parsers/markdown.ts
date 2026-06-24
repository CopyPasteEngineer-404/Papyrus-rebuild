import { ParseInput, IRDocument, IRSource, IRBlockNode } from '../../shared/types';
import { IRBuilder, SectionBuilder } from '../ir/builder';
import { parseInline } from '../ir/parseInline';
import { generateId } from '../../shared/utils';
import type { Parser } from '../registry';

// ---------------------------------------------------------------------------
// YAML frontmatter parser (minimal, no external deps)
// ---------------------------------------------------------------------------

function parseYamlFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let rawValue = trimmed.slice(colonIdx + 1).trim();
    let value: string | number | boolean | null = rawValue;
    if (rawValue === 'true') { value = true; }
    else if (rawValue === 'false') { value = false; }
    else if (rawValue === 'null' || rawValue === '') { value = null; }
    else if (/^-?\d+(\.\d+)?$/.test(rawValue)) { value = Number(rawValue); }
    else {
      const stripped = rawValue.replace(/^["']|["']$/g, '');
      if (stripped !== rawValue) value = stripped;
    }
    result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSource(filePath: string, lineStart: number, lineEnd: number): IRSource {
  return { file: filePath, lineStart, lineEnd };
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_OPEN_RE = /^(`{3,}|~{3,})(.*)$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const THEMATIC_BREAK_RE = /^([-*_])(\s*\1){2,}\s*$/;
const UL_RE = /^(\s*)([-*+])\s+(.*)$/;
const OL_RE = /^(\s*)(\d+)\.\s+(.*)$/;
const TABLE_ROW_RE = /^\|(.+)\|$/;
const TABLE_SEP_RE = /^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function getIndentLevel(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? Math.floor(match[1].length / 2) : 0;
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map(cell => cell.trim());
}

function parseMarkdownTable(
  lines: string[],
  startIdx: number,
  filePath: string,
): { headers: string[]; rows: string[][]; endIdx: number } | null {
  if (startIdx + 1 >= lines.length) return null;

  const headerLine = lines[startIdx].trim();
  if (!TABLE_ROW_RE.test(headerLine)) return null;

  const sepLine = lines[startIdx + 1].trim();
  if (!TABLE_SEP_RE.test(sepLine)) return null;

  const headers = parseTableRow(headerLine);
  const rows: string[][] = [];
  let i = startIdx + 2;

  while (i < lines.length) {
    const rowLine = lines[i].trim();
    if (!TABLE_ROW_RE.test(rowLine)) break;
    rows.push(parseTableRow(rowLine));
    i++;
  }

  return { headers, rows, endIdx: i };
}

// ---------------------------------------------------------------------------
// Nested list parsing helpers
// ---------------------------------------------------------------------------

function parseNestedList(
  lines: string[],
  startIdx: number,
  ordered: boolean,
  filePath: string,
  baseIndent: number,
): { items: import('../../shared/types').IRListItem[]; endIdx: number } {
  const items: import('../../shared/types').IRListItem[] = [];
  let i = startIdx;
  const listRegex = ordered ? OL_RE : UL_RE;

  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(listRegex);
    if (!match) break;

    const indent = getIndentLevel(line);
    if (indent < baseIndent) break;

    const content = match[3];
    const inline = parseInline(content);
    const children: IRBlockNode[] = [];

    i++; // move past list marker

    // Parse nested content for this list item
    while (i < lines.length) {
      const nextLine = lines[i];
      const nextIndent = getIndentLevel(nextLine);
      
      if (nextIndent <= baseIndent) break;
      
      if (isBlank(nextLine)) {
        i++;
        continue;
      }

      // Check for nested list
      const nestedUlMatch = nextLine.match(UL_RE);
      const nestedOlMatch = nextLine.match(OL_RE);
      if ((nestedUlMatch || nestedOlMatch) && nextIndent > baseIndent) {
        const nestedResult = parseNestedList(
          lines, i, !!nestedOlMatch, filePath, baseIndent + 2
        );
        if (nestedResult.items.length > 0) {
          children.push({
            id: generateId(),
            type: 'list',
            ordered: !!nestedOlMatch,
            items: nestedResult.items,
            source: makeSource(filePath, i + 1, nestedResult.endIdx),
          });
        }
        i = nestedResult.endIdx;
        continue;
      }

      // Parse other block types
      const blockResult = parseBlockInList(lines, i, nextIndent, filePath);
      children.push(...blockResult.nodes);
      i = blockResult.endIdx;
    }

    items.push({
      content,
      inline,
      children: children.length > 0 ? children : undefined,
    });
  }

  return { items, endIdx: i };
}

function parseBlockInList(
  lines: string[],
  startIdx: number,
  indent: number,
  filePath: string,
): { nodes: IRBlockNode[]; endIdx: number } {
  const nodes: IRBlockNode[] = [];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    const lineIndent = getIndentLevel(line);
    
    if (lineIndent < indent) break;
    if (isBlank(line)) {
      i++;
      continue;
    }

    const trimmed = line.trim();

    // Fenced code block
    const fenceMatch = trimmed.match(FENCE_OPEN_RE);
    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0];
      const fenceLen = fenceMatch[1].length;
      const langHint = (fenceMatch[2] || '').trim().split(/\s/)[0] || '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        const cl = lines[i];
        const closeMatch = cl.match(new RegExp(`^\\${fenceChar}{${fenceLen},}\\s*$`));
        if (closeMatch) {
          i++;
          break;
        }
        codeLines.push(cl);
        i++;
      }
      const codeContent = codeLines.join('\n');
      const isMermaid = langHint === 'mermaid' || langHint === 'mmd';
      if (isMermaid) {
        nodes.push({
          id: generateId(),
          type: 'diagram',
          content: codeContent,
          engine: 'mermaid',
          source: makeSource(filePath, startIdx + 1, i),
        });
      } else {
        nodes.push({
          id: generateId(),
          type: 'code',
          language: langHint || 'text',
          content: codeContent,
          source: makeSource(filePath, startIdx + 1, i),
        });
      }
      continue;
    }

    // Blockquote
    if (BLOCKQUOTE_RE.test(trimmed)) {
      const quoteLines: string[] = [];
      let endLine = i + 1;
      while (i < lines.length && (BLOCKQUOTE_RE.test(lines[i].trim()) || (!isBlank(lines[i]) && quoteLines.length > 0 && !HEADING_RE.test(lines[i].trim())))) {
        const bqMatch = lines[i].trim().match(BLOCKQUOTE_RE);
        quoteLines.push(bqMatch ? bqMatch[1] : lines[i].trim());
        endLine = i + 1;
        i++;
        if (i < lines.length && isBlank(lines[i])) break;
      }
      const content = quoteLines.join('\n');
      nodes.push({
        id: generateId(),
        type: 'quote',
        content,
        inline: parseInline(content),
        source: makeSource(filePath, startIdx + 1, endLine),
      });
      continue;
    }

    // Paragraph (default)
    const paraLines: string[] = [];
    let endLine = i + 1;
    while (i < lines.length && !isBlank(lines[i])) {
      const l = lines[i];
      if (HEADING_RE.test(l.trim()) || FENCE_OPEN_RE.test(l.trim()) || THEMATIC_BREAK_RE.test(l.trim()) || UL_RE.test(l) || OL_RE.test(l) || BLOCKQUOTE_RE.test(l.trim()) || TABLE_ROW_RE.test(l.trim())) {
        break;
      }
      paraLines.push(l.trim());
      endLine = i + 1;
      i++;
    }
    if (paraLines.length > 0) {
      const plain = paraLines.join(' ');
      nodes.push({
        id: generateId(),
        type: 'paragraph',
        content: plain,
        inline: parseInline(plain),
        source: makeSource(filePath, startIdx + 1, endLine),
      });
    }
  }

  return { nodes, endIdx: i };
}

// ---------------------------------------------------------------------------
// Markdown Parser
// ---------------------------------------------------------------------------

export const markdownParser: Parser = {
  id: 'md',
  name: 'Markdown',
  extensions: ['.md', '.markdown'],

  async detect(content: Uint8Array): Promise<boolean> {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(content);
    if (/^---\s*$/m.test(text)) return true;
    if (/^#{1,6}\s+/m.test(text)) return true;
    if (/^```/m.test(text)) return true;
    if (/^>\s+/m.test(text)) return true;
    if (/^[-*_]\s*[-*_]\s*[-*_]/m.test(text)) return true;
    return text.length > 0;
  },

  async parse(input: ParseInput): Promise<IRDocument> {
    const { content, filePath, options } = input;
    const lines = content.split('\n');
    const builder = new IRBuilder();
    builder.setSourceFile(filePath);

    let title = options?.title || '';
    let frontmatterData: Record<string, unknown> | undefined;

    // --- Phase 1: extract YAML frontmatter -----------------------------------
    let startIdx = 0;
    if (lines[0]?.trim() === '---') {
      const endIdx = lines.indexOf('---', 1);
      if (endIdx !== -1) {
        const yamlBlock = lines.slice(1, endIdx).join('\n');
        frontmatterData = parseYamlFrontmatter(yamlBlock);
        if (!title && frontmatterData && typeof frontmatterData['title'] === 'string') {
          title = frontmatterData['title'] as string;
        }
        startIdx = endIdx + 1;
      }
    }

    if (frontmatterData) {
      builder.setFrontmatter(frontmatterData);
      builder.addFrontmatter(frontmatterData, makeSource(filePath, 1, startIdx));
    }

    // --- Phase 2: inline parsing with section stack -------------------------
    type StackEntry = { level: number; builder: SectionBuilder };

    const stack: StackEntry[] = [];
    let i = startIdx;

    /** Pop stack entries whose level >= the given level (close sections). */
    function popTo(level: number): SectionBuilder | null {
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      return stack.length > 0 ? stack[stack.length - 1].builder : null;
    }

    /** Current insertion target (either root builder or deepest open section). */
    function target(): IRBuilder | SectionBuilder {
      return stack.length > 0 ? stack[stack.length - 1].builder : builder;
    }

    while (i < lines.length) {
      const rawLine = lines[i];
      const line = rawLine;
      const lineNum = i + 1; // 1-based

      // --- blank line -------------------------------------------------------
      if (isBlank(line)) {
        i++;
        continue;
      }

      // --- thematic break ---------------------------------------------------
      if (THEMATIC_BREAK_RE.test(line.trim())) {
        builder.addPageBreak(makeSource(filePath, lineNum, lineNum));
        i++;
        continue;
      }

      // --- heading ----------------------------------------------------------
      const headingMatch = line.match(HEADING_RE);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2].trim();

        if (!title && level === 1) {
          title = text;
        }

        const parent = popTo(level);
        const sectionBuilder = target().addSection(level, text, makeSource(filePath, lineNum, lineNum));
        stack.push({ level, builder: sectionBuilder });
        i++;
        continue;
      }

      // --- fenced code block ------------------------------------------------
      const fenceMatch = line.match(FENCE_OPEN_RE);
      if (fenceMatch) {
        const fenceChar = fenceMatch[1][0];
        const fenceLen = fenceMatch[1].length;
        const langHint = (fenceMatch[2] || '').trim().split(/\s/)[0] || '';
        const codeLines: string[] = [];
        i++; // skip opening fence
        while (i < lines.length) {
          const cl = lines[i];
          const closeMatch = cl.match(new RegExp(`^\\${fenceChar}{${fenceLen},}\\s*$`));
          if (closeMatch) {
            i++; // skip closing fence
            break;
          }
          codeLines.push(cl);
          i++;
        }
        const codeContent = codeLines.join('\n');
        const endLine = lineNum + codeLines.length + 1;

        const isMermaid = langHint === 'mermaid' || langHint === 'mmd';
        if (isMermaid) {
          target().addDiagram(codeContent, 'mermaid', makeSource(filePath, lineNum, endLine));
        } else {
          target().addCode(langHint || 'text', codeContent, makeSource(filePath, lineNum, endLine));
        }
        continue;
      }

      // --- blockquote -------------------------------------------------------
      if (BLOCKQUOTE_RE.test(line)) {
        const quoteLines: string[] = [];
        let endLine = lineNum;
        while (i < lines.length && (BLOCKQUOTE_RE.test(lines[i]) || (!isBlank(lines[i]) && quoteLines.length > 0 && !HEADING_RE.test(lines[i])))) {
          const bqMatch = lines[i].match(BLOCKQUOTE_RE);
          quoteLines.push(bqMatch ? bqMatch[1] : lines[i].trim());
          endLine = i + 1;
          i++;
          if (i < lines.length && isBlank(lines[i])) break;
        }
        const content = quoteLines.join('\n');
        target().addQuote(content, undefined, parseInline(content), makeSource(filePath, lineNum, endLine));
        continue;
      }

      // --- unordered list ---------------------------------------------------
      const ulMatch = rawLine.match(UL_RE);
      if (ulMatch) {
        const baseIndent = getIndentLevel(rawLine);
        const items: { content: string; inline: import('../../shared/types').IRInlineNode[]; children?: IRBlockNode[] }[] = [];
        let endLine = lineNum;
        
        while (i < lines.length) {
          const currentLine = lines[i];
          const lm = currentLine.match(UL_RE);
          if (!lm) break;
          
          const indent = getIndentLevel(currentLine);
          if (indent < baseIndent) break;
          
          const content = lm[3];
          const inline = parseInline(content);
          const children: IRBlockNode[] = [];
          
          i++; // move past list marker
          
          // Parse nested content for this list item
          while (i < lines.length) {
            const nextLine = lines[i];
            const nextIndent = getIndentLevel(nextLine);
            
            if (nextIndent <= baseIndent) break;
            if (isBlank(nextLine)) {
              i++;
              continue;
            }

            // Check for nested list
            const nestedUlMatch = nextLine.match(UL_RE);
            const nestedOlMatch = nextLine.match(OL_RE);
            if ((nestedUlMatch || nestedOlMatch) && nextIndent > baseIndent) {
              const nestedResult = parseNestedList(lines, i, !!nestedOlMatch, filePath, baseIndent + 2);
              if (nestedResult.items.length > 0) {
                children.push({
                  id: generateId(),
                  type: 'list',
                  ordered: !!nestedOlMatch,
                  items: nestedResult.items,
                  source: makeSource(filePath, i + 1, nestedResult.endIdx),
                });
              }
              i = nestedResult.endIdx;
              continue;
            }

            // Parse other block types (code, blockquote, paragraph)
            const blockResult = parseBlockInList(lines, i, nextIndent, filePath);
            children.push(...blockResult.nodes);
            i = blockResult.endIdx;
          }

          items.push({ content, inline, children: children.length > 0 ? children : undefined });
          endLine = i;
        }
        
        target().addList(false, items, makeSource(filePath, lineNum, endLine));
        continue;
      }

      // --- ordered list -----------------------------------------------------
      const olMatch = rawLine.match(OL_RE);
      if (olMatch) {
        const baseIndent = getIndentLevel(rawLine);
        const items: { content: string; inline: import('../../shared/types').IRInlineNode[]; children?: IRBlockNode[] }[] = [];
        let endLine = lineNum;
        
        while (i < lines.length) {
          const currentLine = lines[i];
          const lm = currentLine.match(OL_RE);
          if (!lm) break;
          
          const indent = getIndentLevel(currentLine);
          if (indent < baseIndent) break;
          
          const content = lm[3];
          const inline = parseInline(content);
          const children: IRBlockNode[] = [];
          
          i++; // move past list marker
          
          // Parse nested content for this list item
          while (i < lines.length) {
            const nextLine = lines[i];
            const nextIndent = getIndentLevel(nextLine);
            
            if (nextIndent <= baseIndent) break;
            if (isBlank(nextLine)) {
              i++;
              continue;
            }

            // Check for nested list
            const nestedUlMatch = nextLine.match(UL_RE);
            const nestedOlMatch = nextLine.match(OL_RE);
            if ((nestedUlMatch || nestedOlMatch) && nextIndent > baseIndent) {
              const nestedResult = parseNestedList(lines, i, !!nestedOlMatch, filePath, baseIndent + 2);
              if (nestedResult.items.length > 0) {
                children.push({
                  id: generateId(),
                  type: 'list',
                  ordered: !!nestedOlMatch,
                  items: nestedResult.items,
                  source: makeSource(filePath, i + 1, nestedResult.endIdx),
                });
              }
              i = nestedResult.endIdx;
              continue;
            }

            // Parse other block types (code, blockquote, paragraph)
            const blockResult = parseBlockInList(lines, i, nextIndent, filePath);
            children.push(...blockResult.nodes);
            i = blockResult.endIdx;
          }

          items.push({ content, inline, children: children.length > 0 ? children : undefined });
          endLine = i;
        }
        
        target().addList(true, items, makeSource(filePath, lineNum, endLine));
        continue;
      }

      // --- table --------------------------------------------------------------
      if (TABLE_ROW_RE.test(line.trim())) {
        const table = parseMarkdownTable(lines, i, filePath);
        if (table) {
          target().addTable(table.headers, table.rows, makeSource(filePath, lineNum, table.endIdx));
          i = table.endIdx;
          continue;
        }
      }

      // --- paragraph (default) ----------------------------------------------
      {
        const paraLines: string[] = [];
        let endLine = lineNum;
        while (i < lines.length && !isBlank(lines[i])) {
          const l = lines[i];
          // break on elements that start new blocks
          if (HEADING_RE.test(l) || FENCE_OPEN_RE.test(l) || THEMATIC_BREAK_RE.test(l.trim()) || UL_RE.test(l) || OL_RE.test(l) || BLOCKQUOTE_RE.test(l) || TABLE_ROW_RE.test(l.trim())) {
            break;
          }
          paraLines.push(l.trim());
          endLine = i + 1;
          i++;
        }
        if (paraLines.length > 0) {
          const plain = paraLines.join(' ');
          target().addParagraph(plain, parseInline(plain), makeSource(filePath, lineNum, endLine));
        }
      }
    }

    // --- extract title if not found yet --------------------------------------
    builder.setTitle(title || 'Untitled');

    return builder.build();
  },
};
