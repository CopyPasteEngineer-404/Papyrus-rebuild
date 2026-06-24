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
import { formatOutputPath, findSupportedFiles, formatSuccess, formatError, formatInfo, printHeader } from '../utils';

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

export function registerBatchCommand(program: Command): void {
  program
    .command('batch')
    .description('Batch convert all supported files in a directory')
    .argument('<directory>', 'Directory containing files to convert')
    .option('-t, --to <format>', 'Target output format(s), comma-separated (pdf,md,docx)')
    .option('-a, --all', 'Convert to all supported formats')
    .option('-o, --output <dir>', 'Output directory (defaults to <directory>/output)')
    .action(async (directory: string, options: { to?: string; all?: boolean; output?: string }) => {
      const startTime = Date.now();
      printHeader();

      if (!options.to && !options.all) {
        console.error(formatError('Specify --to <format> or --all'));
        process.exit(1);
      }

      const resolvedDir = path.resolve(directory);
      const outputDir = options.output ? path.resolve(options.output) : path.join(resolvedDir, 'output');

      // Validate input directory
      try {
        const stat = await fs.stat(resolvedDir);
        if (!stat.isDirectory()) {
          console.error(formatError(`Not a directory: ${directory}`));
          process.exit(1);
        }
      } catch {
        console.error(formatError(`Directory not found: ${directory}`));
        process.exit(1);
      }

      // Register parsers and workers
      registerAllParsers();
      registerAllWorkers();

      // Find supported files
      const spinner = ora({
        text: chalk.cyan('Scanning for supported files...'),
        spinner: 'dots',
      }).start();

      const files = await findSupportedFiles(resolvedDir);

      if (files.length === 0) {
        spinner.fail(chalk.yellow('No supported files found'));
        console.log(formatInfo(`Searched: ${resolvedDir}`));
        console.log(formatInfo(`Supported extensions: .md, .csv, .txt, .mmd, .tex, .docx, .xlsx, .pptx, .html, .json, .yaml, .yml, .rtf, .epub`));
        process.exit(0);
      }

      spinner.succeed(chalk.green(`Found ${files.length} file(s) to convert`));

      // Ensure output directory
      await fs.mkdir(outputDir, { recursive: true });

      const pipeline = new Pipeline();
      let totalOk = 0;
      let totalFail = 0;
      const totalSize = { input: 0, output: 0 };

      // Count total operations for progress reporting
      let totalOps = 0;
      for (const file of files) {
        const inputFormat = detectFormat(file) as InputFormat;
        const formats = resolveOutputFormats(inputFormat, options.to, options.all);
        totalOps += formats.length;
      }

      console.log('');
      console.log(chalk.gray(`  Output: ${outputDir}`));
      console.log(chalk.gray('─'.repeat(50)));

      let opsDone = 0;

      for (const file of files) {
        const basename = path.basename(file);
        const inputFormat = detectFormat(file) as InputFormat;
        const outputFormats = resolveOutputFormats(inputFormat, options.to, options.all);

        try {
          const inputStat = await fs.stat(file);
          totalSize.input += inputStat.size;
        } catch { /* ignore */ }

        for (const format of outputFormats) {
          opsDone++;

          // Validate worker exists
          if (!registry.getWorker(format)) {
            console.log(formatError(`  x ${basename} -> ${format}: unsupported`));
            totalFail++;
            continue;
          }

          const fileSpinner = ora({
            text: chalk.cyan(`[${opsDone}/${totalOps}] ${basename} → ${format}...`),
            spinner: 'dots',
          }).start();

          try {
            const result = await pipeline.execute({
              sourceFiles: [file],
              outputFormats: [format],
              outputDir,
            });

            if (result.task.status === 'failed') {
              fileSpinner.fail(chalk.red(`[${opsDone}/${totalOps}] ${basename} → ${format}: ${result.task.error || 'error'}`));
              totalFail++;
              continue;
            }

            for (const workerResult of result.results) {
              for (const artifact of workerResult.artifacts) {
                const finalPath = path.join(outputDir, artifact.filename);
                await fs.mkdir(path.dirname(finalPath), { recursive: true });
                await fs.writeFile(finalPath, artifact.data);
                totalSize.output += artifact.size;
                fileSpinner.succeed(
                  chalk.green(`[${opsDone}/${totalOps}] ${basename} → ${artifact.filename} (${formatFileSize(artifact.size)})`)
                );
                totalOk++;
              }
            }
          } catch (error) {
            fileSpinner.fail(chalk.red(`[${opsDone}/${totalOps}] ${basename} → ${format}: ${error instanceof Error ? error.message : String(error)}`));
            totalFail++;
          }
        }
      }

      // Summary
      const duration = Date.now() - startTime;
      console.log('');
      console.log(chalk.gray('─'.repeat(50)));
      console.log('');
      console.log(chalk.bold('  Summary'));
      console.log(`  ${formatSuccess(`${totalOk} converted`)}`);
      if (totalFail > 0) {
        console.log(`  ${formatError(`${totalFail} failed`)}`);
      }
      console.log(`  ${formatInfo(`Input: ${formatFileSize(totalSize.input)} → Output: ${formatFileSize(totalSize.output)}`)}`);
      console.log(`  ${formatInfo(`Duration: ${formatDuration(duration)}`)}`);
      console.log('');
    });
}
