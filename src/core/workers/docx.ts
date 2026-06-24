import fs from 'fs/promises';
import path from 'path';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  ShadingType,
  LevelFormat,
  UnderlineType,
  convertInchesToTwip,
} from 'docx';
import { WorkerInput, WorkerResult, GeneratedArtifact, IRBlockNode, IRInlineNode, IRParagraphNode, IRListNode, IRTableNode, IRCodeNode, IRQuoteNode, IRImageNode, IRDiagramNode, IRMathNode, flattenInline } from '../../shared/types';
import { sanitizeFilename } from '../../shared/utils';
import { walkIR } from '../ir/traversal';
import { BaseWorker } from './base';

const HEADING_MAP: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

function mapHeadingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  return HEADING_MAP[level] ?? HeadingLevel.HEADING_1;
}

function inlineToTextRuns(nodes: IRInlineNode[]): TextRun[] {
  return nodes.map(node => {
    switch (node.type) {
      case 'inline-text':
        return new TextRun({ text: node.content });
      case 'inline-bold':
        return new TextRun({ text: flattenInline(node.children), bold: true });
      case 'inline-italic':
        return new TextRun({ text: flattenInline(node.children), italics: true });
      case 'inline-code':
        return new TextRun({
          text: node.content,
          font: 'Courier New',
          shading: { type: ShadingType.CLEAR, fill: 'F5F5F5' },
        });
      case 'inline-link':
        return new TextRun({
          text: flattenInline(node.children),
          color: '0563C1',
          underline: { type: UnderlineType.SINGLE },
        });
      case 'inline-strikethrough':
        return new TextRun({ text: flattenInline(node.children), strike: true });
      default:
        return new TextRun({ text: '' });
    }
  });
}

export class DOCXWorker extends BaseWorker {
  readonly id = 'docx';
  readonly name = 'DOCX';
  readonly formats = ['docx'];

  protected async process(input: WorkerInput): Promise<Omit<WorkerResult, 'duration'>> {
    const { ir, outputDir, sourceFile } = input;

    const sections = this.buildSections(ir.children);
    const doc = new Document({
      creator: 'Papyrus',
      title: ir.title || 'Untitled',
      numbering: {
        config: [
          {
            reference: 'ordered-list',
            levels: [
              {
                level: 0,
                format: LevelFormat.DECIMAL,
                text: '%1.',
                alignment: AlignmentType.LEFT,
                style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } },
              },
              {
                level: 1,
                format: LevelFormat.LOWER_LETTER,
                text: '%2.',
                alignment: AlignmentType.LEFT,
                style: { paragraph: { indent: { left: convertInchesToTwip(1.0), hanging: convertInchesToTwip(0.25) } } },
              },
            ],
          },
          {
            reference: 'unordered-list',
            levels: [
              {
                level: 0,
                format: LevelFormat.BULLET,
                text: '\u2022',
                alignment: AlignmentType.LEFT,
                style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } },
              },
              {
                level: 1,
                format: LevelFormat.BULLET,
                text: '\u25E6',
                alignment: AlignmentType.LEFT,
                style: { paragraph: { indent: { left: convertInchesToTwip(1.0), hanging: convertInchesToTwip(0.25) } } },
              },
            ],
          },
        ],
      },
      styles: {
        default: {
          document: {
            run: { font: 'Calibri', size: 22 }, // 11pt
            paragraph: { spacing: { after: 200, line: 276 } }, // 1.15 line spacing
          },
        },
      },
      sections: [{
        properties: {
          page: {
            size: { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) }, // Letter
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
            },
          },
        },
        children: sections,
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const data = new Uint8Array(buffer);

    const baseName = sourceFile
      ? path.basename(sourceFile, path.extname(sourceFile))
      : sanitizeFilename(ir.title || 'output');
    const filename = `${baseName}.docx`;
    const outputPath = path.join(outputDir, filename);

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, data);

    this.logger.info(`Wrote ${data.byteLength} bytes to ${outputPath}`);

    return {
      success: true,
      artifacts: [this.makeArtifact(filename, data, 'docx')],
      errors: [],
      warnings: [],
    };
  }

  private buildSections(nodes: IRBlockNode[]): (Paragraph | Table)[] {
    const elements: (Paragraph | Table)[] = [];

    for (const node of nodes) {
      const converted = this.convertNode(node);
      if (converted) {
        elements.push(...(Array.isArray(converted) ? converted : [converted]));
      }
    }

    return elements;
  }

  private convertNode(node: IRBlockNode): (Paragraph | Table)[] | Paragraph | Table | null {
    switch (node.type) {
      case 'section':
        return this.convertSection(node as any);
      case 'paragraph':
        return this.convertParagraph(node as any);
      case 'list':
        return this.convertList(node as any);
      case 'table':
        return this.convertTable(node as any);
      case 'code':
        return this.convertCode(node as any);
      case 'quote':
        return this.convertQuote(node as any);
      case 'pageBreak':
        return new Paragraph({ pageBreakBefore: true });
      case 'image':
        return new Paragraph({
          children: [new TextRun({ text: `[Image: ${node.alt || node.src}]`, italics: true, color: '888888' })],
        });
      case 'math':
        return new Paragraph({
          children: [new TextRun({ text: node.content, font: 'Cambria Math' })],
        });
      case 'diagram':
        return new Paragraph({
          children: [new TextRun({ text: `[Diagram: ${node.content}]`, italics: true, color: '888888' })],
        });
      case 'footnote':
        return new Paragraph({
          children: [
            new TextRun({ text: `[${node.label}] `, bold: true, superScript: true, size: 16 }),
            new TextRun({ text: node.content, size: 16 }),
          ],
        });
      case 'reference':
        return new Paragraph({
          children: [
            new TextRun({ text: `[${node.label}] `, bold: true }),
            new TextRun({ text: node.content }),
          ],
        });
      default:
        return null;
    }
  }

  private convertSection(node: { type: 'section'; level: number; title: string; children: IRBlockNode[] }): (Paragraph | Table)[] {
    const elements: (Paragraph | Table)[] = [
      new Paragraph({
        heading: mapHeadingLevel(node.level),
        children: [new TextRun({ text: node.title, bold: true })],
      }),
    ];

    for (const child of node.children) {
      const converted = this.convertNode(child);
      if (converted) {
        elements.push(...(Array.isArray(converted) ? converted : [converted]));
      }
    }

    return elements;
  }

  private convertParagraph(node: IRParagraphNode): Paragraph {
    const children = node.inline && node.inline.length > 0
      ? inlineToTextRuns(node.inline)
      : [new TextRun({ text: node.content })];
    return new Paragraph({ children });
  }

  private convertList(node: IRListNode): Paragraph[] {
    return node.items.map((item, index) => {
      const bullet = node.ordered ? `${index + 1}. ` : '\u2022 ';
      const contentRuns = item.inline && item.inline.length > 0
        ? inlineToTextRuns(item.inline)
        : [new TextRun({ text: item.content })];
      return new Paragraph({
        children: [
          new TextRun({ text: bullet, bold: true }),
          ...contentRuns,
        ],
        indent: { left: 720 },
      });
    });
  }

  private convertTable(node: { type: 'table'; headers: string[]; rows: string[][] }): Table {
    const headerRow = new TableRow({
      children: node.headers.map(
        (header) =>
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: header, bold: true, color: 'FFFFFF' })],
                alignment: AlignmentType.CENTER,
              }),
            ],
            shading: { type: ShadingType.SOLID, color: '2F5496', fill: '2F5496' },
            width: { size: Math.floor(100 / node.headers.length), type: WidthType.PERCENTAGE },
            margins: { top: 60, right: 60, bottom: 60, left: 60 },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' },
              left: { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' },
              right: { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' },
            },
          })
      ),
    });

    const dataRows = node.rows.map(
      (row, rowIndex) =>
        new TableRow({
          children: row.map(
            (cell) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: cell })],
                    alignment: AlignmentType.LEFT,
                  }),
                ],
                width: { size: Math.floor(100 / node.headers.length), type: WidthType.PERCENTAGE },
                margins: { top: 60, right: 60, bottom: 60, left: 60 },
                borders: {
                  top: { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' },
                  bottom: { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' },
                  left: { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' },
                  right: { style: BorderStyle.SINGLE, size: 1, color: 'BFBFBF' },
                },
                shading: { type: ShadingType.CLEAR, fill: rowIndex % 2 === 0 ? 'F8F9FA' : 'FFFFFF' },
              })
          ),
        })
    );

    return new Table({
      rows: [headerRow, ...dataRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 2, color: '2F5496' },
        bottom: { style: BorderStyle.SINGLE, size: 2, color: '2F5496' },
        left: { style: BorderStyle.SINGLE, size: 2, color: '2F5496' },
        right: { style: BorderStyle.SINGLE, size: 2, color: '2F5496' },
      },
    });
  }

  private convertCode(node: { type: 'code'; language: string; content: string }): Paragraph[] {
    const lines = node.content.split('\n');
    const paragraphs: Paragraph[] = [];

    if (node.language) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: `Language: ${node.language}`, italics: true, color: '666666', size: 18 })],
          spacing: { after: 100 },
        })
      );
    }

    for (const line of lines) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: line, font: 'Courier New', size: 18 })],
          spacing: { after: 0 },
          shading: { type: ShadingType.CLEAR, fill: 'F5F5F5' },
          indent: { left: 360 },
        })
      );
    }

    return paragraphs;
  }

  private convertQuote(node: IRQuoteNode): Paragraph[] {
    const contentRuns = node.inline && node.inline.length > 0
      ? inlineToTextRuns(node.inline)
      : [new TextRun({ text: node.content, italics: true })];
    const paragraphs: Paragraph[] = [
      new Paragraph({
        children: contentRuns,
        indent: { left: 720, right: 720 },
        border: {
          left: { style: BorderStyle.SINGLE, size: 12, color: '2F5496', space: 10 },
        },
        shading: { type: ShadingType.CLEAR, fill: 'F0F4FA' },
      }),
    ];

    if (node.author) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: `\u2014 ${node.author}`, bold: true })],
          indent: { left: 720, right: 720 },
          alignment: AlignmentType.RIGHT,
        })
      );
    }

    return paragraphs;
  }
}
