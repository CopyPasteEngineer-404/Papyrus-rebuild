#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { APP_NAME, APP_VERSION } from '../shared/constants';
import { registerAllParsers } from '../core/parsers';
import { registerAllWorkers } from '../core/workers';
import { printHeader } from './utils';
import { registerConvertCommand } from './commands/convert';
import { registerBatchCommand } from './commands/batch';
import { registerFormatsCommand } from './commands/formats';
import { registerDoctorCommand } from './commands/doctor';
import { registerWatchCommand } from './commands/watch';
import { startInteractive } from './interactive';

registerAllParsers();
registerAllWorkers();

const program = new Command();

program
  .name(APP_NAME.toLowerCase())
  .description(`${chalk.bold.cyan(APP_NAME)} — Offline-first document transformation engine`)
  .version(APP_VERSION, '-v, --version', 'Display version number');

registerConvertCommand(program);
registerBatchCommand(program);
registerFormatsCommand(program);
registerDoctorCommand(program);
registerWatchCommand(program);

program
  .command('start')
  .description('Launch interactive mode')
  .action(() => {
    startInteractive();
  });

program
  .command('app')
  .description('Launch the desktop application (if available)')
  .action(() => {
    printHeader();
    console.log('');

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const desktopPath = path.resolve(__dirname, '../desktop/bun/index.ts');

    const child = spawn('bun', ['run', desktopPath], {
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '../..'),
    });

    child.on('error', () => {
      console.log(chalk.yellow('  Bun is not installed. Install it first:'));
      console.log(chalk.gray('    powershell -c "irm bun.sh/install.ps1 | iex"'));
      console.log('');
      console.log(chalk.gray('  Or run the CLI directly:'));
      console.log(chalk.gray('    npx tsx src/cli/index.ts convert <file> --to <format>'));
      console.log('');
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.log(chalk.red(`  Desktop app exited with code ${code}`));
      }
    });
  });

program.exitOverride();

if (process.argv.length <= 2) {
  startInteractive();
} else {
  try {
    program.parse(process.argv);
  } catch (error: unknown) {
    const err = error as { code?: string; exitCode?: number };
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.help') {
      process.exit(err.exitCode ?? 0);
    }
    if (err.code === 'commander.unknownCommand' || err.code === 'commander.missingMandatoryOptionValue') {
      process.exit(1);
    }
    console.error(chalk.red(`\n  Error: ${error instanceof Error ? error.message : String(error)}\n`));
    process.exit(1);
  }
}
