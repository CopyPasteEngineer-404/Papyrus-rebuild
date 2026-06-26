import fs from 'fs/promises';
import path from 'path';
import {
  WorkerInput,
  WorkerResult,
  IRDocument,
  IRNode,
  IRSectionNode,
  IRParagraphNode,
  IRListNode,
  IRTableNode,
  IRCodeNode,
  IRQuoteNode,
  IRImageNode,
  IRFootnoteNode,
  IRReferenceNode,
  IRDiagramNode,
  flattenInline,
} from '../../shared/types';
import { sanitizeFilename } from '../../shared/utils';
import { walkIR } from '../ir/traversal';
import { BaseWorker } from './base';

export class TxtWorker extends BaseWorker {
  readonly id = 'txt';
  readonly name = 'PlainText';
  readonly formats = ['txt'];

  protected async process(input: WorkerInput): Promise<Omit<WorkerResult, 'duration'>> {
    const { ir, outputDir, sourceFile } = input;

    const lines: string[] = [];

    if (ir.title) {
      lines.push(ir.title.toUpperCase());
      lines.push('='.repeat(ir.title.length));
      lines.push('');
    }

    walkIR(ir, (node: IRNode) => {
      if (node.id === ir.id) return;

      const rendered = this.renderNode(node, ir);
      if (rendered !== null) {
        lines.push(rendered);
        lines.push('');
      }
    });

    const text = lines.join('\n');
    const data = new TextEncoder().encode(text);

    const baseName = sourceFile
      ? path.basename(sourceFile, path.extname(sourceFile))
      : sanitizeFilename(ir.title || 'output');
    const filename = `${baseName}.txt`;
    const outputPath = path.join(outputDir, filename);

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, data);

    this.logger.info(`Wrote ${data.byteLength} bytes to ${outputPath}`);

    return {
      success: true,
      artifacts: [this.makeArtifact(filename, data, 'txt')],
      errors: [],
      warnings: [],
    };
  }

  private renderNode(node: IRNode, _doc: IRDocument): string | null {
    switch (node.type) {
      case 'section':
        return this.renderSection(node as IRSectionNode);
      case 'paragraph': {
        const para = node as IRParagraphNode;
        return para.inline ? flattenInline(para.inline) : para.content;
      }
      case 'list':
        return this.renderList(node as IRListNode);
      case 'table':
        return this.renderTable(node as IRTableNode);
      case 'code':
        return this.renderCode(node as IRCodeNode);
      case 'quote':
        return this.renderQuote(node as IRQuoteNode);
      case 'image':
        return this.renderImage(node as IRImageNode);
      case 'footnote':
        return this.renderFootnote(node as IRFootnoteNode);
      case 'reference':
        return this.renderReference(node as IRReferenceNode);
      case 'diagram':
        return `[Diagram: ${(node as IRDiagramNode).content}]`;
      case 'pageBreak':
        return '---';
      case 'toc':
        return '[Table of Contents]';
      case 'math':
        return (node as any).content || '';
      case 'slide':
        return null;
      default:
        return null;
    }
  }

  private renderSection(node: IRSectionNode): string {
    const title = node.title.toUpperCase();
    const underline = node.level <= 2 ? '='.repeat(title.length) : '-'.repeat(title.length);
    return `${title}\n${underline}`;
  }

  private renderList(node: IRListNode): string {
    return node.items
      .map((item, i) => {
        const prefix = node.ordered ? `${i + 1}. ` : '- ';
        const text = item.inline ? flattenInline(item.inline) : item.content;
        return `${prefix}${text}`;
      })
      .join('\n');
  }

  private renderTable(node: IRTableNode): string {
    const lines: string[] = [];

    lines.push(node.headers.join('\t'));
    lines.push(node.headers.map(() => '---').join('\t'));

    for (const row of node.rows) {
      lines.push(row.join('\t'));
    }

    return lines.join('\n');
  }

  private renderCode(node: IRCodeNode): string {
    const lang = node.language ? ` [${node.language}]` : '';
    return `--- Code${lang} ---\n${node.content}\n--- End Code ---`;
  }

  private renderQuote(node: IRQuoteNode): string {
    const text = node.inline ? flattenInline(node.inline) : node.content;
    const quoted = text.split('\n').map((line) => `> ${line}`).join('\n');
    if (node.author) {
      return `${quoted}\n> -- ${node.author}`;
    }
    return quoted;
  }

  private renderImage(node: IRImageNode): string {
    return `[Image: ${node.alt || 'no alt text'}] ${node.src}`;
  }

  private renderFootnote(node: IRFootnoteNode): string {
    return `[${node.label}]: ${node.content}`;
  }

  private renderReference(node: IRReferenceNode): string {
    return `[${node.label}]: ${node.content}`;
  }
}
