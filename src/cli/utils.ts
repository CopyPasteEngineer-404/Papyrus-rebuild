import fs from 'fs/promises';
import fsSync from 'fs';
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

// 4 gradient themes: each defines light→dark colors for the banner
// Cycles in order: amber → ocean → rose → emerald → repeat
// Index is persisted to .papyrus-theme so it advances across CLI startups
const THEMES: [string, string][] = [
  ['#f5d0a9', '#6b3a2a'],  // amber
  ['#a8d8ea', '#0e3d5e'],  // ocean
  ['#f5b7b1', '#6e1a3a'],  // rose
  ['#a9dfbf', '#0e4a32'],  // emerald
];
const THEME_FILE = path.join(process.cwd(), '.papyrus-theme');

function readThemeIndex(): number {
  try {
    const val = parseInt(fsSync.readFileSync(THEME_FILE, 'utf-8').trim(), 10);
    return isNaN(val) ? 0 : val;
  } catch {
    return 0;
  }
}

function writeThemeIndex(idx: number): void {
  try {
    fsSync.writeFileSync(THEME_FILE, String(idx), 'utf-8');
  } catch { /* ignore write errors */ }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
}

function lerpColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

function colorBanner(): void {
  const idx = readThemeIndex();
  const [light, dark] = THEMES[idx % THEMES.length];
  writeThemeIndex((idx + 1) % THEMES.length);
  const gradient = Array.from({ length: 8 }, (_, i) => lerpColor(light, dark, i / 7));

  const lines = [
    '#####################################################################',
    '#  ██████╗  █████╗ ██████╗ ██╗   ██╗██████╗ ██╗   ██╗███████╗██╗    #',
    '#  ██╔══██╗██╔══██╗██╔══██╗╚██╗ ██╔╝██╔══██╗██║   ██║██╔════╝╚██╗   #',
    '#  ██████╔╝███████║██████╔╝ ╚████╔╝ ██████╔╝██║   ██║███████╗ ╚██╗  #',
    '#  ██╔═══╝ ██╔══██║██╔═══╝   ╚██╔╝  ██╔══██╗██║   ██║╚════██║ ██╔╝  #',
    '#  ██║     ██║  ██║██║        ██║   ██║  ██║╚██████╔╝███████║██╔╝   #',
    '#  ╚═╝     ╚═╝  ╚═╝╚═╝        ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝    #',
    '#####################################################################',
  ];

  for (let i = 0; i < lines.length; i++) {
    const fn = chalk.hex(gradient[i]);
    console.log('  ' + fn(lines[i]));
  }
}

export function printHeader(): void {
  console.log('');
  colorBanner();
  console.log('');
  console.log(`  ${chalk.bold.cyan(APP_NAME)} ${chalk.yellow(`v${APP_VERSION}`)}`);
  console.log(`  ${chalk.gray('Offline-first document transformation engine')}`);
  console.log('');
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
