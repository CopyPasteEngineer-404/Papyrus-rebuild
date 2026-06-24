import os from 'os';
import { WorkerInput, WorkerResult, OutputFormat } from '../shared/types';
import { Worker, registry } from './registry';
import { logger } from '../shared/utils';

// ---------------------------------------------------------------------------
// Scheduler Configuration
// ---------------------------------------------------------------------------

export interface SchedulerConfig {
  maxWorkers: number;
  maxMemoryMB: number;
  timeoutMs: number;
  retryAttempts: number;
  adaptiveScaling: boolean;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  maxWorkers: Math.min(os.cpus().length, 8),
  maxMemoryMB: Math.floor(os.totalmem() / 1024 / 1024 / 2),
  timeoutMs: 60_000,
  retryAttempts: 2,
  adaptiveScaling: true,
};

// ---------------------------------------------------------------------------
// Concurrency Limiter
// ---------------------------------------------------------------------------

class ConcurrencyLimiter {
  private running = 0;
  private queue: (() => void)[] = [];

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running--;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class Scheduler {
  private config: SchedulerConfig;
  private limiter: ConcurrencyLimiter;
  private logger = logger.child('scheduler');

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.limiter = new ConcurrencyLimiter(this.config.maxWorkers);
  }

  private getWorkerCount(fileSizeBytes: number): number {
    if (!this.config.adaptiveScaling) return this.config.maxWorkers;

    const sizeMB = fileSizeBytes / 1024 / 1024;
    if (sizeMB < 1) return 1;
    if (sizeMB < 10) return Math.min(2, this.config.maxWorkers);
    return Math.min(os.cpus().length, this.config.maxWorkers);
  }

  async execute(input: WorkerInput, format: OutputFormat): Promise<WorkerResult> {
    const worker = registry.getWorker(format);
    if (!worker) {
      return {
        success: false,
        artifacts: [],
        errors: [`No worker registered for format: ${format}`],
        warnings: [],
        duration: 0,
      };
    }

    const fileSize = JSON.stringify(input.ir).length;
    const workerCount = this.getWorkerCount(fileSize);
    this.limiter = new ConcurrencyLimiter(workerCount);

    return this.executeWithRetry(worker, input);
  }

  private async executeWithRetry(worker: Worker, input: WorkerInput, attempt = 0): Promise<WorkerResult> {
    await this.limiter.acquire();

    try {
      const startTime = Date.now();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Worker timeout')), this.config.timeoutMs);
      });

      const result = await Promise.race([
        worker.execute(input),
        timeoutPromise,
      ]);

      const duration = Date.now() - startTime;
      this.logger.debug(`Worker ${worker.id} completed in ${duration}ms`);

      return { ...result, duration };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Worker ${worker.id} failed (attempt ${attempt + 1}): ${message}`);

      if (attempt < this.config.retryAttempts) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.executeWithRetry(worker, input, attempt + 1);
      }

      return {
        success: false,
        artifacts: [],
        errors: [message],
        warnings: [],
        duration: 0,
      };
    } finally {
      this.limiter.release();
    }
  }

  async executeMultiple(inputs: { input: WorkerInput; format: OutputFormat }[]): Promise<WorkerResult[]> {
    const results = await Promise.all(
      inputs.map(({ input, format }) => this.execute(input, format))
    );
    return results;
  }
}
