import fs from 'fs/promises';
import path from 'path';
import * as XLSX from 'xlsx';
import { WorkerInput, WorkerResult, GeneratedArtifact, IRBlockNode } from '../../shared/types';
import { sanitizeFilename } from '../../shared/utils';
import { findNodesByType } from '../ir/traversal';
import { BaseWorker } from './base';

export class XLSXWorker extends BaseWorker {
  readonly id = 'xlsx';
  readonly name = 'XLSX';
  readonly formats = ['xlsx'];

  protected async process(input: WorkerInput): Promise<Omit<WorkerResult, 'duration'>> {
    const { ir, outputDir, sourceFile } = input;

    const workbook = XLSX.utils.book_new();
    const tables = findNodesByType(ir, 'table') as unknown as { type: 'table'; headers: string[]; rows: string[][] }[];

    if (tables.length > 0) {
      for (let i = 0; i < tables.length; i++) {
        const table = tables[i];
        const sheetData = [table.headers, ...table.rows];
        const worksheet = XLSX.utils.aoa_to_sheet(sheetData);

        this.applyColumnWidths(worksheet, table.headers);
        this.styleHeaderRow(worksheet, table.headers.length);

        const sheetName = `Table ${i + 1}`;
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      }
    } else {
      const textContent = this.extractTextContent(ir);
      const lines = textContent.split('\n').filter((line) => line.trim());
      const sheetData = lines.map((line) => [line]);
      const worksheet = XLSX.utils.aoa_to_sheet(sheetData);

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Content');
    }

    const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const data = new Uint8Array(xlsxBuffer);

    const baseName = sourceFile
      ? path.basename(sourceFile, path.extname(sourceFile))
      : sanitizeFilename(ir.title || 'output');
    const filename = `${baseName}.xlsx`;
    const outputPath = path.join(outputDir, filename);

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, data);

    this.logger.info(`Wrote ${data.byteLength} bytes to ${outputPath}`);

    return {
      success: true,
      artifacts: [this.makeArtifact(filename, data, 'xlsx')],
      errors: [],
      warnings: [],
    };
  }

  private applyColumnWidths(worksheet: XLSX.WorkSheet, headers: string[]): void {
    const colWidths = headers.map((header) => ({
      wch: Math.max(header.length + 2, 12),
    }));
    worksheet['!cols'] = colWidths;
  }

  private styleHeaderRow(worksheet: XLSX.WorkSheet, headerCount: number): void {
    for (let col = 0; col < headerCount; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
      if (worksheet[cellRef]) {
        worksheet[cellRef].s = {
          font: { bold: true, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: '2F5496' } },
          alignment: { horizontal: 'center' },
        };
      }
    }
  }

  private extractTextContent(ir: any): string {
    const texts: string[] = [];

    if (ir.title) {
      texts.push(ir.title);
    }

    if (ir.children) {
      for (const child of ir.children) {
        this.extractNodeText(child, texts);
      }
    }

    return texts.join('\n');
  }

  private extractNodeText(node: IRBlockNode, texts: string[]): void {
    switch (node.type) {
      case 'section':
        texts.push(`${'#'.repeat(node.level)} ${node.title}`);
        if ((node as any).children) {
          for (const child of (node as any).children) {
            this.extractNodeText(child, texts);
          }
        }
        break;
      case 'paragraph':
        texts.push(node.content);
        break;
      case 'list':
        for (const item of node.items) {
          texts.push(`- ${item.content}`);
        }
        break;
      case 'table':
        texts.push(node.headers.join(' | '));
        for (const row of node.rows) {
          texts.push(row.join(' | '));
        }
        break;
      case 'code':
        texts.push(`[${node.language || 'code'}] ${node.content}`);
        break;
      case 'quote':
        texts.push(`> ${node.content}${node.author ? ` — ${node.author}` : ''}`);
        break;
      case 'image':
        texts.push(`[Image: ${node.alt || node.src}]`);
        break;
      case 'math':
        texts.push(`[Math: ${node.content}]`);
        break;
      case 'diagram':
        texts.push(`[Diagram: ${node.content}]`);
        break;
      default:
        break;
    }
  }
}
