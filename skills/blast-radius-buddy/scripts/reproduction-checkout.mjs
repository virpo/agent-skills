#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPRODUCTION_DIRECTORY_PREFIX = join(
  tmpdir(),
  'blast-radius-buddy-reproduction-',
);

const defaultExecute = (command, args) => execFileAsync(command, args, {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});

function validateCheckoutOptions({ repository, headSha, execute, inspect }) {
  if (typeof repository !== 'string' || repository.trim().length === 0) {
    throw new TypeError('repository must be a non-empty path');
  }
  if (typeof headSha !== 'string' || !/^[0-9a-f]{7,64}$/i.test(headSha)) {
    throw new TypeError('headSha must be a 7-64 character hexadecimal commit id');
  }
  if (typeof execute !== 'function') throw new TypeError('execute must be a function');
  if (typeof inspect !== 'function') throw new TypeError('inspect must be a function');
}

async function removeReproductionDirectory(directory) {
  if (typeof directory !== 'string'
    || !directory.startsWith(REPRODUCTION_DIRECTORY_PREFIX)) {
    throw new Error('Refusing to remove an unsafe reproduction directory');
  }
  await rm(directory, { recursive: true, force: true });
}

export async function withReproductionCheckout({
  repository,
  headSha,
  execute = defaultExecute,
  inspect,
}) {
  validateCheckoutOptions({ repository, headSha, execute, inspect });

  const temporaryDirectory = await mkdtemp(REPRODUCTION_DIRECTORY_PREFIX);
  const checkoutPath = join(temporaryDirectory, 'checkout');
  let added = false;

  try {
    await execute('git', [
      '-C', repository,
      'worktree', 'add', '--detach', checkoutPath, headSha,
    ]);
    added = true;
    return await inspect(checkoutPath);
  } finally {
    try {
      if (added) {
        await execute('git', [
          '-C', repository,
          'worktree', 'remove', '--force', checkoutPath,
        ]);
      }
    } finally {
      await removeReproductionDirectory(temporaryDirectory);
    }
  }
}

export function launchCommand(command, args, options, { spawnImpl = spawn } = {}) {
  return new Promise((resolveLaunch, rejectLaunch) => {
    let child;
    try {
      child = spawnImpl(command, args, options);
    } catch (error) {
      rejectLaunch(error);
      return;
    }
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
    child.on('error', rejectLaunch);
    child.on('close', (code, signal) => {
      if (code === null) {
        rejectLaunch(new Error(`Reproduction command exited via signal ${signal ?? 'unknown'}`));
        return;
      }
      resolveLaunch(code);
    });
  });
}

function usage() {
  return [
    'Usage:',
    '  reproduction-checkout.mjs run --repository PATH --head-sha SHA -- COMMAND [ARG...]',
  ].join('\n');
}

function readRunArguments(args) {
  const separator = args.indexOf('--');
  if (separator < 0) throw new Error(usage());
  const optionArgs = args.slice(0, separator);
  const commandArgs = args.slice(separator + 1);
  if (commandArgs.length === 0 || commandArgs[0].length === 0) {
    throw new Error('A command is required after --');
  }
  if (optionArgs.length % 2 !== 0) throw new Error(usage());

  const allowed = new Set(['repository', 'head-sha']);
  const options = {};
  for (let index = 0; index < optionArgs.length; index += 2) {
    const flag = optionArgs[index];
    const value = optionArgs[index + 1];
    const name = flag?.startsWith('--') ? flag.slice(2) : undefined;
    if (!name || !allowed.has(name) || value === undefined || options[name] !== undefined) {
      throw new Error(usage());
    }
    options[name] = value;
  }

  for (const name of allowed) {
    if (typeof options[name] !== 'string' || options[name].length === 0) {
      throw new Error(`--${name} is required`);
    }
  }
  return {
    repository: options.repository,
    headSha: options['head-sha'],
    command: commandArgs[0],
    args: commandArgs.slice(1),
  };
}

function stdoutFrom(result) {
  return typeof result === 'string' ? result : result?.stdout;
}

export async function main(args, dependencies = {}) {
  const [subcommand, ...rest] = args;
  if (subcommand !== 'run') throw new Error(usage());

  const parsed = readRunArguments(rest);
  const execute = dependencies.execute ?? defaultExecute;
  const runCommand = dependencies.launchCommand ?? launchCommand;
  return withReproductionCheckout({
    repository: parsed.repository,
    headSha: parsed.headSha,
    execute,
    inspect: async (checkoutPath) => {
      const exitCode = await runCommand(parsed.command, parsed.args, {
        cwd: checkoutPath,
        shell: false,
      });
      const status = stdoutFrom(await execute(
        'git',
        ['-C', checkoutPath, 'status', '--porcelain'],
      ));
      if (typeof status !== 'string') {
        throw new Error('Git status returned invalid output');
      }
      if (status.length > 0) {
        throw new Error('Reproduction modified the detached checkout');
      }
      return exitCode;
    },
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (exitCode) => { process.exitCode = exitCode; },
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
