import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { INPUT_FORMATS, OUTPUT_FORMATS, CONVERSION_MATRIX, APP_NAME, APP_VERSION } from '../shared/constants';
import { detectFormat } from '../shared/utils';
import type { InputFormat, OutputFormat } from '../shared/types';

// ---------------------------------------------------------------------------
// Output Path Generation
// ---------------------------------------------------------------------------

export function formatOutputPath(
  inputPath: string,
  outputFormat: OutputFormat,
  outputDir?: string,
): string {
  const ext = OUTPUT_FORMATS[outputFormat].extension;
  const basename = path.basename(inputPath, path.extname(inputPath));
  const filename = `${basename}${ext}`;

  if (outputDir) {
    return path.join(outputDir, filename);
  }

  return path.join(path.dirname(inputPath), filename);
}

// ---------------------------------------------------------------------------
// Find Supported Files
// ---------------------------------------------------------------------------

export function getAllSupportedExtensions(): string[] {
  const extensions: string[] = [];
  for (const info of Object.values(INPUT_FORMATS)) {
    for (const ext of info.extensions) {
      extensions.push(ext);
    }
  }
  return extensions;
}

export async function findSupportedFiles(directory: string): Promise<string[]> {
  const extensions = getAllSupportedExtensions();
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  await walk(directory);
  return files;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export function printHeader(): void {
  const line = chalk.gray('─'.repeat(50));
  console.log('');
  console.log(`  ${chalk.bold.cyan(APP_NAME)} ${chalk.yellow(`v${APP_VERSION}`)}`);
  console.log(`  ${chalk.gray('Offline-first document transformation engine')}`);
  console.log(line);
}

// ---------------------------------------------------------------------------
// Format Helpers
// ---------------------------------------------------------------------------

export function formatSuccess(message: string): string {
  return chalk.green(`✓ ${message}`);
}

export function formatError(message: string): string {
  return chalk.red(`✗ ${message}`);
}

export function formatWarning(message: string): string {
  return chalk.yellow(`⚠ ${message}`);
}

export function formatInfo(message: string): string {
  return chalk.cyan(`ℹ ${message}`);
}

export function getOutputFormatsForInput(inputFormat: InputFormat): OutputFormat[] {
  return CONVERSION_MATRIX[inputFormat] || [];
}
