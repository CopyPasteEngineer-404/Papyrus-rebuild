import { ParseInput, IRDocument } from '../../shared/types';
import { IRBuilder, SectionBuilder } from '../ir/builder';
import { generateId } from '../../shared/utils';
import type { Parser } from '../registry';

export const jsonParser: Parser = {
  id: 'json',
  name: 'JSON Parser',
  extensions: ['.json'],

  async detect(content: Uint8Array): Promise<boolean> {
    const text = new TextDecoder().decode(content).trimStart();
    const first = text[0];
    if (first !== '{' && first !== '[') return false;
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  },

  async parse(input: ParseInput): Promise<IRDocument> {
    const builder = new IRBuilder().setSourceFile(input.filePath);
    let data: unknown;
    try {
      data = JSON.parse(input.content);
    } catch (e) {
      throw new Error(`Failed to parse JSON: ${(e as Error).message}`);
    }

    const title =
      input.options?.title ||
      extractTitle(data, input.filePath) ||
      'Untitled JSON Document';
    builder.setTitle(title);

    processValue(data, builder);

    return builder.build();
  },
};

function extractTitle(data: unknown, filePath: string): string | null {
  if (Array.isArray(data)) {
    return null;
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.title === 'string') return obj.title;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.label === 'string') return obj.label;
  }
  return null;
}

function processValue(data: unknown, builder: IRBuilder | SectionBuilder): void {
  if (data === null || data === undefined) {
    return;
  }

  if (typeof data === 'string') {
    builder.addParagraph(data);
    return;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    builder.addParagraph(String(data));
    return;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      builder.addParagraph('(empty array)');
      return;
    }

    if (data.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      const allKeys = new Set<string>();
      for (const item of data) {
        for (const key of Object.keys(item as object)) {
          allKeys.add(key);
        }
      }
      const headers = Array.from(allKeys);
      const rows = data.map((item) =>
        headers.map((key) => {
          const val = (item as Record<string, unknown>)[key];
          return stringifyValue(val);
        }),
      );
      builder.addTable(headers, rows);
      return;
    }

    const items = data.map((item) => ({
      content: stringifyValue(item),
    }));
    builder.addList(false, items);
    return;
  }

  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const entries = Object.entries(obj);

    if (entries.length === 0) {
      builder.addParagraph('(empty object)');
      return;
    }

    for (const [key, value] of entries) {
      if (value === null || value === undefined) {
        builder.addParagraph(`**${key}:** _null_`);
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        const section = builder.addSection(2, key);
        processValue(value, section);
      } else if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'object' && v !== null && !Array.isArray(v))) {
        const section = builder.addSection(2, key);
        processValue(value, section);
      } else if (Array.isArray(value)) {
        const section = builder.addSection(2, key);
        processValue(value, section);
      } else {
        builder.addParagraph(`**${key}:** ${stringifyValue(value)}`);
      }
    }
    return;
  }

  builder.addParagraph(String(data));
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '_null_';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
