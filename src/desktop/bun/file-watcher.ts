import fs from 'fs';
import path from 'path';
import { detectFormat, logger } from '../../shared/utils';
import { Pipeline } from '../../core/pipeline';
import type { OutputFormat } from '../../shared/types';

// ---------------------------------------------------------------------------
// File Watcher
// ---------------------------------------------------------------------------

export interface WatcherHandle {
  close(): void;
}

export function startWatcher(
  directory: string,
  format: string,
  outputDir: string,
): WatcherHandle {
  const resolvedDir = path.resolve(directory);
  const resolvedOutputDir = path.resolve(outputDir);
  const outputFormat = format as OutputFormat;
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const processing = new Set<string>();
  const pipeline = new Pipeline();
  const log = logger.child('watcher');
  let closed = false;

  const DEBOUNCE_MS = 300;

  async function processFile(filePath: string): Promise<void> {
    if (processing.has(filePath) || closed) return;
    processing.add(filePath);

    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) return;
    } catch {
      return;
    }

    const formatDetected = detectFormat(filePath);
    if (!formatDetected) {
      log.debug(`Skipping unsupported file: ${filePath}`);
      return;
    }

    const relativePath = path.relative(resolvedOutputDir, filePath);
    if (!relativePath.startsWith('..')) {
      log.debug(`Skipping file in output directory: ${filePath}`);
      return;
    }

    log.info(`Processing: ${path.basename(filePath)}`);

    try {
      const result = await pipeline.execute({
        sourceFiles: [filePath],
        outputFormats: [outputFormat],
        outputDir: resolvedOutputDir,
      });

      if (result.task.status === 'failed') {
        log.error(`Failed to convert ${path.basename(filePath)}: ${result.task.error}`);
        return;
      }

      for (const workerResult of result.results) {
        for (const artifact of workerResult.artifacts) {
          const finalPath = path.join(resolvedOutputDir, artifact.filename);
          await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });
          await fs.promises.writeFile(finalPath, artifact.data);
          log.info(`Written: ${artifact.filename} (${artifact.size} bytes)`);
        }
      }
    } catch (error) {
      log.error(`Error converting ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
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
    }, DEBOUNCE_MS);

    debounceTimers.set(filePath, timer);
  }

  let watcher: fs.FSWatcher | null = null;

  try {
    watcher = fs.watch(resolvedDir, { recursive: true }, (eventType, filename) => {
      if (!filename || closed) return;

      const fullPath = path.join(resolvedDir, filename);
      scheduleConversion(fullPath);
    });

    watcher.on('error', (error) => {
      log.error(`Watcher error: ${error.message}`);
    });

    log.info(`Watching: ${resolvedDir} (debounce: ${DEBOUNCE_MS}ms, output: ${outputFormat})`);
  } catch (error) {
    log.error(`Failed to start watcher: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }

  return {
    close() {
      closed = true;

      if (watcher) {
        watcher.close();
        watcher = null;
      }

      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();

      log.info('Watcher stopped');
    },
  };
}
