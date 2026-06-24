import { registry } from '../registry';
import { PDFWorker, pdfWorker } from './pdf';
import { MarkdownWorker } from './markdown';
import { TxtWorker } from './txt';
import { HTMLWorker, htmlWorker } from './html';
import { DOCXWorker } from './docx';
import { XLSXWorker } from './xlsx';
import { PPTXWorker } from './pptx';
import { CSVWorker, csvWorker } from './csv';
import { LaTeXWorker } from './latex';
import { EPUBWorker } from './epub';

export function registerAllWorkers(): void {
  const workers = [
    new PDFWorker(),
    new MarkdownWorker(),
    new TxtWorker(),
    new HTMLWorker(),
    new DOCXWorker(),
    new XLSXWorker(),
    new PPTXWorker(),
    new CSVWorker(),
    LaTeXWorker,
    EPUBWorker,
  ];

  for (const worker of workers) {
    try {
      registry.registerWorker(worker);
    } catch {
      // Skip workers that fail to register
    }
  }
}

export {
  PDFWorker,
  pdfWorker,
  MarkdownWorker,
  TxtWorker,
  HTMLWorker,
  htmlWorker,
  DOCXWorker,
  XLSXWorker,
  PPTXWorker,
  CSVWorker,
  csvWorker,
  LaTeXWorker,
  EPUBWorker,
};
