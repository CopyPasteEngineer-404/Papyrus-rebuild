import fs from 'fs/promises';
import path from 'path';
import { WorkerInput, WorkerResult } from '../../shared/types';
import { sanitizeFilename } from '../../shared/utils';
import { serializeIR } from '../ir/serialize';
import { BaseWorker } from './base';

export class MarkdownWorker extends BaseWorker {
  readonly id = 'markdown';
  readonly name = 'Markdown';
  readonly formats = ['md'];

  protected async process(input: WorkerInput): Promise<Omit<WorkerResult, 'duration'>> {
    const { ir, outputDir, sourceFile } = input;

    const markdown = serializeIR(ir);
    const data = new TextEncoder().encode(markdown);

    const baseName = sourceFile
      ? path.basename(sourceFile, path.extname(sourceFile))
      : sanitizeFilename(ir.title || 'output');
    const filename = `${baseName}.md`;
    const outputPath = path.join(outputDir, filename);

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, data);

    this.logger.info(`Wrote ${data.byteLength} bytes to ${outputPath}`);

    return {
      success: true,
      artifacts: [this.makeArtifact(filename, data, 'md')],
      errors: [],
      warnings: [],
    };
  }
}
