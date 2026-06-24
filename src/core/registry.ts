import { InputFormat, OutputFormat, ParseInput, IRDocument, WorkerInput, WorkerResult } from '../shared/types';
import { detectFormat } from '../shared/utils';

// ---------------------------------------------------------------------------
// Parser Interface
// ---------------------------------------------------------------------------

export interface Parser {
  id: string;
  name: string;
  extensions: string[];
  detect(content: Uint8Array): Promise<boolean>;
  parse(input: ParseInput): Promise<IRDocument>;
}

// ---------------------------------------------------------------------------
// Worker Interface
// ---------------------------------------------------------------------------

export interface Worker {
  id: string;
  name: string;
  formats: string[];
  execute(input: WorkerInput): Promise<WorkerResult>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

class Registry {
  private parsers = new Map<string, Parser>();
  private workers = new Map<string, Worker>();

  // Parser methods
  registerParser(parser: Parser): void {
    this.parsers.set(parser.id, parser);
  }

  getParser(format: InputFormat): Parser | undefined {
    for (const parser of this.parsers.values()) {
      if (parser.id === format || parser.extensions.some((ext) => ext === `.${format}`)) {
        return parser;
      }
    }
    return undefined;
  }

  detectParser(filePath: string, content: Uint8Array): Parser | null {
    const format = detectFormat(filePath);
    if (!format) return null;
    return this.getParser(format) || null;
  }

  getRegisteredParsers(): Parser[] {
    return Array.from(this.parsers.values());
  }

  // Worker methods
  registerWorker(worker: Worker): void {
    this.workers.set(worker.id, worker);
  }

  getWorker(format: OutputFormat): Worker | undefined {
    for (const worker of this.workers.values()) {
      if (worker.formats.includes(format)) {
        return worker;
      }
    }
    return undefined;
  }

  getRegisteredWorkers(): Worker[] {
    return Array.from(this.workers.values());
  }

  getSupportedInputFormats(): InputFormat[] {
    const formats = new Set<InputFormat>();
    for (const parser of this.parsers.values()) {
      for (const ext of parser.extensions) {
        const format = ext.slice(1) as InputFormat;
        formats.add(format);
      }
    }
    return Array.from(formats);
  }

  getSupportedOutputFormats(): OutputFormat[] {
    const formats = new Set<OutputFormat>();
    for (const worker of this.workers.values()) {
      for (const fmt of worker.formats) {
        formats.add(fmt as OutputFormat);
      }
    }
    return Array.from(formats);
  }
}

export const registry = new Registry();
