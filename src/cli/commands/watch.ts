import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';
import { registerAllParsers } from '../../core/parsers';
import { registerAllWorkers } from '../../core/workers';
import { Pipeline } from '../../core/pipeline';
import { registry } from '../../core/registry';
import { detectFormat, formatFileSize, formatDuration } from '../../shared/utils';
import type { OutputFormat } from '../../shared/types';
import { formatOutputPath, findSupportedFiles, formatSuccess, formatError, formatInfo, printHeader } from '../utils';

export function registerWatchCommand(program: Command): void {
  program
    .command('watch')
    .description('Watch a directory for new/modified files and convert automatically')
    .argument('<directory>', 'Directory to watch')
    .requiredOption('-t, --to <format>', 'Target output format (pdf, md, txt, html, docx, xlsx, pptx, csv, latex, epub)')
    .option('-o, --output <dir>', 'Output directory (defaults to <directory>/output)')
    .option('-d, --debounce <ms>', 'Debounce delay in milliseconds', '500')
    .action(async (directory: string, options: { to: string; output?: string; debounce: string }) => {
      printHeader();

      const outputFormat = options.to.toLowerCase() as OutputFormat;
      const resolvedDir = path.resolve(directory);
      const outputDir = options.output ? path.resolve(options.output) : path.join(resolvedDir, 'output');
      const debounceMs = parseInt(options.debounce, 10) || 500;

      // Register parsers and workers first
      registerAllParsers();
      registerAllWorkers();

      // Validate output format
      const worker = registry.getWorker(outputFormat);
      if (!worker) {
        console.error(formatError(`Unsupported output format: ${outputFormat}`));
        process.exit(1);
      }

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

      // Ensure output directory
      await fs.mkdir(outputDir, { recursive: true });

      const pipeline = new Pipeline();
      const processing = new Set<string>();
      const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

      console.log(formatInfo(`Watching: ${resolvedDir}`));
      console.log(formatInfo(`Output format: ${outputFormat}`));
      console.log(formatInfo(`Output directory: ${outputDir}`));
      console.log(formatInfo(`Debounce: ${debounceMs}ms`));
      console.log('');
      console.log(chalk.gray('Press Ctrl+C to stop'));
      console.log('');

      async function processFile(filePath: string): Promise<void> {
        if (processing.has(filePath)) return;
        processing.add(filePath);

        const basename = path.basename(filePath);
        const spinner = ora({
          text: chalk.cyan(`Converting ${basename}...`),
          spinner: 'dots',
        }).start();

        try {
          const result = await pipeline.execute({
            sourceFiles: [filePath],
            outputFormats: [outputFormat],
            outputDir,
          });

          if (result.task.status === 'failed') {
            spinner.fail(chalk.red(`Failed: ${basename}`));
            if (result.task.error) {
              console.log(`  ${chalk.red(result.task.error)}`);
            }
            return;
          }

          for (const workerResult of result.results) {
            for (const artifact of workerResult.artifacts) {
              const finalPath = path.join(outputDir, artifact.filename);
              await fs.mkdir(path.dirname(finalPath), { recursive: true });
              await fs.writeFile(finalPath, artifact.data);
              spinner.succeed(
                formatSuccess(`${basename} → ${artifact.filename} (${formatFileSize(artifact.size)})`)
              );
            }
          }
        } catch (error) {
          spinner.fail(chalk.red(`Failed: ${basename}`));
          console.log(`  ${chalk.red(error instanceof Error ? error.message : String(error))}`);
        } finally {
          processing.delete(filePath);
        }
      }

      function scheduleConversion(filePath: string): void {
        const existing = debounceTimers.get(filePath);
        if (existing) {
          clearTimeout(existing);
        }

        const timer = setTimeout(() => {
          debounceTimers.delete(filePath);
          processFile(filePath);
        }, debounceMs);

        debounceTimers.set(filePath, timer);
      }

      // Use fs.watch with recursive option (works on most platforms)
      let watcher: { close(): void } | null = null;

      try {
        watcher = fsSync.watch(resolvedDir, { recursive: true }, async (eventType: string, filename: string | null) => {
          if (!filename) return;

          const fullPath = path.join(resolvedDir, filename);

          // Check if file exists (might have been deleted)
          try {
            const stat = await fs.stat(fullPath);
            if (!stat.isFile()) return;
          } catch {
            return; // File doesn't exist, skip
          }

          const format = detectFormat(fullPath);
          if (!format) return;

          // Ignore output directory
          if (fullPath.startsWith(outputDir + path.sep)) return;

          scheduleConversion(fullPath);
        });
      } catch (error) {
        console.error(formatError(`Failed to start watcher: ${error instanceof Error ? error.message : String(error)}`));
        process.exit(1);
      }

      // Handle graceful shutdown
      const cleanup = async (): Promise<void> => {
        console.log('\n');
        console.log(chalk.gray('Stopping watcher...'));

        if (watcher) {
          watcher.close();
        }

        // Clear pending timers
        for (const timer of debounceTimers.values()) {
          clearTimeout(timer);
        }
        debounceTimers.clear();

        // Wait for in-progress conversions
        const maxWait = 10_000;
        const start = Date.now();
        while (processing.size > 0 && Date.now() - start < maxWait) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        console.log(formatInfo('Watcher stopped'));
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    });
}
