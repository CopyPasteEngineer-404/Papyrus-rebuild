import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import { registerAllParsers } from '../../core/parsers';
import { registerAllWorkers } from '../../core/workers';
import { Pipeline } from '../../core/pipeline';
import { registry } from '../../core/registry';
import { APP_NAME, APP_VERSION, CONVERSION_MATRIX, OUTPUT_FORMATS } from '../../shared/constants';
import { detectFormat, formatFileSize, formatDuration } from '../../shared/utils';
import type { OutputFormat, InputFormat } from '../../shared/types';
import { formatOutputPath, formatSuccess, formatError, printHeader } from '../utils';

function resolveOutputFormats(inputFormat: InputFormat, to: string | undefined, all: boolean | undefined): OutputFormat[] {
  if (all) {
    return CONVERSION_MATRIX[inputFormat] || [];
  }
  if (to) {
    const validFormats = Object.keys(OUTPUT_FORMATS);
    const formats = to.split(',').map(f => f.trim().toLowerCase());
    for (const fmt of formats) {
      if (!validFormats.includes(fmt)) {
        console.error(formatError(`Unsupported output format: ${fmt}`));
        process.exit(1);
      }
    }
    return formats as OutputFormat[];
  }
  return [];
}

export function registerConvertCommand(program: Command): void {
  program
    .command('convert')
    .description('Convert one or more files to a target format')
    .argument('<input...>', 'Input file path(s)')
    .option('-t, --to <format>', 'Target output format(s), comma-separated (pdf,md,docx)')
    .option('-a, --all', 'Convert to all supported formats')
    .option('-o, --output <dir>', 'Output directory (defaults to source directory)')
    .action(async (inputPaths: string[], options: { to?: string; all?: boolean; output?: string }) => {
      const startTime = Date.now();
      printHeader();

      if (!options.to && !options.all) {
        console.error(formatError('Specify --to <format> or --all'));
        process.exit(1);
      }

      const outputDir = options.output ? path.resolve(options.output) : process.cwd();

      // Resolve and validate input files
      const resolvedInputs: Array<{ path: string; format: InputFormat }> = [];
      for (const input of inputPaths) {
        const resolved = path.resolve(input);
        try {
          await fs.access(resolved);
          const fmt = detectFormat(resolved) as InputFormat;
          if (!fmt) {
            console.error(formatError(`Unsupported input format: ${path.basename(resolved)}`));
            continue;
          }
          resolvedInputs.push({ path: resolved, format: fmt });
        } catch {
          console.error(formatError(`File not found: ${input}`));
        }
      }

      if (resolvedInputs.length === 0) {
        console.error(formatError('No valid input files found'));
        process.exit(1);
      }

      // Register parsers and workers
      registerAllParsers();
      registerAllWorkers();

      // Ensure output directory exists
      await fs.mkdir(path.resolve(outputDir), { recursive: true });

      const pipeline = new Pipeline();
      let totalOk = 0;
      let totalFail = 0;

      for (const file of resolvedInputs) {
        const outputFormats = resolveOutputFormats(file.format, options.to, options.all);

        for (const format of outputFormats) {
          // Validate worker exists
          if (!registry.getWorker(format)) {
            console.log(formatError(`  x ${path.basename(file.path)} -> ${format}: unsupported`));
            totalFail++;
            continue;
          }

          const spinner = ora({
            text: chalk.cyan(`${path.basename(file.path)} → ${format}...`),
            spinner: 'dots',
          }).start();

          try {
            const result = await pipeline.execute({
              sourceFiles: [file.path],
              outputFormats: [format],
              outputDir: path.resolve(outputDir),
            });

            if (result.task.status === 'failed') {
              spinner.fail(chalk.red(`${path.basename(file.path)} → ${format}: ${result.task.error || 'error'}`));
              totalFail++;
              continue;
            }

            for (const workerResult of result.results) {
              for (const artifact of workerResult.artifacts) {
                const finalPath = path.resolve(outputDir, artifact.filename);
                await fs.mkdir(path.dirname(finalPath), { recursive: true });
                await fs.writeFile(finalPath, artifact.data);
                spinner.succeed(chalk.green(`${path.basename(file.path)} → ${artifact.filename} (${formatFileSize(artifact.size)})`));
                totalOk++;
              }
            }
          } catch (error) {
            spinner.fail(chalk.red(`${path.basename(file.path)} → ${format}: ${error instanceof Error ? error.message : String(error)}`));
            totalFail++;
          }
        }
      }

      const duration = Date.now() - startTime;
      console.log('');
      if (totalFail === 0) {
        console.log(chalk.green(`  ${totalOk}/${totalOk} ok`));
      } else {
        console.log(chalk.yellow(`  ${totalOk} ok, ${totalFail} failed`));
      }
      console.log(chalk.gray(`  Duration: ${formatDuration(duration)}`));
      console.log(chalk.gray(`  Output: ${path.resolve(outputDir)}`));
      console.log('');
    });
}
