import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { registerAllParsers } from '../../core/parsers';
import { registerAllWorkers } from '../../core/workers';
import { registry } from '../../core/registry';
import { APP_NAME, APP_VERSION, INPUT_FORMATS, OUTPUT_FORMATS } from '../../shared/constants';
import { printHeader, formatSuccess, formatError, formatWarning, formatInfo } from '../utils';

interface CheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

async function runCheck(name: string, fn: () => Promise<CheckResult>): Promise<CheckResult> {
  try {
    return await fn();
  } catch (error) {
    return {
      name,
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check system capabilities and report any issues')
    .action(async () => {
      printHeader();

      const spinner = ora({
        text: chalk.cyan('Running diagnostics...'),
        spinner: 'dots',
      }).start();

      const checks: CheckResult[] = [];

      // 1. Node/Bun version
      checks.push(await runCheck('Runtime', async () => {
        const nodeVersion = process.version;
        const major = parseInt(nodeVersion.slice(1), 10);
        if (major < 18) {
          return { name: 'Runtime', status: 'fail', message: `Node.js ${nodeVersion} — requires >= 18.0.0` };
        }
        return { name: 'Runtime', status: 'pass', message: `${nodeVersion}` };
      }));

      // 2. Platform
      checks.push(await runCheck('Platform', async () => {
        const platform = os.platform();
        const arch = os.arch();
        return { name: 'Platform', status: 'pass', message: `${platform} ${arch}` };
      }));

      // 3. Memory
      checks.push(await runCheck('Memory', async () => {
        const totalMB = Math.round(os.totalmem() / 1024 / 1024);
        const freeMB = Math.round(os.freemem() / 1024 / 1024);
        if (totalMB < 512) {
          return { name: 'Memory', status: 'warn', message: `${totalMB}MB total — low memory may cause issues` };
        }
        return { name: 'Memory', status: 'pass', message: `${totalMB}MB total, ${freeMB}MB free` };
      }));

      // 4. CPUs
      checks.push(await runCheck('CPUs', async () => {
        const cpus = os.cpus().length;
        return { name: 'CPUs', status: 'pass', message: `${cpus} core(s)` };
      }));

      // 5. Register parsers
      checks.push(await runCheck('Parsers', async () => {
        registerAllParsers();
        const parsers = registry.getRegisteredParsers();
        const inputCount = Object.keys(INPUT_FORMATS).length;
        if (parsers.length === 0) {
          return { name: 'Parsers', status: 'fail', message: 'No parsers registered' };
        }
        return { name: 'Parsers', status: 'pass', message: `${parsers.length}/${inputCount} parsers registered` };
      }));

      // 6. Register workers
      checks.push(await runCheck('Workers', async () => {
        registerAllWorkers();
        const workers = registry.getRegisteredWorkers();
        const outputCount = Object.keys(OUTPUT_FORMATS).length;
        if (workers.length === 0) {
          return { name: 'Workers', status: 'fail', message: 'No workers registered' };
        }
        return { name: 'Workers', status: 'pass', message: `${workers.length}/${outputCount} workers registered` };
      }));

      // 7. Output directory writable
      checks.push(await runCheck('Temp Directory', async () => {
        const tmpDir = os.tmpdir();
        const testFile = `.papyrus-doctor-test-${Date.now()}`;
        const testPath = path.join(tmpDir, testFile);
        try {
          await fs.writeFile(testPath, 'test');
          await fs.unlink(testPath);
          return { name: 'Temp Directory', status: 'pass', message: `${tmpDir} (writable)` };
        } catch {
          return { name: 'Temp Directory', status: 'warn', message: `${tmpDir} (not writable)` };
        }
      }));

      // 8. CWD writable
      checks.push(await runCheck('Working Directory', async () => {
        const cwd = process.cwd();
        const testFile = `.papyrus-doctor-cwd-test-${Date.now()}`;
        const testPath = path.join(cwd, testFile);
        try {
          await fs.writeFile(testPath, 'test');
          await fs.unlink(testPath);
          return { name: 'Working Directory', status: 'pass', message: cwd };
        } catch {
          return { name: 'Working Directory', status: 'warn', message: `${cwd} (not writable)` };
        }
      }));

      // 9. Database check
      checks.push(await runCheck('Database', async () => {
        try {
          const { getDatabaseConnection, closeDatabaseConnection } = await import('../../db/connection');
          const conn = getDatabaseConnection();
          closeDatabaseConnection();
          return { name: 'Database', status: 'pass', message: 'SQLite (better-sqlite3) available, DB initialized' };
        } catch (error) {
          return { name: 'Database', status: 'warn', message: `Database check skipped: ${error instanceof Error ? error.message : String(error)}` };
        }
      }));

      spinner.stop();

      // Print results
      console.log('');
      let hasFailures = false;
      let hasWarnings = false;

      for (const check of checks) {
        const icon = check.status === 'pass' ? chalk.green('✓')
          : check.status === 'warn' ? chalk.yellow('⚠')
          : chalk.red('✗');

        const statusColor = check.status === 'pass' ? 'green'
          : check.status === 'warn' ? 'yellow'
          : 'red';

        console.log(`  ${icon} ${chalk.bold(check.name)}: ${chalk[statusColor](check.message)}`);

        if (check.status === 'fail') hasFailures = true;
        if (check.status === 'warn') hasWarnings = true;
      }

      console.log('');
      console.log(chalk.gray('─'.repeat(50)));

      if (hasFailures) {
        console.log(chalk.red.bold('  ✗ Some checks failed. Please resolve the issues above.'));
      } else if (hasWarnings) {
        console.log(chalk.yellow.bold('  ⚠ Some warnings detected. Functionality may be limited.'));
      } else {
        console.log(chalk.green.bold('  ✓ All checks passed. Papyrus is ready to go.'));
      }

      console.log('');

      if (hasFailures) {
        process.exit(1);
      }
    });
}
