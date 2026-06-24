import { ParseInput, IRDocument } from '../../shared/types';
import { IRBuilder } from '../ir/builder';
import type { Parser } from '../registry';

// ---------------------------------------------------------------------------
// Plain Text Parser
// ---------------------------------------------------------------------------

export const txtParser: Parser = {
  id: 'txt',
  name: 'Plain Text',
  extensions: ['.txt', '.text'],

  async detect(_content: Uint8Array): Promise<boolean> {
    // Always claim txt — it is the universal fallback.
    return true;
  },

  async parse(input: ParseInput): Promise<IRDocument> {
    const { content, filePath, options } = input;
    const builder = new IRBuilder();
    builder.setSourceFile(filePath);

    // Derive title from filename (strip extension)
    const basename = filePath.replace(/\\/g, '/').split('/').pop() || 'Untitled';
    const titleFromFilename = basename.replace(/\.[^.]+$/, '') || 'Untitled';
    builder.setTitle(options?.title || titleFromFilename);

    const lines = content.split('\n');

    let currentParagraph: string[] = [];

    function flushParagraph() {
      if (currentParagraph.length > 0) {
        builder.addParagraph(currentParagraph.join(' '));
        currentParagraph = [];
      }
    }

    for (const line of lines) {
      if (line.trim() === '') {
        flushParagraph();
      } else {
        currentParagraph.push(line.trim());
      }
    }

    flushParagraph();

    return builder.build();
  },
};
