import fs from 'fs/promises';
import path from 'path';
import { WorkerInput, WorkerResult, GeneratedArtifact, IRDocument, IRBlockNode, IRTableNode, IRSectionNode, IRParagraphNode } from '../../shared/types';
import { sanitizeFilename } from '../../shared/utils';
import type { Worker } from '../registry';
import { findNodesByType } from '../ir/traversal';

function escapeCsvField(field: string): string {
  const trimmed = field.trim();
  if (trimmed.includes(',') || trimmed.includes('"') || trimmed.includes('\n') || trimmed.includes('\r')) {
    const escaped = trimmed.replace(/"/g, '""');
    return `"${escaped}"`;
  }
  return trimmed;
}

function tableToCsv(table: IRTableNode): string {
  const lines: string[] = [];
  
  const headerLine = table.headers.map(escapeCsvField).join(',');
  lines.push(headerLine);
  
  for (const row of table.rows) {
    const cells = row.map(cell => escapeCsvField(cell || ''));
    lines.push(cells.join(','));
  }
  
  return lines.join('\r\n');
}

function flattenTextContent(doc: IRDocument): string[] {
  const textLines: string[] = [];
  
  const processNode = (node: IRBlockNode) => {
    switch (node.type) {
      case 'section': {
        const section = node as IRSectionNode;
        textLines.push(section.title);
        for (const child of section.children) {
          processNode(child);
        }
        break;
      }
      case 'paragraph': {
        const para = node as IRParagraphNode;
        if (para.content) {
          textLines.push(para.content);
        }
        break;
      }
      default:
        break;
    }
  };
  
  for (const child of doc.children) {
    processNode(child);
  }
  
  return textLines;
}

export class CSVWorker implements Worker {
  readonly id = 'csv';
  readonly name = 'CSV Worker';
  readonly formats = ['csv'];

  async execute(input: WorkerInput): Promise<WorkerResult> {
    const start = performance.now();
    const artifacts: GeneratedArtifact[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const tables = findNodesByType(input.ir, 'table') as IRTableNode[];
      
      await fs.mkdir(input.outputDir, { recursive: true });
      
      if (tables.length === 0) {
        const textLines = flattenTextContent(input.ir);
        const csvContent = textLines.length > 0
          ? textLines.map(line => escapeCsvField(line)).join('\r\n')
          : 'No content available';
        
        const encoder = new TextEncoder();
        const data = encoder.encode(csvContent);
        const filename = sanitizeFilename(input.ir.title || 'document') + '.csv';
        const outputPath = path.join(input.outputDir, filename);
        
        await fs.writeFile(outputPath, data);
        
        artifacts.push({
          filename,
          data,
          format: 'csv',
          size: data.byteLength,
        });
      } else if (tables.length === 1) {
        const csvContent = tableToCsv(tables[0]);
        const encoder = new TextEncoder();
        const data = encoder.encode(csvContent);
        const filename = sanitizeFilename(input.ir.title || 'document') + '.csv';
        const outputPath = path.join(input.outputDir, filename);
        
        await fs.writeFile(outputPath, data);
        
        artifacts.push({
          filename,
          data,
          format: 'csv',
          size: data.byteLength,
        });
      } else {
        for (let i = 0; i < tables.length; i++) {
          const table = tables[i];
          const csvContent = tableToCsv(table);
          const encoder = new TextEncoder();
          const data = encoder.encode(csvContent);
          
          const baseName = input.ir.title || 'document';
          const filename = sanitizeFilename(`${baseName}_table_${i + 1}`) + '.csv';
          const outputPath = path.join(input.outputDir, filename);
          
          await fs.writeFile(outputPath, data);
          
          artifacts.push({
            filename,
            data,
            format: 'csv',
            size: data.byteLength,
          });
        }
        
        if (tables.length > 3) {
          warnings.push(`Generated ${tables.length} CSV files. Consider if all tables are needed.`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
    }

    const duration = performance.now() - start;
    return { success: errors.length === 0, artifacts, errors, warnings, duration };
  }
}

export const csvWorker = new CSVWorker();
