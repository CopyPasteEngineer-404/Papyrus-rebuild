import fs from 'fs/promises';
import path from 'path';
import { Pipeline } from '../../core/pipeline';
import { registry } from '../../core/registry';
import { INPUT_FORMATS, OUTPUT_FORMATS } from '../../shared/constants';
import { detectFormat, logger } from '../../shared/utils';
import { startWatcher, type WatcherHandle } from './file-watcher';
import type {
  ConvertRequest,
  ConvertResponse,
  FormatsResponse,
  WatchRequest,
  WatchResponse,
  StatusResponse,
} from '../shared/rpc-types';
import type { OutputFormat } from '../../shared/types';

// ---------------------------------------------------------------------------
// Active Watchers
// ---------------------------------------------------------------------------

const activeWatchers = new Map<string, WatcherHandle>();

// ---------------------------------------------------------------------------
// Convert Handler
// ---------------------------------------------------------------------------

export async function handleConvert(req: ConvertRequest): Promise<ConvertResponse> {
  const log = logger.child('rpc:convert');

  try {
    const outputFormat = req.format.toLowerCase() as OutputFormat;
    const resolvedOutputDir = path.resolve(req.outputDir);

    // Validate output format
    const worker = registry.getWorker(outputFormat);
    if (!worker) {
      return {
        success: false,
        error: `Unsupported output format: ${outputFormat}`,
      };
    }

    // Validate and resolve input files
    const resolvedFiles: string[] = [];
    for (const filePath of req.files) {
      const resolved = path.resolve(filePath);
      try {
        await fs.access(resolved);
        const format = detectFormat(resolved);
        if (!format) {
          log.warn(`Skipping unsupported file: ${resolved}`);
          continue;
        }
        resolvedFiles.push(resolved);
      } catch {
        log.warn(`File not found: ${filePath}`);
      }
    }

    if (resolvedFiles.length === 0) {
      return {
        success: false,
        error: 'No valid input files found',
      };
    }

    // Ensure output directory exists
    await fs.mkdir(resolvedOutputDir, { recursive: true });

    // Run the pipeline
    const pipeline = new Pipeline();
    const result = await pipeline.execute({
      sourceFiles: resolvedFiles,
      outputFormats: [outputFormat],
      outputDir: resolvedOutputDir,
    });

    if (result.task.status === 'failed') {
      return {
        success: false,
        error: result.task.error || 'Conversion failed',
      };
    }

    // Write artifacts to disk
    const outputs: string[] = [];
    for (const workerResult of result.results) {
      for (const artifact of workerResult.artifacts) {
        const finalPath = path.join(resolvedOutputDir, artifact.filename);
        await fs.mkdir(path.dirname(finalPath), { recursive: true });
        await fs.writeFile(finalPath, artifact.data);
        outputs.push(finalPath);
        log.info(`Written: ${artifact.filename} (${artifact.size} bytes)`);
      }
    }

    return {
      success: true,
      outputs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Convert failed: ${message}`);
    return {
      success: false,
      error: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Formats Handler
// ---------------------------------------------------------------------------

export function handleFormats(): FormatsResponse {
  const inputs = Object.entries(INPUT_FORMATS).map(([id, info]) => ({
    id,
    name: info.name,
    extensions: info.extensions,
  }));

  const outputs = Object.entries(OUTPUT_FORMATS).map(([id, info]) => ({
    id,
    name: info.name,
    extensions: [info.extension],
  }));

  return { inputs, outputs };
}

// ---------------------------------------------------------------------------
// Watch Handler
// ---------------------------------------------------------------------------

export function handleWatch(req: WatchRequest): WatchResponse {
  const log = logger.child('rpc:watch');
  const watchKey = `${req.directory}::${req.format}`;

  // Stop existing watcher for this directory+format combo
  const existing = activeWatchers.get(watchKey);
  if (existing) {
    existing.close();
    activeWatchers.delete(watchKey);
  }

  try {
    const handle = startWatcher(req.directory, req.format, req.outputDir);
    activeWatchers.set(watchKey, handle);
    log.info(`Watcher started for: ${req.directory} → ${req.format}`);
    return { watching: true };
  } catch (error) {
    log.error(`Failed to start watcher: ${error instanceof Error ? error.message : String(error)}`);
    return { watching: false };
  }
}

// ---------------------------------------------------------------------------
// Status Handler
// ---------------------------------------------------------------------------

export function handleStatus(): StatusResponse {
  const parsers = registry.getRegisteredParsers().map((p) => p.id);
  const workers = registry.getRegisteredWorkers().map((w) => w.id);

  return {
    database: true,
    parsers,
    workers,
  };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function stopAllWatchers(): void {
  for (const [key, handle] of activeWatchers) {
    handle.close();
  }
  activeWatchers.clear();
}
