import chalk from 'chalk';
import readline from 'readline';
import path from 'path';
import fs from 'fs/promises';
import { CONVERSION_MATRIX, INPUT_FORMATS } from '../shared/constants';
import { detectFormat, formatFileSize, setLogLevel } from '../shared/utils';
import { Pipeline } from '../core/pipeline';
import type { InputFormat, OutputFormat } from '../shared/types';
import { printHeader } from './utils';

interface FileInfo {
  index: number;
  name: string;
  ext: string;
  size: number;
  supported: boolean;
  formats: string[];
}

const supportedExts = Object.values(INPUT_FORMATS).flatMap(f => f.extensions);

function ask(rl: readline.Interface, query: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(query, answer => resolve(answer.trim()));
  });
}

function padRight(str: string, width: number): string {
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

function padLeft(str: string, width: number): string {
  return str.length >= width ? str : ' '.repeat(width - str.length) + str;
}

function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[\d;]*m/g, '');
}

function visibleLen(s: string): number {
  return stripAnsi(s).length;
}

async function listFiles(dir: string): Promise<FileInfo[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const result: FileInfo[] = [];
    let idx = 1;

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      const supported = supportedExts.includes(ext);
      const inputFormat = detectFormat(entry.name);
      const formats = inputFormat ? (CONVERSION_MATRIX[inputFormat] || []) : [];
      const stat = await fs.stat(path.join(dir, entry.name));

      result.push({
        index: idx++,
        name: entry.name,
        ext: ext || '---',
        size: stat.size,
        supported,
        formats,
      });
    }

    return result;
  } catch {
    return [];
  }
}

function addMappings(
  fileIndex: number,
  format: string,
  files: FileInfo[],
  mappings: { fileIndex: number; format: string }[],
): boolean {
  const f = files.find(x => x.index === fileIndex);
  if (!f) return false;

  if (format === 'all') {
    const fileFormat = detectFormat(f.name) as InputFormat | null;
    const validFormats = fileFormat ? CONVERSION_MATRIX[fileFormat] : [];
    if (validFormats.length === 0) return false;
    for (const fmt of validFormats) {
      mappings.push({ fileIndex, format: fmt });
    }
    return true;
  }

  const fileFormat = detectFormat(f.name) as InputFormat | null;
  const validFormats = fileFormat ? CONVERSION_MATRIX[fileFormat] : [];
  if (!validFormats.includes(format as any)) return false;

  mappings.push({ fileIndex, format });
  return true;
}

function parseMapping(input: string, files: FileInfo[]): { fileIndex: number; format: string }[] | null {
  const mappings: { fileIndex: number; format: string }[] = [];

  const tokens = input.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  const withArrow = tokens.filter(t => t.includes('->'));

  if (withArrow.length === 0) return null;

  if (withArrow.length === 1) {
    const idx = tokens.indexOf(withArrow[0]);
    const parts = withArrow[0].match(/^(\d+)\s*->\s*(.+)$/i);
    if (!parts) return null;
    const fileIndex = Number(parts[1]);
    const inlineFormats = parts[2].split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    for (const fmt of inlineFormats) {
      if (!addMappings(fileIndex, fmt, files, mappings)) return null;
    }
    for (let i = idx + 1; i < tokens.length; i++) {
      if (!addMappings(fileIndex, tokens[i].toLowerCase(), files, mappings)) return null;
    }
    return mappings;
  }

  for (const token of withArrow) {
    const match = token.match(/^(\d+)\s*->\s*(\w+)$/i);
    if (!match) return null;
    const fileIndex = Number(match[1]);
    const format = match[2].toLowerCase();
    if (!addMappings(fileIndex, format, files, mappings)) return null;
  }

  return mappings;
}

async function runPipeline(
  file: FileInfo,
  format: string,
  inputDir: string,
  outputDir: string,
): Promise<boolean> {
  const inputPath = path.join(inputDir, file.name);
  const pipeline = new Pipeline();

  try {
    const result = await pipeline.execute({
      sourceFiles: [inputPath],
      outputFormats: [format as OutputFormat],
      outputDir,
    });
    return result.task.status === 'completed';
  } catch {
    return false;
  }
}

function printFiles(files: FileInfo[], termW: number, highlightIndices: number[] = []): void {
  if (files.length === 0) { console.log(chalk.yellow('  No files.\n')); return; }

  const wNum = 3, wNameRatio = 0.30, wType = 8, wSize = 10;
  const gapHN = 3, gapNT = 1, gapTS = 3, gapSC = 7;
  const overhead = 2 + wNum + gapHN + gapNT + wType + gapTS + wSize + gapSC;
  const maxNameW = Math.max(10, Math.min(40, Math.floor(termW * wNameRatio)));
  const maxFmtW = Math.max(10, termW - overhead - maxNameW);

  const indent = '  ';
  const padNum = (s: string) => padLeft(s, wNum);
  const padName = (s: string) => padRight(s, maxNameW);

  const header = `${indent}${chalk.bold(padNum('#'))}${' '.repeat(gapHN)}${chalk.bold(padName('Name'))}${' '.repeat(gapNT)}${chalk.bold(padRight('Type', wType))}${' '.repeat(gapTS)}${chalk.bold(padLeft('Size', wSize))}${' '.repeat(gapSC)}${chalk.bold('Conversions')}`;

  console.log(header);

  for (const f of files) {
    let name = f.name;
    const nameLen = visibleLen(name);
    if (nameLen > maxNameW) {
      let short = '';
      for (const ch of f.name) {
        if (visibleLen(short + ch) > maxNameW - 3) break;
        short += ch;
      }
      name = short + '...';
    }

    let fmts: string;
    if (f.supported) {
      fmts = f.formats.join(', ');
      if (visibleLen(fmts) > maxFmtW) {
        fmts = fmts.slice(0, maxFmtW - 3) + '...';
      }
    } else {
      fmts = chalk.red('not supported');
    }

    const line = `${indent}${padNum(String(f.index))}${' '.repeat(gapHN)}${padName(name)}${' '.repeat(gapNT)}${padRight(f.ext, wType)}${' '.repeat(gapTS)}${padLeft(formatFileSize(f.size), wSize)}${' '.repeat(gapSC)}${padRight(fmts, maxFmtW)}`;

    if (highlightIndices.includes(f.index)) {
      console.log(chalk.yellow(line));
    } else {
      console.log(line);
    }
  }
  console.log('');
}

function buildHelpBox(): string {
  const items: [string, string][] = [
    ['cd <path>', 'Change dir, then add more dirs'],
    ['nshow', 'Toggle auto-show after cd'],
    ['nshow <path>', 'Change dir without file list'],
    ['show', 'Show files (selected only if any)'],
    ['<N> <M>', 'Add files to selection'],
    ['rem <N>,<M>', 'Remove files from selection'],
    ['N-><fmt>', 'Convert file N to format'],
    ['add cd', 'Add another directory'],
    ['dir history', 'Show visited directory paths'],
    ['back', 'Reset selection & directories'],
    ['clear', 'Clear screen'],
    ['help', 'Show this help'],
    ['exit / quit', 'Exit'],
  ];
  const leftMax = Math.max(...items.map(([l]) => stripAnsi(l).length));
  const rightMax = Math.max(...items.map(([, r]) => stripAnsi(r).length));
  const totalW = leftMax + rightMax + 9;
  const lines = items.map(
    ([l, r]) => `│  ${padRight(l, leftMax)}   ${padRight(r, rightMax)}  │`
  );
  const top = `╭─ Commands ${'─'.repeat(totalW - 13)}╮`;
  const bottom = `╰${'─'.repeat(totalW - 2)}╯`;
  return chalk.cyan([top, ...lines, bottom].join('\n'));
}

interface DirEntry {
  path: string;
  files: FileInfo[];
}

async function doConvert(
  mapping: { fileIndex: number; format: string }[],
  files: FileInfo[],
  cwd: string,
): Promise<boolean> {
  const destination = path.join(cwd, 'converted');
  try { await fs.mkdir(destination, { recursive: true }); } catch {
    console.log(chalk.red(`  Cannot create: ${destination}\n`));
    return false;
  }

  console.log(chalk.green(`  ✓ Created: ${destination}\n`));

  let ok = 0;
  for (const m of mapping) {
    const f = files.find(x => x.index === m.fileIndex);
    if (!f) continue;
    process.stdout.write(`  ${chalk.gray('-')} ${f.name} → ${m.format}... `);
    const success = await runPipeline(f, m.format, cwd, destination);
    if (success) { ok++; process.stdout.write(chalk.green('✓\n')); }
    else { process.stdout.write(chalk.red('✗\n')); }
  }
  console.log(chalk.green(`\n  ✓ ${ok}/${mapping.length} created — ${destination}\n`));
  return true;
}

function showDirChange(dir: string): void {
  const folderName = path.basename(dir);
  console.log(chalk.green(`  ✓ ${chalk.bold(folderName)} (${dir})`));
}

function showDirs(dirs: DirEntry[], termW: number, selected: Set<number>): void {
  for (let i = 0; i < dirs.length; i++) {
    const d = dirs[i];
    const header = `  ${chalk.cyan(`Directory ${i + 1}: ${d.path}`)}`;
    console.log(header);
    if (selected.size > 0) {
      const filtered = d.files.filter(f => selected.has(f.index));
      if (filtered.length > 0) {
        printFiles(filtered, termW, [...selected]);
      }
    } else {
      printFiles(d.files, termW, []);
    }
  }
}

export async function startInteractive(): Promise<void> {
  setLogLevel('error');
  printHeader();
  console.log(`  ${chalk.gray("Enter directory path: cd ...\\folder with files to convert")}`);
  console.log(`  ${chalk.gray("Type 'help' for commands, 'exit' to quit.")}`);
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const termW = process.stdout.columns || 80;
  let dirs: DirEntry[] = [];
  let activeDirIdx = 0;
  let selected = new Set<number>();
  let dirHistory: string[] = [process.cwd()];
  let autoShow = true;

  function getActiveFiles(): FileInfo[] {
    return dirs.length > 0 ? dirs[activeDirIdx].files : [];
  }

  function getActiveDir(): string {
    return dirs.length > 0 ? dirs[activeDirIdx].path : process.cwd();
  }

  async function addDir(target: string): Promise<boolean> {
    const resolved = path.resolve(getActiveDir(), target);
    try {
      const stat = await fs.stat(resolved);
      if (!stat.isDirectory()) { console.log(chalk.red('  Not a directory.\n')); return false; }
      dirs.push({ path: resolved, files: [] });
      return true;
    } catch { console.log(chalk.red('  Not found.\n')); return false; }
  }

  async function addDirAbsolute(target: string): Promise<boolean> {
    try {
      const stat = await fs.stat(target);
      if (!stat.isDirectory()) { console.log(chalk.red('  Not a directory.\n')); return false; }
      dirs.push({ path: target, files: [] });
      return true;
    } catch { console.log(chalk.red('  Not found.\n')); return false; }
  }

  async function refreshDirFiles(idx: number): Promise<void> {
    dirs[idx].files = await listFiles(dirs[idx].path);
  }

  if (!process.stdin.isTTY) {
    const allLines: string[] = [];
    for await (const line of rl) { allLines.push(line); }
    for (const line of allLines) {
      const input = line.trim();
      if (!input) continue;
      if (input === 'exit' || input === 'quit') { process.exit(0); }
    }
    process.exit(0);
  }

  rl.on('SIGINT', () => {
    process.stdout.write('\n');
    console.log(chalk.gray('  Type "exit" to quit.\n'));
  });

  async function multiDirPrompt(): Promise<void> {
    while (true) {
      const answer = await ask(rl, chalk.gray('  • '));
      if (!answer || answer === 'exit') break;
      if (answer.startsWith('cd ')) {
        const target = answer.slice(3).trim();
        if (await addDir(target)) {
          const idx = dirs.length - 1;
          await refreshDirFiles(idx);
          showDirChange(dirs[idx].path);
          printFiles(dirs[idx].files, termW);
        }
      } else {
        console.log(chalk.yellow('  Type cd <path> or "exit".\n'));
      }
    }
    console.log('');
    if (dirs.length > 0) {
      console.log(chalk.bold('  Selected directories:\n'));
      showDirs(dirs, termW, selected);
    }
  }

  while (true) {
    const line = await ask(rl, chalk.green('papyrus> '));
    if (!line) continue;

    const input = line.trim();

    if (input === 'exit' || input === 'quit') {
      console.log(chalk.gray('  Goodbye.'));
      rl.close();
      process.exit(0);
    }

    if (input === 'help') {
      console.log('\n' + buildHelpBox() + '\n');
      continue;
    }

    if (input === 'clear') {
      console.clear();
      printHeader();
      console.log(`\n  ${chalk.gray("Type 'help' for commands.")}\n`);
      continue;
    }

    if (input === 'back') {
      dirs = [];
      selected.clear();
      dirHistory = [process.cwd()];
      autoShow = true;
      console.log(chalk.gray('  Reset.\n'));
      continue;
    }

    if (input.startsWith('nshow ')) {
      const target = input.slice(6).trim();
      if (target) {
        if (dirs.length === 0) {
          if (await addDir(target)) {
            const idx = dirs.length - 1;
            await refreshDirFiles(idx);
            dirHistory.push(dirs[idx].path);
            showDirChange(dirs[idx].path);
            selected.clear();
            activeDirIdx = idx;
            await multiDirPrompt();
          }
        } else {
          if (await addDir(target)) {
            const idx = dirs.length - 1;
            await refreshDirFiles(idx);
            dirHistory.push(dirs[idx].path);
            showDirChange(dirs[idx].path);
            selected.clear();
            activeDirIdx = idx;
            await multiDirPrompt();
          }
        }
      }
      continue;
    }

    if (input === 'nshow') {
      if (dirs.length === 0) {
        console.log(chalk.yellow('  No directory loaded. Use cd first.\n'));
      } else {
        autoShow = !autoShow;
        console.log(chalk.gray(`  Auto-show after cd: ${autoShow ? 'ON' : 'OFF'}\n`));
      }
      continue;
    }

    if (input === 'dir history') {
      if (dirHistory.length === 0) {
        console.log(chalk.yellow('  No directory history.\n'));
      } else {
        console.log(chalk.bold('  Directory history:\n'));
        for (const d of dirHistory) {
          console.log(`  ${chalk.cyan('•')} ${d}`);
        }
        console.log('');
      }
      continue;
    }


    if (input === 'add cd') {
      if (dirs.length === 0) {
        console.log(chalk.yellow('  No directories yet. Use cd <path> first.\n'));
      } else {
        await multiDirPrompt();
      }
      continue;
    }

    if (line === 'show' || line === 'list') {
      if (dirs.length === 0) {
        console.log(chalk.yellow('  No directories. Use cd <path>.\n'));
        continue;
      }
      for (let i = 0; i < dirs.length; i++) {
        await refreshDirFiles(i);
      }
      if (selected.size > 0) {
        console.log(chalk.bold('  Selected files:\n'));
        for (let i = 0; i < dirs.length; i++) {
          const filtered = dirs[i].files.filter(f => selected.has(f.index));
          if (filtered.length > 0) {
            console.log(`  ${chalk.cyan(`Directory ${i + 1}: ${dirs[i].path}`)}`);
            printFiles(filtered, termW, [...selected]);
          }
        }
      } else {
        showDirs(dirs, termW, selected);
      }
      continue;
    }

    if (input.startsWith('cd ')) {
      const target = input.slice(3).trim();
      if (dirs.length === 0) {
        if (await addDir(target)) {
          const idx = dirs.length - 1;
          await refreshDirFiles(idx);
          dirHistory.push(dirs[idx].path);
          showDirChange(dirs[idx].path);
          if (autoShow) {
            printFiles(dirs[idx].files, termW);
          }
          selected.clear();
          activeDirIdx = idx;
          await multiDirPrompt();
        }
      } else {
        if (await addDir(target)) {
          const idx = dirs.length - 1;
          await refreshDirFiles(idx);
          dirHistory.push(dirs[idx].path);
          showDirChange(dirs[idx].path);
          if (autoShow) {
            printFiles(dirs[idx].files, termW);
          }
          selected.clear();
          activeDirIdx = idx;
          await multiDirPrompt();
        }
      }
      continue;
    }

    if (input.startsWith('rem ')) {
      const numsStr = input.slice(4).trim();
      const nums = numsStr.split(/[\s,]+/).map(s => Number(s.trim())).filter(n => !isNaN(n));
      if (nums.length === 0) {
        console.log(chalk.yellow('  Use: rem 1,2,3\n'));
        continue;
      }
      let removed = 0;
      for (const n of nums) {
        if (selected.delete(n)) removed++;
      }
      const remaining = selected.size;
      if (removed > 0) {
        console.log(chalk.gray(`  Removed ${removed} file(s). ${remaining > 0 ? `${remaining} file(s) remaining.` : 'Selection empty — use numbers to add.'}\n`));
        if (remaining > 0) {
          const allFiles = getActiveFiles();
          const filtered = allFiles.filter(f => selected.has(f.index));
          printFiles(filtered, termW, [...selected]);
        }
      } else {
        console.log(chalk.yellow('  No matching files in selection.\n'));
      }
      continue;
    }

    const mappings = parseMapping(input, getActiveFiles());
    if (mappings && mappings.length > 0) {
      const files = getActiveFiles();
      const valid = mappings.filter(m => {
        const f = files.find(x => x.index === m.fileIndex);
        return f && f.formats.includes(m.format);
      });
      if (valid.length === 0) {
        console.log(chalk.yellow('  No valid conversions.\n'));
        continue;
      }

      console.log(chalk.bold('\n  Conversions:\n'));
      const seen = new Map<number, string[]>();
      for (const m of valid) {
        const arr = seen.get(m.fileIndex) || [];
        arr.push(m.format);
        seen.set(m.fileIndex, arr);
      }
      for (const [idx, fmts] of seen) {
        const f = files.find(x => x.index === idx);
        if (f) {
          const label = fmts.length > 1 ? `all (${fmts.length})` : fmts[0];
          console.log(`  ${chalk.yellow(String(idx))}  ${chalk.white(f.name)}  ${chalk.cyan('→ ' + label)}`);
        }
      }

      let ok = true;
      for (let di = 0; di < dirs.length; di++) {
        const dirFiles = dirs[di].files;
        const dirValid = valid.filter(m => {
          const f = dirFiles.find(x => x.index === m.fileIndex);
          return f && f.formats.includes(m.format);
        });
        if (dirValid.length > 0) {
          const r = await doConvert(dirValid, dirFiles, dirs[di].path);
          if (!r) ok = false;
        }
      }
      if (ok) {
        console.log(chalk.green(`  All conversions done.\n`));
      }
      continue;
    }

    const nums = input.split(/[\s,]+/).filter(s => /^\d+$/.test(s.trim())).map(s => Number(s.trim()));
    if (nums.length > 0) {
      const allFiles = getActiveFiles();
      const validNums = nums.filter(n => allFiles.some(f => f.index === n));

      if (validNums.length === 0) {
        console.log(chalk.yellow('  No matching file numbers.\n'));
        continue;
      }

      const allSelected = selected.size === allFiles.length;
      if (allSelected) {
        const alreadySelected = validNums.every(n => selected.has(n));
        if (alreadySelected) {
          console.log(chalk.gray('  All files already selected. Use rem to deselect.\n'));
        } else {
          const newNums = validNums.filter(n => !selected.has(n));
          if (newNums.length > 0) {
            for (const n of newNums) selected.add(n);
            const filtered = allFiles.filter(f => selected.has(f.index));
            printFiles(filtered, termW, [...selected]);
            console.log(chalk.gray('  All files selected. Use rem to deselect.\n'));
          }
        }
      } else {
        const before = selected.size;
        for (const n of validNums) selected.add(n);
        const added = selected.size - before;
        console.log(chalk.gray(`  Added ${added} file(s). Total selected: ${selected.size}\n`));

        const filtered = allFiles.filter(f => selected.has(f.index));
        printFiles(filtered, termW, [...selected]);
      }

      if (selected.size === 0) continue;

      const sub = await ask(rl, chalk.gray('  rem N / <N> / N-><fmt> or Enter: '));
      if (!sub) { continue; }

      if (sub.startsWith('rem ')) {
        const numsStr = sub.slice(4).trim();
        const rNums = numsStr.split(/[\s,]+/).map(s => Number(s.trim())).filter(n => !isNaN(n));
        let r = 0;
        for (const n of rNums) { if (selected.delete(n)) r++; }
        if (selected.size === 0) {
          console.log(chalk.gray(`  Removed ${r} file(s). Selection empty — use numbers to add.\n`));
        } else {
          console.log(chalk.gray(`  Removed ${r} file(s). ${selected.size} remaining.\n`));
          const remaining = allFiles.filter(f => selected.has(f.index));
          printFiles(remaining, termW, [...selected]);
        }
        continue;
      }

      const more = sub.split(/[\s,]+/).filter(s => /^\d+$/.test(s.trim())).map(s => Number(s.trim()));
      if (more.length > 0) {
        const validMore = more.filter(n => allFiles.some(f => f.index === n));
        const allNow = selected.size + validMore.length;
        if (allNow >= allFiles.length) {
          for (const n of validMore) selected.add(n);
          console.log(chalk.gray(`  Added ${validMore.length} more. All files now selected.\n`));
        } else {
          for (const n of validMore) selected.add(n);
          console.log(chalk.gray(`  Added ${validMore.length} more. Total: ${selected.size}\n`));
        }
        const updated = allFiles.filter(f => selected.has(f.index));
        printFiles(updated, termW, [...selected]);
        continue;
      }

      const m = parseMapping(sub, allFiles);
      if (m && m.length > 0) {
        const valid = m.filter(x => {
          const f = allFiles.find(ff => ff.index === x.fileIndex);
          return f && f.formats.includes(x.format);
        });
        if (valid.length > 0) {
          console.log(chalk.bold('\n  Conversions:\n'));
          const seen = new Map<number, string[]>();
          for (const v of valid) {
            const arr = seen.get(v.fileIndex) || [];
            arr.push(v.format);
            seen.set(v.fileIndex, arr);
          }
          for (const [idx, fmts] of seen) {
            const f = allFiles.find(x => x.index === idx);
            if (f) {
              const label = fmts.length > 1 ? `all (${fmts.length})` : fmts[0];
              console.log(`  ${chalk.yellow(String(idx))}  ${chalk.white(f.name)}  ${chalk.cyan('→ ' + label)}`);
            }
          }

          let ok = true;
          for (let di = 0; di < dirs.length; di++) {
            const dirFiles = dirs[di].files;
            const dirValid = valid.filter(x => {
              const f = dirFiles.find(ff => ff.index === x.fileIndex);
              return f && f.formats.includes(x.format);
            });
            if (dirValid.length > 0) {
              const r = await doConvert(dirValid, dirFiles, dirs[di].path);
              if (!r) ok = false;
            }
          }
          if (ok) {
            console.log(chalk.green(`  All conversions done.\n`));
          }
        }
      }
      continue;
    }

    console.log(chalk.yellow('  Unknown. Type "help".\n'));
  }
}
