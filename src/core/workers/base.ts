import { WorkerInput, WorkerResult, GeneratedArtifact } from '../../shared/types';
import { generateId, logger as defaultLogger, Logger } from '../../shared/utils';
import type { Worker } from '../registry';

export abstract class BaseWorker implements Worker {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly formats: string[];

  protected logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? defaultLogger.child(this.constructor.name);
  }

  async execute(input: WorkerInput): Promise<WorkerResult> {
    const start = performance.now();
    const artifacts: GeneratedArtifact[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    this.logger.info(`Starting worker "${this.name}"`);

    try {
      const result = await this.process(input);
      artifacts.push(...result.artifacts);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Worker "${this.name}" failed: ${message}`);
      errors.push(message);
    }

    const duration = performance.now() - start;
    const success = errors.length === 0;

    this.logger.info(
      `Worker "${this.name}" finished in ${duration.toFixed(0)}ms — ` +
      `success=${success}, artifacts=${artifacts.length}, errors=${errors.length}, warnings=${warnings.length}`
    );

    return { success, artifacts, errors, warnings, duration };
  }

  protected abstract process(input: WorkerInput): Promise<Omit<WorkerResult, 'duration'>>;

  protected makeArtifact(
    filename: string,
    data: Uint8Array,
    format: GeneratedArtifact['format']
  ): GeneratedArtifact {
    return {
      filename,
      data,
      format,
      size: data.byteLength,
    };
  }

  protected createArtifactId(): string {
    return generateId();
  }
}
