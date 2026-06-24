import { registry } from '../registry';
import { markdownParser } from './markdown';
import { csvParser } from './csv';
import { txtParser } from './txt';
import { mermaidParser } from './mermaid';
import { latexParser } from './latex';
import { docxParser } from './docx';
import { xlsxParser } from './xlsx';
import { htmlParser } from './html';
import { jsonParser } from './json';
import { yamlParser } from './yaml';
import { rtfParserImpl as rtfParser } from './rtf';
import epubParser from './epub';
import { pptxParser } from './pptx';

export function registerAllParsers(): void {
  const parsers = [
    markdownParser,
    csvParser,
    txtParser,
    mermaidParser,
    latexParser,
    docxParser,
    xlsxParser,
    pptxParser,
    htmlParser,
    jsonParser,
    yamlParser,
    rtfParser,
    epubParser,
  ];

  for (const parser of parsers) {
    try {
      registry.registerParser(parser);
    } catch {
      // Skip parsers that fail to register
    }
  }
}

export {
  markdownParser,
  csvParser,
  txtParser,
  mermaidParser,
  latexParser,
  docxParser,
  xlsxParser,
  pptxParser,
  htmlParser,
  jsonParser,
  yamlParser,
  rtfParser,
  epubParser,
};
