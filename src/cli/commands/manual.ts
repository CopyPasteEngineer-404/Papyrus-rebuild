import chalk from 'chalk';
import { APP_NAME, APP_VERSION } from '../../shared/constants';
import { INPUT_FORMATS, OUTPUT_FORMATS, CONVERSION_MATRIX } from '../../shared/constants';

export function showManual(): void {
  const line = chalk.gray('─'.repeat(60));
  const indent = '  ';
  const section = (title: string) => `\n${chalk.bold.cyan(`● ${title}`)}\n`;

  console.log('');
  console.log(`  ${chalk.bold.cyan(APP_NAME)} ${chalk.yellow(`v${APP_VERSION}`)} — User Manual`);
  console.log(line);

  // ── Getting Started ──
  console.log(section('Getting Started'));
  console.log(`${indent}Papyrus converts documents between formats offline.`);
  console.log(`${indent}Launch the interactive mode and follow the prompts:\n`);
  console.log(`${indent}${chalk.green('npm run papy')}\n`);
  console.log(`${indent}Step-by-step:`);
  console.log(`${indent}  1. Type ${chalk.cyan('cd <folder>')} to load a directory`);
  console.log(`${indent}  2. Files are listed automatically`);
  console.log(`${indent}  3. Type file numbers to select: ${chalk.cyan('1 3 5')}`);
  console.log(`${indent}  4. Type a conversion: ${chalk.cyan('1->pdf 3->html')}`);
  console.log(`${indent}  5. Output files appear in a ${chalk.cyan('converted/')} subfolder`);

  // ── REPL Commands ──
  console.log(section('REPL Commands'));
  const cmds: [string, string][] = [
    ['cd <path>', 'Load a directory and list its files'],
    ['add cd', 'Add another directory (multi-dir support)'],
    ['<N> <M> ...', 'Select files by number (e.g. 1 3 5)'],
    ['rem <N>,<M>', 'Remove files from selection'],
    ['N-><fmt>', 'Convert file N to format (e.g. 1->pdf)'],
    ['show', 'Refresh and display files'],
    ['nshow <path>', 'Load dir without auto-showing files'],
    ['dir history', 'Show all visited directory paths'],
    ['back', 'Reset all selections and directories'],
    ['clear', 'Clear the screen'],
    ['manual', 'Show this manual'],
    ['help', 'Show quick command reference'],
    ['exit / quit', 'Exit Papyrus'],
  ];
  for (const [cmd, desc] of cmds) {
    console.log(`${indent}${chalk.cyan(cmd.padEnd(20))} ${desc}`);
  }

  // ── One-shot Commands ──
  console.log(section('One-shot Commands (from terminal)'));
  console.log(`${indent}${chalk.green('npm run papy -- convert <file> --to <format>')}`);
  console.log(`${indent}  Example: npm run papy -- convert doc.docx --to pdf\n`);
  console.log(`${indent}${chalk.green('npm run papy -- batch <dir> --to <format>')}`);
  console.log(`${indent}  Example: npm run papy -- batch ./docs --to pdf --all\n`);
  console.log(`${indent}${chalk.green('npm run papy -- formats')}`);
  console.log(`${indent}  List all supported formats\n`);
  console.log(`${indent}${chalk.green('npm run papy -- doctor')}`);
  console.log(`${indent}  Run system diagnostics\n`);
  console.log(`${indent}${chalk.green('npm run papy -- watch <dir> --to <format>')}`);
  console.log(`${indent}  Watch directory for new files and auto-convert`);

  // ── Supported Formats ──
  console.log(section('Supported Formats'));
  console.log(`${indent}Input formats (${Object.keys(INPUT_FORMATS).length}):`);
  const inputList = Object.entries(INPUT_FORMATS)
    .map(([key, val]) => `${key} (${val.extensions.join(', ')})`)
    .join(', ');
  console.log(`${indent}  ${chalk.gray(inputList)}\n`);
  console.log(`${indent}Output formats (${Object.keys(OUTPUT_FORMATS).length}):`);
  const outputList = Object.entries(OUTPUT_FORMATS)
    .map(([key, val]) => `${key} (${val.extension})`)
    .join(', ');
  console.log(`${indent}  ${chalk.gray(outputList)}\n`);
  console.log(`${indent}Every input can convert to every output — 130 conversion paths.`);

  // ── Conversion Examples ──
  console.log(section('Conversion Examples'));
  const examples: [string, string][] = [
    ['1->pdf', 'Convert file #1 to PDF'],
    ['2->html', 'Convert file #2 to HTML'],
    ['1->pdf 2->txt 3->docx', 'Convert multiple files at once'],
    ['1->all', 'Convert file #1 to all supported formats'],
  ];
  for (const [ex, desc] of examples) {
    console.log(`${indent}${chalk.cyan(ex.padEnd(35))} ${desc}`);
  }

  // ── Tips ──
  console.log(section('Tips'));
  console.log(`${indent}• Use ${chalk.cyan('add cd')} to load files from multiple folders`);
  console.log(`${indent}• Select files across directories, then convert them all at once`);
  console.log(`${indent}• Output goes to a ${chalk.cyan('converted/')} subfolder in each directory`);
  console.log(`${indent}• Unsupported files are marked in red in the file list`);
  console.log(`${indent}• Run ${chalk.cyan('npm run papy -- doctor')} to check system health`);

  console.log('\n' + line);
  console.log(`${indent}${chalk.gray(`Type 'help' for quick reference. Type 'exit' to quit.`)}`);
  console.log('');
}
