#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { APP_NAME, APP_VERSION } from '../shared/constants';
import { registerAllParsers } from '../core/parsers';
import { registerAllWorkers } from '../core/workers';
import { registerConvertCommand } from './commands/convert';
import { registerBatchCommand } from './commands/batch';
import { registerFormatsCommand } from './commands/formats';
import { registerDoctorCommand } from './commands/doctor';
import { registerWatchCommand } from './commands/watch';
import { showManual } from './commands/manual';
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
  .command('manual')
  .description('Show the user manual')
  .action(() => {
    showManual();
  });

program
  .command('start')
  .description('Launch interactive mode')
  .action(() => {
    startInteractive();
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
