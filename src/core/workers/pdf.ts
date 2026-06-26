import fs from 'fs/promises';
import path from 'path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { WorkerInput, WorkerResult, GeneratedArtifact, IRBlockNode, IRSectionNode, IRParagraphNode, IRListNode, IRTableNode, IRCodeNode, IRQuoteNode, IRImageNode, IRDiagramNode, IRMathNode, IRInlineNode, flattenInline } from '../../shared/types';
import { sanitizeFilename } from '../../shared/utils';
import type { Worker } from '../registry';
import { findNodesByType, extractHeadings } from '../ir/traversal';

export class PDFWorker implements Worker {
  readonly id = 'pdf';
  readonly name = 'PDF Worker';
  readonly formats = ['pdf'];

  async execute(input: WorkerInput): Promise<WorkerResult> {
    const start = performance.now();
    const artifacts: GeneratedArtifact[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const pdfDoc = await PDFDocument.create();
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const courier = await pdfDoc.embedFont(StandardFonts.Courier);

      const margins = { top: 72, bottom: 72, left: 72, right: 72 }; // 1 inch margins
      const pageWidth = 612;
      const pageHeight = 792;
      const contentWidth = pageWidth - margins.left - margins.right;
      const lineHeight = 14; // Base line height
      const headingLineHeight = lineHeight * 1.5; // 1.5x for headings
      const paragraphLineHeight = lineHeight * 1.15; // 1.15x for paragraphs
      const paragraphSpacing = 6; // 6pt after paragraph

      let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
      let yPosition = pageHeight - margins.top;

      const checkNewPage = (needed: number = lineHeight) => {
        if (yPosition - needed < margins.bottom) {
          currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
          yPosition = pageHeight - margins.top;
        }
      };

      const sanitizeForPdf = (text: string): string => {
        // Replace non-WinAnsi characters with readable alternatives
        return text
          .replace(/\u2705/g, '[Yes]')   // ✅
          .replace(/\u274C/g, '[No]')    // ❌
          .replace(/\u2714/g, '[x]')     // ✔
          .replace(/\u2716/g, '[x]')     // ✖
          .replace(/[\u{1F000}-\u{1FFFF}]/gu, '') // Strip other emoji
          .replace(/[^\x00-\x7F\u00A0-\u00FF\u0152\u0153\u0160\u0161\u0178\u017D\u017E]/g, '');
      };

      const wrapText = (text: string, font: any, fontSize: number, maxWidth: number): string[] => {
        text = sanitizeForPdf(text);
        const result: string[] = [];
        const paragraphs = text.split('\n');
        for (const paragraph of paragraphs) {
          const words = paragraph.split(' ');
          let currentLine = '';
          for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const width = font.widthOfTextAtSize(testLine, fontSize);
            if (width > maxWidth && currentLine) {
              result.push(currentLine);
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          }
          if (currentLine) result.push(currentLine);
        }
        return result.length > 0 ? result : [''];
      };

      const drawText = (text: string, font: any, fontSize: number, color?: any) => {
        const textColor = color || rgb(0, 0, 0);
        const lines = wrapText(text, font, fontSize, contentWidth);
        for (const line of lines) {
          checkNewPage();
          currentPage.drawText(line, {
            x: margins.left,
            y: yPosition,
            size: fontSize,
            font,
            color: textColor,
          });
          yPosition -= lineHeight;
        }
      };

      const drawTextAt = (text: string, startX: number, font: any, fontSize: number, color?: any) => {
        const textColor = color || rgb(0, 0, 0);
        const remaining = contentWidth - (startX - margins.left);
        const lines = wrapText(text, font, fontSize, remaining);
        for (let li = 0; li < lines.length; li++) {
          checkNewPage();
          const x = li === 0 ? startX : margins.left;
          currentPage.drawText(lines[li], {
            x,
            y: yPosition,
            size: fontSize,
            font,
            color: textColor,
          });
          yPosition -= lineHeight;
        }
      };

      const drawInlineNodes = (nodes: IRInlineNode[], baseFont: any, fontSize: number) => {
        let x = margins.left;
        for (const node of nodes) {
          switch (node.type) {
            case 'inline-text': {
              const font = baseFont;
              const lines = wrapText(node.content, font, fontSize, contentWidth - (x - margins.left));
              for (let li = 0; li < lines.length; li++) {
                checkNewPage();
                const drawX = li === 0 ? x : margins.left;
                currentPage.drawText(lines[li], {
                  x: drawX,
                  y: yPosition,
                  size: fontSize,
                  font,
                  color: rgb(0, 0, 0),
                });
                yPosition -= lineHeight;
              }
              if (lines.length > 0) {
                const lastLine = lines[lines.length - 1];
                x = margins.left + font.widthOfTextAtSize(lastLine, fontSize);
              }
              break;
            }
            case 'inline-bold': {
              const font = helveticaBold;
              const text = flattenInline(node.children);
              const lines = wrapText(text, font, fontSize, contentWidth - (x - margins.left));
              for (let li = 0; li < lines.length; li++) {
                checkNewPage();
                const drawX = li === 0 ? x : margins.left;
                currentPage.drawText(lines[li], {
                  x: drawX,
                  y: yPosition,
                  size: fontSize,
                  font,
                  color: rgb(0, 0, 0),
                });
                yPosition -= lineHeight;
              }
              if (lines.length > 0) {
                const lastLine = lines[lines.length - 1];
                x = margins.left + font.widthOfTextAtSize(lastLine, fontSize);
              }
              break;
            }
            case 'inline-italic': {
              const font = helvetica;
              const text = flattenInline(node.children);
              const lines = wrapText(text, font, fontSize, contentWidth - (x - margins.left));
              for (let li = 0; li < lines.length; li++) {
                checkNewPage();
                const drawX = li === 0 ? x : margins.left;
                currentPage.drawText(lines[li], {
                  x: drawX,
                  y: yPosition,
                  size: fontSize,
                  font,
                  color: rgb(0.4, 0.4, 0.4),
                });
                yPosition -= lineHeight;
              }
              if (lines.length > 0) {
                const lastLine = lines[lines.length - 1];
                x = margins.left + font.widthOfTextAtSize(lastLine, fontSize);
              }
              break;
            }
            case 'inline-code': {
              const font = courier;
              const text = node.content;
              const lines = wrapText(text, font, fontSize, contentWidth - (x - margins.left));
              for (let li = 0; li < lines.length; li++) {
                checkNewPage();
                const drawX = li === 0 ? x : margins.left;
                currentPage.drawText(lines[li], {
                  x: drawX,
                  y: yPosition,
                  size: fontSize,
                  font,
                  color: rgb(0.3, 0.3, 0.3),
                });
                yPosition -= lineHeight;
              }
              if (lines.length > 0) {
                const lastLine = lines[lines.length - 1];
                x = margins.left + font.widthOfTextAtSize(lastLine, fontSize);
              }
              break;
            }
            case 'inline-link': {
              const font = helvetica;
              const text = flattenInline(node.children);
              const lines = wrapText(text, font, fontSize, contentWidth - (x - margins.left));
              for (let li = 0; li < lines.length; li++) {
                checkNewPage();
                const drawX = li === 0 ? x : margins.left;
                currentPage.drawText(lines[li], {
                  x: drawX,
                  y: yPosition,
                  size: fontSize,
                  font,
                  color: rgb(0, 0.3, 0.7),
                });
                yPosition -= lineHeight;
              }
              if (lines.length > 0) {
                const lastLine = lines[lines.length - 1];
                x = margins.left + font.widthOfTextAtSize(lastLine, fontSize);
              }
              break;
            }
            case 'inline-strikethrough': {
              const font = baseFont;
              const text = flattenInline(node.children);
              const lines = wrapText(text, font, fontSize, contentWidth - (x - margins.left));
              for (let li = 0; li < lines.length; li++) {
                checkNewPage();
                const drawX = li === 0 ? x : margins.left;
                currentPage.drawText(lines[li], {
                  x: drawX,
                  y: yPosition,
                  size: fontSize,
                  font,
                  color: rgb(0.5, 0.5, 0.5),
                });
                yPosition -= lineHeight;
              }
              if (lines.length > 0) {
                const lastLine = lines[lines.length - 1];
                x = margins.left + font.widthOfTextAtSize(lastLine, fontSize);
              }
              break;
            }
          }
        }
      };

      const drawInlineNodesAt = (nodes: IRInlineNode[], startX: number, baseFont: any, fontSize: number) => {
        let x = startX;
        for (const node of nodes) {
          switch (node.type) {
            case 'inline-text': {
              const font = baseFont;
              const remaining = contentWidth - (x - margins.left);
              const lines = wrapText(node.content, font, fontSize, remaining);
              for (let li = 0; li < lines.length; li++) {
                checkNewPage();
                const drawX = li === 0 ? x : margins.left;
                currentPage.drawText(lines[li], {
                  x: drawX,
                  y: yPosition,
                  size: fontSize,
                  font,
                  color: rgb(0, 0, 0),
                });
                yPosition -= lineHeight;
              }
              if (lines.length > 0) {
                const lastLine = lines[lines.length - 1];
                x = margins.left + font.widthOfTextAtSize(lastLine, fontSize);
              }
              break;
            }
            case 'inline-bold': {
              const font = helveticaBold;
              const text = flattenInline(node.children);
              const remaining = contentWidth - (x - margins.left);
              const lines = wrapText(text, font, fontSize, remaining);
              for (let li = 0; li < lines.length; li++) {
                checkNewPage();
                const drawX = li === 0 ? x : margins.left;
                currentPage.drawText(lines[li], {
                  x: drawX,
                  y: yPosition,
                  size: fontSize,
                  font,
                  color: rgb(0, 0, 0),
                });
                yPosition -= lineHeight;
              }
              if (lines.length > 0) {
                const lastLine = lines[lines.length - 1];
                x = margins.left + font.widthOfTextAtSize(lastLine, fontSize);
              }
              break;
            }
            default: {
              const text = flattenInline([node]);
              drawTextAt(text, x, baseFont, fontSize);
              x = margins.left;
              break;
            }
          }
        }
      };

      const drawTitle = (title: string) => {
        checkNewPage(headingLineHeight * 2);
        const titleLines = wrapText(title, helveticaBold, 24, contentWidth);
        for (const line of titleLines) {
          checkNewPage();
          currentPage.drawText(line, {
            x: margins.left,
            y: yPosition,
            size: 24,
            font: helveticaBold,
            color: rgb(0.1, 0.1, 0.1),
          });
          yPosition -= headingLineHeight;
        }
        yPosition -= lineHeight * 2;
      };

      const drawToc = (headings: { level: number; title: string }[]) => {
        checkNewPage(headingLineHeight * 2);
        drawText('Table of Contents', helveticaBold, 18, rgb(0.1, 0.1, 0.1));
        yPosition -= headingLineHeight;

        for (const heading of headings) {
          const indent = (heading.level - 1) * 20;
          const fontSize = Math.max(8, 12 - heading.level);
          const headingLines = wrapText(heading.title, helvetica, fontSize, contentWidth - indent);
          for (const line of headingLines) {
            checkNewPage();
            currentPage.drawText(line, {
              x: margins.left + indent,
              y: yPosition,
              size: fontSize,
              font: helvetica,
              color: rgb(0.2, 0.2, 0.2),
            });
            yPosition -= lineHeight;
          }
        }
        yPosition -= lineHeight;
      };

      const drawPageNumbers = (pageNumber: number, totalPages: number) => {
        const pageNumberText = `${pageNumber} / ${totalPages}`;
        const pageNumberWidth = helvetica.widthOfTextAtSize(pageNumberText, 10);
        currentPage.drawText(pageNumberText, {
          x: pageWidth - margins.right - pageNumberWidth,
          y: margins.bottom + 15,
          size: 10,
          font: helvetica,
          color: rgb(0.5, 0.5, 0.5),
        });
      };

      const drawSection = (section: IRSectionNode) => {
        checkNewPage(headingLineHeight * 2);
        const fontSize = Math.max(12, 18 - (section.level - 1) * 2);
        drawText(section.title, helveticaBold, fontSize, rgb(0.1, 0.1, 0.3));
        yPosition -= headingLineHeight * 0.5;
        yPosition -= lineHeight; // Extra spacing after section
      };

      const drawParagraph = (para: IRParagraphNode) => {
        if (para.inline && para.inline.length > 0) {
          drawInlineNodes(para.inline, helvetica, 11);
        } else {
          drawText(para.content, helvetica, 11);
        }
        yPosition -= paragraphLineHeight;
        yPosition -= paragraphSpacing;
      };

      const drawList = (list: IRListNode) => {
        for (let i = 0; i < list.items.length; i++) {
          const item = list.items[i];
          const bullet = list.ordered ? `${i + 1}.` : '•';
          checkNewPage();
          const bulletWidth = helvetica.widthOfTextAtSize(`${bullet} `, 11);
          currentPage.drawText(`${bullet} `, {
            x: margins.left,
            y: yPosition,
            size: 11,
            font: helvetica,
            color: rgb(0, 0, 0),
          });
          const saveX = margins.left + bulletWidth;
          if (item.inline && item.inline.length > 0) {
            drawInlineNodesAt(item.inline, saveX, helvetica, 11);
          } else {
            drawTextAt(item.content, saveX, helvetica, 11);
          }
          yPosition -= lineHeight * 0.3;
        }
        yPosition -= lineHeight; // Extra spacing after list
      };

      const drawTable = (table: IRTableNode) => {
        const colWidth = contentWidth / table.headers.length;
        const cellPadding = 5;
        const headerFontSize = 10;
        const cellFontSize = 9;

        const calcCellHeight = (lines: number) => {
          return Math.max(lineHeight, lines * (cellFontSize + 2) + cellPadding * 2);
        };

        // Draw headers
        checkNewPage(headingLineHeight * 2);
        for (let i = 0; i < table.headers.length; i++) {
          const header = table.headers[i];
          const wrappedLines = wrapText(header, helveticaBold, headerFontSize, colWidth - cellPadding * 2);
          const cellH = calcCellHeight(wrappedLines.length);
          currentPage.drawRectangle({
            x: margins.left + i * colWidth,
            y: yPosition - cellH,
            width: colWidth,
            height: cellH,
            borderColor: rgb(0.5, 0.5, 0.5),
            borderWidth: 0.5,
            color: rgb(0.9, 0.9, 0.9),
          });
          let lineY = yPosition - cellPadding - headerFontSize;
          for (const line of wrappedLines) {
            currentPage.drawText(line, {
              x: margins.left + i * colWidth + cellPadding,
              y: lineY,
              size: headerFontSize,
              font: helveticaBold,
              color: rgb(0, 0, 0),
            });
            lineY -= headerFontSize + 2;
          }
        }
        // Use max header height
        let maxHeaderHeight = 0;
        for (const header of table.headers) {
          const wrappedLines = wrapText(header, helveticaBold, headerFontSize, colWidth - cellPadding * 2);
          maxHeaderHeight = Math.max(maxHeaderHeight, calcCellHeight(wrappedLines.length));
        }
        yPosition -= maxHeaderHeight;

        // Draw rows
        for (const row of table.rows) {
          let maxRowHeight = lineHeight;
          const rowWrappedLines: string[][] = [];
          for (let i = 0; i < row.length; i++) {
            const cell = row[i] || '';
            const lines = wrapText(cell, helvetica, cellFontSize, colWidth - cellPadding * 2);
            rowWrappedLines.push(lines);
            maxRowHeight = Math.max(maxRowHeight, calcCellHeight(lines.length));
          }

          checkNewPage(maxRowHeight);
          for (let i = 0; i < row.length; i++) {
            currentPage.drawRectangle({
              x: margins.left + i * colWidth,
              y: yPosition - maxRowHeight,
              width: colWidth,
              height: maxRowHeight,
              borderColor: rgb(0.5, 0.5, 0.5),
              borderWidth: 0.5,
            });
            let lineY = yPosition - cellPadding - cellFontSize;
            for (const line of rowWrappedLines[i]) {
              currentPage.drawText(line, {
                x: margins.left + i * colWidth + cellPadding,
                y: lineY,
                size: cellFontSize,
                font: helvetica,
                color: rgb(0, 0, 0),
              });
              lineY -= cellFontSize + 2;
            }
          }
          yPosition -= maxRowHeight;
        }
        yPosition -= lineHeight;
      };

      const drawCode = (code: IRCodeNode) => {
        checkNewPage();
        currentPage.drawRectangle({
          x: margins.left,
          y: yPosition - lineHeight,
          width: contentWidth,
          height: lineHeight * (code.content.split('\n').length + 1),
          color: rgb(0.95, 0.95, 0.95),
        });

        const lines = code.content.split('\n');
        for (const line of lines) {
          checkNewPage();
          currentPage.drawText(line.substring(0, 80), {
            x: margins.left + 10,
            y: yPosition,
            size: 9,
            font: courier,
            color: rgb(0.2, 0.2, 0.2),
          });
          yPosition -= lineHeight * 0.9;
        }
        yPosition -= lineHeight;
      };

      const drawQuote = (quote: IRQuoteNode) => {
        checkNewPage(lineHeight * 2);
        const content = quote.inline && quote.inline.length > 0
          ? flattenInline(quote.inline)
          : quote.content;
        const quoteLines = wrapText(`"${content}"`, helvetica, 11, contentWidth - 30);
        for (const line of quoteLines) {
          checkNewPage();
          currentPage.drawText(line, {
            x: margins.left + 30,
            y: yPosition,
            size: 11,
            font: helvetica,
            color: rgb(0.4, 0.4, 0.4),
          });
          yPosition -= lineHeight;
        }
        if (quote.author) {
          checkNewPage();
          currentPage.drawText(`— ${quote.author}`, {
            x: margins.left + 30,
            y: yPosition,
            size: 10,
            font: helvetica,
            color: rgb(0.5, 0.5, 0.5),
          });
          yPosition -= lineHeight;
        }
        yPosition -= lineHeight;
      };

      const drawPageBreak = () => {
        currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
        yPosition = pageHeight - margins.top;
        // Add page number to new page
        drawPageNumbers(pdfDoc.getPageCount(), pdfDoc.getPageCount());
      };

      // Add page number to first page
      drawPageNumbers(1, pdfDoc.getPageCount());

      drawTitle(input.ir.title);

      const tocNodes = findNodesByType(input.ir, 'toc');
      if (tocNodes.length > 0) {
        const headings = extractHeadings(input.ir);
        drawToc(headings);
      }

      const processNode = (node: IRBlockNode) => {
        switch (node.type) {
          case 'section':
            drawSection(node);
            for (const child of node.children) {
              processNode(child);
            }
            break;
          case 'paragraph':
            drawParagraph(node);
            break;
          case 'list':
            drawList(node);
            break;
          case 'table':
            drawTable(node);
            break;
          case 'code':
            drawCode(node);
            break;
          case 'quote':
            drawQuote(node);
            break;
          case 'pageBreak':
            drawPageBreak();
            break;
          case 'toc':
            break;
          case 'image':
            checkNewPage();
            drawText(`[Image: ${(node as IRImageNode).alt || 'No alt text'}]`, helvetica, 10, rgb(0.5, 0.5, 0.5));
            break;
          case 'diagram':
            checkNewPage();
            drawText(`[Diagram: ${(node as IRDiagramNode).engine}]`, helvetica, 10, rgb(0.5, 0.5, 0.5));
            break;
          case 'math':
            checkNewPage();
            drawText(`[Math: ${(node as IRMathNode).content.substring(0, 50)}]`, helvetica, 10, rgb(0.5, 0.5, 0.5));
            break;
          default:
            break;
        }
      };

      for (const child of input.ir.children) {
        processNode(child);
      }

      const pdfBytes = await pdfDoc.save();
      const filename = sanitizeFilename(input.ir.title || 'document') + '.pdf';
      const outputPath = path.join(input.outputDir, filename);

      await fs.mkdir(input.outputDir, { recursive: true });
      await fs.writeFile(outputPath, pdfBytes);

      artifacts.push({
        filename,
        data: pdfBytes,
        format: 'pdf',
        size: pdfBytes.byteLength,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
    }

    const duration = performance.now() - start;
    return { success: errors.length === 0, artifacts, errors, warnings, duration };
  }
}

export const pdfWorker = new PDFWorker();
