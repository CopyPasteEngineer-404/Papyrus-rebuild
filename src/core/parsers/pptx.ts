import { ParseInput, IRDocument, IRBlockNode } from '../../shared/types';
import { IRBuilder } from '../ir/builder';
import { generateId } from '../../shared/utils';
import type { Parser } from '../registry';

let PptxParserClass: any = null;

async function loadPptxParser() {
  if (!PptxParserClass) {
    const mod = await import('pptx-parser');
    PptxParserClass = mod.default;
  }
  return PptxParserClass;
}

export const pptxParser: Parser = {
  id: 'pptx',
  name: 'PPTX Parser',
  extensions: ['.pptx'],

  async detect(content: Uint8Array): Promise<boolean> {
    if (content.length < 4) return false;
    const signature = [0x50, 0x4B, 0x03, 0x04];
    return (
      content[0] === signature[0] &&
      content[1] === signature[1] &&
      content[2] === signature[2] &&
      content[3] === signature[3]
    );
  },

  async parse(input: ParseInput): Promise<IRDocument> {
    const PptxParser = await loadPptxParser();
    const buffer = Buffer.from(input.content, 'binary');
    const parser = new PptxParser();

    const slides = parser.parse(buffer);

    const builder = new IRBuilder();
    builder.setSourceFile(input.filePath);
    builder.setTitle(input.options?.title || extractTitleFromPath(input.filePath));

    if (slides && slides.length > 0) {
      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        const slideTitle = slide.title || `Slide ${i + 1}`;
        const slideBuilder = builder.addSlide(slideTitle);

        if (slide.notes) {
          slideBuilder.addParagraph(slide.notes);
        }

        if (slide.text && slide.text.trim()) {
          processSlideText(slideBuilder, slide.text);
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

interface SlideBuilder {
  addParagraph(content: string, source?: unknown): SlideBuilder;
  addList(ordered: boolean, items: { content: string; children?: IRBlockNode[] }[], source?: unknown): SlideBuilder;
  addImage(src: string, alt?: string, source?: unknown): SlideBuilder;
  done(): unknown;
}

function processSlideText(slideBuilder: SlideBuilder, text: string): void {
  const lines = text.split('\n');
  const currentList: { content: string }[] = [];
  let listOrdered = false;
  let inList = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      flushList(slideBuilder, currentList, listOrdered, inList);
      inList = false;
      currentList.length = 0;
      continue;
    }

    const unorderedMatch = line.match(/^[\s]*[-*•]\s+(.+)/);
    const orderedMatch = line.match(/^[\s]*(\d+[.)]\s+)(.+)/);

    if (unorderedMatch) {
      if (!inList || listOrdered) {
        flushList(slideBuilder, currentList, listOrdered, inList);
        currentList.length = 0;
        inList = true;
        listOrdered = false;
      }
      currentList.push({ content: unorderedMatch[1].trim() });
      continue;
    }

    if (orderedMatch) {
      if (!inList || !listOrdered) {
        flushList(slideBuilder, currentList, listOrdered, inList);
        currentList.length = 0;
        inList = true;
        listOrdered = true;
      }
      currentList.push({ content: orderedMatch[2].trim() });
      continue;
    }

    flushList(slideBuilder, currentList, listOrdered, inList);
    inList = false;
    currentList.length = 0;

    slideBuilder.addParagraph(line.trim());
  }

  flushList(slideBuilder, currentList, listOrdered, inList);
}

function flushList(
  slideBuilder: SlideBuilder,
  items: { content: string }[],
  ordered: boolean,
  inList: boolean
): void {
  if (!inList || items.length === 0) return;
  slideBuilder.addList(ordered, [...items]);
}
