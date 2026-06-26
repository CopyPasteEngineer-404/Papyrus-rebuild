import fs from 'fs/promises';
import path from 'path';
import { IRDocument, OutputFormat, WorkerInput, WorkerResult, TransformationTask } from '../shared/types';
import { generateId, logger } from '../shared/utils';
import { IRBuilder } from './ir/builder';
import { validateIR, ValidationResult } from './ir/validate';
import { registry } from './registry';
import { Scheduler } from './scheduler';

// ---------------------------------------------------------------------------
// Pipeline Types
// ---------------------------------------------------------------------------

export interface PipelineInput {
  sourceFiles: string[];
  outputFormats: OutputFormat[];
  outputDir: string;
  constraints?: Record<string, unknown>;
  workspaceId?: string;
}

export interface PipelineResult {
  task: TransformationTask;
  results: WorkerResult[];
  validation: ValidationResult;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class Pipeline {
  private scheduler: Scheduler;
  private logger = logger.child('pipeline');

  constructor(scheduler?: Scheduler) {
    this.scheduler = scheduler || new Scheduler();
  }

  async execute(input: PipelineInput): Promise<PipelineResult> {
    const taskId = generateId();
    const startTime = Date.now();

    this.logger.info(`Starting pipeline: ${input.sourceFiles.length} files → ${input.outputFormats.join(', ')}`);

    // Create task
    const task: TransformationTask = {
      id: taskId,
      workspaceId: input.workspaceId || '',
      sourceFiles: input.sourceFiles,
      outputFormat: input.outputFormats[0],
      status: 'running',
      progress: 0,
      results: [],
      createdAt: new Date().toISOString(),
    };

    try {
      // Phase 1: Parse source files
      this.logger.debug('Phase 1: Parsing source files');
      const ir = await this.parseFiles(input.sourceFiles);
      task.progress = 25;

      // Phase 2: Validate IR
      this.logger.debug('Phase 2: Validating IR');
      const validation = validateIR(ir);
      if (!validation.valid) {
        task.status = 'failed';
        task.error = validation.errors.join('; ');
        return { task, results: [], validation };
      }
      task.progress = 50;

      // Phase 3: Execute workers
      this.logger.debug('Phase 3: Executing workers');
      const results = await this.executeWorkers(ir, input.outputFormats, input.outputDir);
      task.progress = 75;

      // Phase 4: Complete
      this.logger.debug('Phase 4: Completing');
      task.results = results;
      task.status = results.every((r) => r.success) ? 'completed' : 'failed';
      task.progress = 100;
      task.completedAt = new Date().toISOString();

      const duration = Date.now() - startTime;
      this.logger.info(`Pipeline completed in ${duration}ms`);

      return { task, results, validation };
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      this.logger.error(`Pipeline failed: ${task.error}`);
      return { task, results: [], validation: { valid: false, errors: [task.error], warnings: [] } };
    }
  }

  private async parseFiles(filePaths: string[]): Promise<IRDocument> {
    const builder = new IRBuilder();
    let firstTitle = '';

    for (const filePath of filePaths) {
      const raw = await fs.readFile(filePath);
      const format = filePath.split('.').pop()?.toLowerCase();
      const binaryFormats = ['docx', 'xlsx', 'pptx', 'epub'];
      const content = binaryFormats.includes(format || '') ? raw.toString('latin1') : raw.toString('utf-8');

      const parser = registry.getParser(format as any);
      if (!parser) {
        this.logger.warn(`No parser for format: ${format}`);
        continue;
      }

      const ir = await parser.parse({
        content,
        filePath,
      });

      if (!firstTitle && ir.title) {
        firstTitle = ir.title;
        builder.setTitle(firstTitle);
      }

      for (const child of ir.children) {
        builder.addRawNode(child);
      }
    }

    if (!firstTitle) {
      builder.setTitle(path.basename(filePaths[0], path.extname(filePaths[0])));
    }

    return builder.build();
  }

  private async executeWorkers(
    ir: IRDocument,
    formats: OutputFormat[],
    outputDir: string
  ): Promise<WorkerResult[]> {
    const inputs: { input: WorkerInput; format: OutputFormat }[] = formats.map((format) => ({
      input: {
        ir,
        outputDir,
      },
      format,
    }));

    return this.scheduler.executeMultiple(inputs);
  }
}
