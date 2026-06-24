import { ParseInput, IRDocument } from '../../shared/types';
import { IRBuilder } from '../ir/builder';
import { generateId } from '../../shared/utils';
import type { Parser } from '../registry';

export const mermaidParser: Parser = {
  id: 'mermaid',
  name: 'Mermaid Diagram',
  extensions: ['.mmd', '.mermaid'],

  async detect(content: Uint8Array): Promise<boolean> {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(content);
    const trimmed = text.trimStart();

    const diagramKeywords = [
      'graph', 'flowchart', 'sequenceDiagram', 'classDiagram',
      'stateDiagram', 'erDiagram', 'gantt', 'pie', 'gitGraph',
      'journey', 'mindmap', 'timeline', 'sankey', 'block-beta',
    ];

    for (const keyword of diagramKeywords) {
      if (trimmed.startsWith(keyword)) return true;
    }

    return false;
  },

  async parse(input: ParseInput): Promise<IRDocument> {
    const { content, filePath } = input;

    const title = extractTitle(content, filePath);

    const builder = new IRBuilder()
      .setSourceFile(filePath)
      .setTitle(title);

    const lineCount = content.split('\n').length;
    builder.addDiagram(content, 'mermaid', {
      file: filePath,
      lineStart: 1,
      lineEnd: lineCount,
    });

    return builder.build();
  },
};

function extractTitle(content: string, filePath: string): string {
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('%')) {
      const title = trimmed.slice(1).trim();
      if (title) return title;
    }

    if (trimmed.startsWith('#')) {
      const title = trimmed.replace(/^#+\s*/, '').trim();
      if (title) return title;
    }

    break;
  }

  const basename = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
  return basename.replace(/\.(mmd|mermaid)$/i, '') || 'Untitled Diagram';
}
