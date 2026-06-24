import { ParseInput, IRDocument } from '../../shared/types';
import { IRBuilder } from '../ir/builder';
import type { Parser } from '../registry';

// ---------------------------------------------------------------------------
// RFC 4180 CSV state-machine parser
// ---------------------------------------------------------------------------

type CsvState = 'field' | 'quoted' | 'escape';

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let state: CsvState = 'field';
  let i = 0;

  while (i < content.length) {
    const ch = content[i];

    switch (state) {
      case 'field':
        if (ch === '"') {
          state = 'quoted';
        } else if (ch === ',') {
          currentRow.push(currentField);
          currentField = '';
        } else if (ch === '\r') {
          // handle \r\n
          if (i + 1 < content.length && content[i + 1] === '\n') i++;
          currentRow.push(currentField);
          currentField = '';
          rows.push(currentRow);
          currentRow = [];
        } else if (ch === '\n') {
          currentRow.push(currentField);
          currentField = '';
          rows.push(currentRow);
          currentRow = [];
        } else {
          currentField += ch;
        }
        break;

      case 'quoted':
        if (ch === '"') {
          if (i + 1 < content.length && content[i + 1] === '"') {
            // escaped quote
            currentField += '"';
            i += 2;
            continue;
          } else {
            // end of quoted field
            state = 'field';
          }
        } else {
          currentField += ch;
        }
        break;
    }
    i++;
  }

  // flush remaining content
  if (state === 'field') {
    currentRow.push(currentField);
    if (currentRow.length > 0 && !(currentRow.length === 1 && currentRow[0] === '')) {
      rows.push(currentRow);
    }
  } else if (state === 'quoted') {
    // unterminated quote – push what we have
    currentRow.push(currentField);
    if (currentRow.length > 0) {
      rows.push(currentRow);
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// CSV Parser
// ---------------------------------------------------------------------------

export const csvParser: Parser = {
  id: 'csv',
  name: 'CSV',
  extensions: ['.csv'],

  async detect(content: Uint8Array): Promise<boolean> {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(content);
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    // At least one comma and one newline suggest CSV
    const hasComma = trimmed.includes(',');
    const hasNewline = trimmed.includes('\n');
    if (hasComma && hasNewline) return true;
    // Could be single-column CSV (just newlines)
    if (hasNewline && trimmed.split('\n').length > 1) return true;
    return false;
  },

  async parse(input: ParseInput): Promise<IRDocument> {
    const { content, filePath, options } = input;
    const builder = new IRBuilder();
    builder.setSourceFile(filePath);

    const rows = parseCsv(content);

    if (rows.length === 0) {
      builder.setTitle(options?.title || 'Untitled CSV');
      return builder.build();
    }

    const headers = rows[0];
    const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell !== ''));

    builder.setTitle(options?.title || 'CSV Data');
    builder.addTable(headers, dataRows);

    return builder.build();
  },
};
