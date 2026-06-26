import type { RTFDocument, RTFSpan } from 'rtf-parser';
import { ParseInput, IRDocument } from '../../shared/types';
import { IRBuilder } from '../ir/builder';
import type { Parser } from '../registry';

let rtfModule: any = null;
async function loadRtfParser() {
  if (!rtfModule) {
    rtfModule = (await import('rtf-parser')).default;
  }
  return rtfModule;
}

async function parseRtf(content: string): Promise<RTFDocument> {
  const rtfParser = await loadRtfParser();
  return new Promise((resolve, reject) => {
    const readable = rtfParser.parse(content);
    const chunks: RTFDocument[] = [];

    readable.on('data', (doc: RTFDocument) => {
      chunks.push(doc);
    });

    readable.on('end', () => {
      if (chunks.length > 0) {
        resolve(chunks[0]);
      } else {
        reject(new Error('RTF parsing produced no output'));
      }
    });

    readable.on('error', (err: Error) => {
      reject(err);
    });
  });
}

function collectText(content: RTFSpan[]): string {
  return content.map((span) => span.value ?? '').join('');
}

function detectHeadingLevel(text: string): { level: number; title: string } | null {
  const match = text.match(/^(\d+)\.\s+(.+)/);
  if (match) {
    const level = parseInt(match[1], 10);
    if (level >= 1 && level <= 6) {
      return { level, title: match[2].trim() };
    }
  }
  return null;
}

export const rtfParserImpl: Parser = {
  id: 'rtf',
  name: 'RTF Parser',
  extensions: ['.rtf'],

  async detect(content: Uint8Array): Promise<boolean> {
    const text = new TextDecoder('ascii', { fatal: false }).decode(content.slice(0, 32));
    return text.trimStart().startsWith('{\\rtf');
  },

  async parse(input: ParseInput): Promise<IRDocument> {
    const doc = await parseRtf(input.content).catch((e: Error) => {
      throw new Error(`Failed to parse RTF: ${e.message}`);
    });
    const builder = new IRBuilder().setSourceFile(input.filePath);

    const docTitle =
      input.options?.title ||
      doc.info?.title ||
      input.filePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.rtf$/i, '') ||
      'Untitled RTF Document';
    builder.setTitle(docTitle);

    if (doc.info?.author || doc.info?.created) {
      const meta: Record<string, unknown> = {};
      if (doc.info.author) meta.author = doc.info.author;
      if (doc.info.created) meta.created = doc.info.created;
      builder.setFrontmatter(meta);
    }

    const paragraphs = Array.isArray(doc.content) ? doc.content : [doc.content];

    for (const paragraph of paragraphs) {
      if (!paragraph || !paragraph.content) continue;

      const text = collectText(paragraph.content).trim();
      if (!text) continue;

      const heading = detectHeadingLevel(text);
      if (heading) {
        builder.addSection(heading.level, heading.title);
      } else {
        builder.addParagraph(text);
      }
    }

    return builder.build();
  },
};

export default rtfParserImpl;
