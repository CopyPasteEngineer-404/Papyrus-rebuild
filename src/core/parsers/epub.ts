import epub from 'epub2';
import { ParseInput, IRDocument } from '../../shared/types';
import { IRBuilder } from '../ir/builder';
import type { Parser } from '../registry';

interface EpubChapter {
  id: string;
  href: string;
  title: string;
}

interface EpubMetadata {
  title?: string;
  creator?: string;
  language?: string;
  publisher?: string;
  date?: string;
}

interface EpubInstance {
  metadata: EpubMetadata;
  flow: EpubChapter[];
  getFile(id: string, callback: (err: Error | null, data: Buffer) => void): void;
}

function openEpub(filePath: string): Promise<EpubInstance> {
  return new Promise((resolve, reject) => {
    epub.open(filePath, (err: Error | null, data: EpubInstance) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

function getChapterHtml(book: EpubInstance, chapterId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    book.getFile(chapterId, (err: Error | null, data: Buffer) => {
      if (err) return reject(err);
      resolve(data.toString('utf-8'));
    });
  });
}

function stripHtml(html: string): string {
  let text = html;
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function parseChapterContent(
  html: string,
  builder: IRBuilder | ReturnType<IRBuilder['addSection']>,
) {
  const lines = html.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      if (title) {
        if (builder instanceof IRBuilder) {
          builder.addSection(level, title);
        } else {
          builder.addSection(level, title);
        }
        continue;
      }
    }

    const listMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (listMatch) {
      const items = lines
        .filter((l) => l.trim().match(/^[-*]\s+/))
        .map((l) => ({ content: l.trim().replace(/^[-*]\s+/, '') }));
      if (items.length > 0) {
        builder.addList(false, items);
      }
      continue;
    }

    builder.addParagraph(trimmed);
  }
}

export const epubParser: Parser = {
  id: 'epub',
  name: 'EPUB Parser',
  extensions: ['.epub'],

  async detect(content: Uint8Array): Promise<boolean> {
    const text = new TextDecoder('ascii', { fatal: false }).decode(content.slice(0, 4));
    return text === 'PK\x03\x04';
  },

  async parse(input: ParseInput): Promise<IRDocument> {
    const book = await openEpub(input.filePath);
    const builder = new IRBuilder().setSourceFile(input.filePath);

    const docTitle =
      input.options?.title ||
      book.metadata.title ||
      input.filePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.epub$/i, '') ||
      'Untitled EPUB Document';
    builder.setTitle(docTitle);

    const meta: Record<string, unknown> = {};
    if (book.metadata.creator) meta.author = book.metadata.creator;
    if (book.metadata.language) meta.language = book.metadata.language;
    if (book.metadata.publisher) meta.publisher = book.metadata.publisher;
    if (book.metadata.date) meta.date = book.metadata.date;
    if (Object.keys(meta).length > 0) {
      builder.setFrontmatter(meta);
    }

    const chapters = book.flow || [];

    for (const chapter of chapters) {
      if (!chapter || !chapter.id) continue;

      const chapterTitle = chapter.title || `Chapter`;
      const section = builder.addSection(1, chapterTitle);

      try {
        const html = await getChapterHtml(book, chapter.id);
        const text = stripHtml(html);
        if (!text) continue;

        parseChapterContent(text, section);
      } catch {
        continue;
      }
    }

    return builder.build();
  },
};

export default epubParser;
