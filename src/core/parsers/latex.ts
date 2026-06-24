import { ParseInput, IRDocument, IRBlockNode, IRSectionNode, IRListItem } from '../../shared/types';
import { IRBuilder, SectionBuilder } from '../ir/builder';
import { generateId } from '../../shared/utils';
import type { Parser } from '../registry';

export const latexParser: Parser = {
  id: 'latex',
  name: 'LaTeX Document',
  extensions: ['.tex', '.latex'],

  async detect(content: Uint8Array): Promise<boolean> {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(content);
    const trimmed = text.trimStart();

    if (trimmed.startsWith('%')) return true;
    if (trimmed.startsWith('\\documentclass')) return true;
    if (trimmed.startsWith('\\begin{document}')) return true;
    if (trimmed.includes('\\begin{document}')) return true;
    if (trimmed.includes('\\end{document}')) return true;

    return false;
  },

  async parse(input: ParseInput): Promise<IRDocument> {
    const { content, filePath } = input;

    const title = extractTitle(content, filePath);
    const body = extractDocumentBody(content);

    const builder = new IRBuilder()
      .setSourceFile(filePath)
      .setTitle(title);

    parseBody(body, builder, filePath);

    return builder.build();
  },
};

function extractDocumentBody(content: string): string {
  const beginIdx = content.indexOf('\\begin{document}');
  const endIdx = content.lastIndexOf('\\end{document}');

  if (beginIdx !== -1 && endIdx !== -1) {
    return content.slice(beginIdx + '\\begin{document}'.length, endIdx).trim();
  }

  if (beginIdx !== -1) {
    return content.slice(beginIdx + '\\begin{document}'.length).trim();
  }

  return content;
}

function extractTitle(content: string, filePath: string): string {
  const titleMatch = content.match(/\\title\{([^}]+)\}/);
  if (titleMatch) return titleMatch[1];

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('%')) {
      const text = trimmed.slice(1).trim();
      if (text && !text.startsWith('!') && !text.startsWith('\\')) {
        return text;
      }
      continue;
    }
    if (trimmed.startsWith('\\')) continue;
    if (trimmed) break;
  }

  const basename = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
  return basename.replace(/\.(tex|latex)$/i, '') || 'Untitled Document';
}

function parseBody(body: string, builder: IRBuilder, filePath: string): void {
  const lines = body.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line || line.startsWith('%')) {
      i++;
      continue;
    }

    const sectionMatch = line.match(/^\\(section)\{([^}]+)\}/);
    if (sectionMatch) {
      const sectionBuilder = builder.addSection(1, sectionMatch[2], makeSource(filePath, i));
      i++;
      i = parseSectionContent(lines, i, sectionBuilder, filePath);
      continue;
    }

    const subMatch = line.match(/^\\(subsection)\{([^}]+)\}/);
    if (subMatch) {
      const sectionBuilder = builder.addSection(2, subMatch[2], makeSource(filePath, i));
      i++;
      i = parseSectionContent(lines, i, sectionBuilder, filePath);
      continue;
    }

    const subsubMatch = line.match(/^\\(subsubsection)\{([^}]+)\}/);
    if (subsubMatch) {
      const sectionBuilder = builder.addSection(3, subsubMatch[2], makeSource(filePath, i));
      i++;
      i = parseSectionContent(lines, i, sectionBuilder, filePath);
      continue;
    }

    const paraMatch = line.match(/^\\paragraph\{([^}]+)\}/);
    if (paraMatch) {
      const sectionBuilder = builder.addSection(4, paraMatch[1], makeSource(filePath, i));
      i++;
      i = parseSectionContent(lines, i, sectionBuilder, filePath);
      continue;
    }

    if (line === '\\begin{itemize}' || line === '\\begin{enumerate}') {
      const ordered = line === '\\begin{enumerate}';
      const result = extractList(lines, i, ordered);
      builder.addList(ordered, result.items, makeSource(filePath, i));
      i = result.nextIndex;
      continue;
    }

    if (line === '\\begin{verbatim}' || line === '\\begin{lstlisting}') {
      const result = extractCodeBlock(lines, i);
      builder.addCode(result.language, result.content, makeSource(filePath, i));
      i = result.nextIndex;
      continue;
    }

    if (line === '\\begin{tabular}' || line.match(/^\\begin\{tabular\}/)) {
      const result = extractTable(lines, i);
      if (result) {
        builder.addTable(result.headers, result.rows, makeSource(filePath, i));
      }
      i = result ? result.nextIndex : i + 1;
      continue;
    }

    if (line === '\\begin{table}') {
      const result = extractTableFromWrapper(lines, i);
      if (result) {
        builder.addTable(result.headers, result.rows, makeSource(filePath, i));
      }
      i = result ? result.nextIndex : i + 1;
      continue;
    }

    if (line.match(/^\\(maketitle|tableofcontents|listoffigures|listoftables)/)) {
      i++;
      continue;
    }

    if (line.match(/^\\(begin|end)\{[^}]+\}/) && !line.startsWith('\\begin{document}')) {
      i++;
      continue;
    }

    if (line.startsWith('\\')) {
      i++;
      continue;
    }

    const paragraphLines: string[] = [];
    const startIdx = i;
    while (i < lines.length) {
      const currentLine = lines[i].trim();
      if (!currentLine || currentLine.startsWith('%') || currentLine.startsWith('\\')) break;
      paragraphLines.push(currentLine);
      i++;
    }

    if (paragraphLines.length > 0) {
      const content = paragraphLines.join(' ');
      if (content) {
        builder.addParagraph(content, undefined, makeSource(filePath, startIdx));
      }
    }
  }
}

function parseSectionContent(
  lines: string[],
  startIdx: number,
  sectionBuilder: SectionBuilder,
  filePath: string
): number {
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line || line.startsWith('%')) {
      i++;
      continue;
    }

    if (line.match(/^\\(sub)?section\{/) || line.match(/^\\subsubsection\{/) || line.match(/^\\paragraph\{/)) {
      return i;
    }

    if (line === '\\begin{itemize}' || line === '\\begin{enumerate}') {
      const ordered = line === '\\begin{enumerate}';
      const result = extractList(lines, i, ordered);
      sectionBuilder.addList(ordered, result.items, makeSource(filePath, i));
      i = result.nextIndex;
      continue;
    }

    if (line === '\\begin{verbatim}' || line === '\\begin{lstlisting}') {
      const result = extractCodeBlock(lines, i);
      sectionBuilder.addCode(result.language, result.content, makeSource(filePath, i));
      i = result.nextIndex;
      continue;
    }

    if (line === '\\begin{tabular}' || line.match(/^\\begin\{tabular\}/)) {
      const result = extractTable(lines, i);
      if (result) {
        sectionBuilder.addTable(result.headers, result.rows, makeSource(filePath, i));
      }
      i = result ? result.nextIndex : i + 1;
      continue;
    }

    if (line === '\\begin{table}') {
      const result = extractTableFromWrapper(lines, i);
      if (result) {
        sectionBuilder.addTable(result.headers, result.rows, makeSource(filePath, i));
      }
      i = result ? result.nextIndex : i + 1;
      continue;
    }

    if (line.match(/^\\(maketitle|tableofcontents|label|ref|cite|footnote|caption|includegraphics|href)/)) {
      i++;
      continue;
    }

    if (line.match(/^\\(begin|end)\{[^}]+\}/)) {
      i++;
      continue;
    }

    if (line.startsWith('\\')) {
      i++;
      continue;
    }

    const paragraphLines: string[] = [];
    const startLine = i;
    while (i < lines.length) {
      const currentLine = lines[i].trim();
      if (!currentLine || currentLine.startsWith('%') || currentLine.startsWith('\\')) break;
      paragraphLines.push(currentLine);
      i++;
    }

    if (paragraphLines.length > 0) {
      const content = paragraphLines.join(' ');
      if (content) {
        sectionBuilder.addParagraph(content, undefined, makeSource(filePath, startLine));
      }
    }
  }

  return i;
}

function extractList(
  lines: string[],
  startIndex: number,
  ordered: boolean
): { items: IRListItem[]; nextIndex: number } {
  const items: IRListItem[] = [];
  let i = startIndex + 1;
  let currentContent = '';

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line === (ordered ? '\\end{enumerate}' : '\\end{itemize}')) {
      if (currentContent.trim()) {
        items.push({ content: currentContent.trim() });
      }
      return { items, nextIndex: i + 1 };
    }

    if (line.startsWith('\\item')) {
      if (currentContent.trim()) {
        items.push({ content: currentContent.trim() });
      }
      currentContent = line.replace(/^\\item\s*/, '');
      i++;
      continue;
    }

    if (line) {
      currentContent += (currentContent ? ' ' : '') + line;
    }
    i++;
  }

  if (currentContent.trim()) {
    items.push({ content: currentContent.trim() });
  }

  return { items, nextIndex: i };
}

function extractCodeBlock(
  lines: string[],
  startIndex: number
): { language: string; content: string; nextIndex: number } {
  const firstLine = lines[startIndex].trim();
  let language = '';

  const langMatch = firstLine.match(/\\begin\{lstlisting\}(?:\[(.*?)\])?/);
  if (langMatch && langMatch[1]) {
    language = langMatch[1].replace(/language\s*=\s*/, '').trim();
  }

  const contentLines: string[] = [];
  let i = startIndex + 1;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line === '\\end{verbatim}' || line === '\\end{lstlisting}') {
      return { language, content: contentLines.join('\n'), nextIndex: i + 1 };
    }

    contentLines.push(lines[i]);
    i++;
  }

  return { language, content: contentLines.join('\n'), nextIndex: i };
}

function extractTable(
  lines: string[],
  startIndex: number
): { headers: string[]; rows: string[][]; nextIndex: number } | null {
  let i = startIndex;
  const firstLine = lines[i].trim();

  let alignSpec = '';
  const specMatch = firstLine.match(/\\begin\{tabular\}\{([^}]*)\}/);
  if (specMatch) {
    alignSpec = specMatch[1];
  }

  i++;
  const rows: string[][] = [];
  let inHeader = true;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line === '\\end{tabular}') {
      return { headers: rows.length > 0 ? rows[0] : [], rows: rows.slice(1), nextIndex: i + 1 };
    }

    if (line === '\\hline' || line === '\\midrule' || line === '\\toprule' || line === '\\bottomrule') {
      if (inHeader && rows.length > 0) {
        inHeader = false;
      }
      i++;
      continue;
    }

    if (line === '\\\\') {
      i++;
      continue;
    }

    if (line) {
      const cells = line.split('&').map(c => c.replace(/\\\\/g, '').trim());
      rows.push(cells);
    }
    i++;
  }

  return rows.length > 0
    ? { headers: rows[0], rows: rows.slice(1), nextIndex: i }
    : null;
}

function extractTableFromWrapper(
  lines: string[],
  startIndex: number
): { headers: string[]; rows: string[][]; nextIndex: number } | null {
  let i = startIndex + 1;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line === '\\end{table}') {
      return null;
    }

    if (line === '\\begin{tabular}' || line.match(/^\\begin\{tabular\}/)) {
      return extractTable(lines, i);
    }

    i++;
  }

  return null;
}

function makeSource(filePath: string, line: number): { file: string; lineStart: number; lineEnd: number } {
  return { file: filePath, lineStart: line + 1, lineEnd: line + 1 };
}
