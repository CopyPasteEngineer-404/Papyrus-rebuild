import { ParseInput, IRDocument } from '../../shared/types';
import { IRBuilder } from '../ir/builder';
import { generateId } from '../../shared/utils';
import type { Parser } from '../registry';

let xlsxModule: any = null;
async function loadXLSX() {
  if (!xlsxModule) {
    xlsxModule = await import('xlsx');
  }
  return xlsxModule;
}

export const xlsxParser: Parser = {
  id: 'xlsx',
  name: 'XLSX Parser',
  extensions: ['.xlsx', '.xls'],

  async detect(content: Uint8Array): Promise<boolean> {
    if (content.length < 4) return false;

    const zipSignature = [0x50, 0x4B, 0x03, 0x04];
    const oleSignature = [0xD0, 0xCF, 0x11, 0xE0];

    const isZip =
      content[0] === zipSignature[0] &&
      content[1] === zipSignature[1] &&
      content[2] === zipSignature[2] &&
      content[3] === zipSignature[3];

    const isOle =
      content[0] === oleSignature[0] &&
      content[1] === oleSignature[1] &&
      content[2] === oleSignature[2] &&
      content[3] === oleSignature[3];

    return isZip || isOle;
  },

  async parse(input: ParseInput): Promise<IRDocument> {
    if (!input.content || input.content.length === 0) {
      return new IRBuilder().setSourceFile(input.filePath).setTitle('Empty XLSX').build();
    }

    const buffer = Buffer.from(input.content, 'binary');

    const XLSX = await loadXLSX();

    let workbook: any;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch (err) {
      throw new Error(`XLSX parsing failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const builder = new IRBuilder();
    builder.setSourceFile(input.filePath);
    builder.setTitle(input.options?.title || extractTitleFromPath(input.filePath));

    const sheetNames = workbook.SheetNames;
    const hasMultipleSheets = sheetNames.length > 1;

    if (hasMultipleSheets) {
      for (const sheetName of sheetNames) {
        const sectionBuilder = builder.addSection(1, sheetName);
        const worksheet = workbook.Sheets[sheetName];
        const table = worksheetToTable(worksheet, XLSX);
        if (table) {
          sectionBuilder.addTable(table.headers, table.rows);
        }
        sectionBuilder.done();
      }
    } else {
      const sheetName = sheetNames[0];
      if (sheetName) {
        const worksheet = workbook.Sheets[sheetName];
        const table = worksheetToTable(worksheet, XLSX);
        if (table) {
          builder.addTable(table.headers, table.rows);
        }
      }
    }

    return builder.build();
  },
};

function extractTitleFromPath(filePath: string): string {
  const basename = filePath.replace(/\\/g, '/').split('/').pop() || 'Untitled';
  return basename.replace(/\.[^.]+$/, '');
}

interface TableData {
  headers: string[];
  rows: string[][];
}

function worksheetToTable(worksheet: any, XLSX: any): TableData | null {
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  const totalRows = range.e.r - range.s.r + 1;
  const totalCols = range.e.c - range.s.c + 1;

  if (totalRows === 0 || totalCols === 0) return null;

  const allRows: string[][] = [];

  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellAddress = XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[cellAddress];
      row.push(formatCellValue(cell));
    }
    allRows.push(row);
  }

  if (allRows.length === 0) return null;

  const firstRow = allRows[0];
  const hasHeaderRow = firstRow && firstRow.some((cell) => cell.trim() !== '' && isNaN(Number(cell)));

  if (hasHeaderRow && allRows.length > 1) {
    return {
      headers: firstRow!,
      rows: allRows.slice(1),
    };
  }

  if (firstRow) {
    return {
      headers: firstRow.map((_, i) => `Column ${i + 1}`),
      rows: allRows,
    };
  }

  return null;
}

function formatCellValue(cell: any): string {
  if (!cell) return '';

  if (cell.w !== undefined) {
    return String(cell.w);
  }

  if (cell.v !== undefined) {
    if (cell.t === 'n') {
      const num = cell.v as number;
      if (Number.isInteger(num)) {
        return num.toString();
      }
      return num.toFixed(2);
    }
    if (cell.t === 'b') {
      return (cell.v as boolean) ? 'TRUE' : 'FALSE';
    }
    if (cell.t === 'd' && cell.v instanceof Date) {
      return cell.v.toISOString().split('T')[0];
    }
    if (cell.t === 'e') {
      return `#ERROR`;
    }
    return String(cell.v);
  }

  return '';
}
