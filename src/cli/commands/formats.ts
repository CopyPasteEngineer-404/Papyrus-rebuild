import { Command } from 'commander';
import chalk from 'chalk';
import { registerAllParsers } from '../../core/parsers';
import { registerAllWorkers } from '../../core/workers';
import { registry } from '../../core/registry';
import { INPUT_FORMATS, OUTPUT_FORMATS, CONVERSION_MATRIX } from '../../shared/constants';
import type { InputFormat, OutputFormat } from '../../shared/types';
import { printHeader } from '../utils';

export function registerFormatsCommand(program: Command): void {
  program
    .command('formats')
    .description('List all supported input and output formats')
    .action(() => {
      printHeader();

      registerAllParsers();
      registerAllWorkers();

      const registeredParsers = registry.getRegisteredParsers();
      const registeredWorkers = registry.getRegisteredWorkers();

      // Input Formats
      console.log(chalk.bold.cyan('  Input Formats'));
      console.log(chalk.gray('  ' + '─'.repeat(46)));
      console.log('');

      for (const [format, info] of Object.entries(INPUT_FORMATS)) {
        const isRegistered = registeredParsers.some(
          (p) => p.id === format || p.extensions.some((e) => e === `.${format}`)
        );
        const status = isRegistered ? chalk.green('●') : chalk.red('○');
        const extensions = info.extensions.join(', ').padEnd(20);
        const targets = (CONVERSION_MATRIX[format as InputFormat] || []).join(', ');

        console.log(`  ${status} ${chalk.bold(info.name.padEnd(22))} ${chalk.gray(extensions)} ${chalk.dim(`→ ${targets}`)}`);
      }

      console.log('');
      console.log(chalk.gray(`  ${chalk.green('●')} = parser registered  ${chalk.red('○')} = parser not available`));
      console.log('');

      // Output Formats
      console.log(chalk.bold.cyan('  Output Formats'));
      console.log(chalk.gray('  ' + '─'.repeat(46)));
      console.log('');

      for (const [format, info] of Object.entries(OUTPUT_FORMATS)) {
        const isRegistered = registeredWorkers.some((w) => w.formats.includes(format as OutputFormat));
        const status = isRegistered ? chalk.green('●') : chalk.red('○');

        const sources = Object.entries(CONVERSION_MATRIX)
          .filter(([_, targets]) => targets.includes(format as OutputFormat))
          .map(([src]) => src);

        console.log(`  ${status} ${chalk.bold(info.name.padEnd(22))} ${chalk.gray(info.extension.padEnd(6))} ${chalk.dim(`← ${sources.join(', ')}`)}`);
      }

      console.log('');
      console.log(chalk.gray(`  ${chalk.green('●')} = worker registered  ${chalk.red('○')} = worker not available`));
      console.log('');

      // Stats
      const inputCount = Object.keys(INPUT_FORMATS).length;
      const outputCount = Object.keys(OUTPUT_FORMATS).length;
      let conversionCount = 0;
      for (const targets of Object.values(CONVERSION_MATRIX)) {
        conversionCount += targets.length;
      }

      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.gray(`  ${inputCount} input formats | ${outputCount} output formats | ${conversionCount} conversion paths`));
      console.log('');
    });
}
