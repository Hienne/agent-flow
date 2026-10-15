import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { ROOT } from './paths.js';

export interface RunResult {
  command: string;
  cwd: string;
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export function executable(name: string): string {
  if (process.platform !== 'win32') return name;
  if (['npm', 'npx', 'pnpm', 'yarn', 'mvn'].includes(name)) return `${name}.cmd`;
  if (name === 'gradle') return 'gradle.bat';
  return name;
}

export function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; maxBuffer?: number } = {}): RunResult {
  const started = Date.now();
  const cwd = options.cwd ?? ROOT;
  const spawnOptions = { cwd, encoding: 'utf8' as const, env: { ...process.env, ...options.env }, maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024, windowsHide: true };
  // Windows runs .cmd and .bat files only through a shell, which takes one command line.
  const result = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable(command))
    ? spawnSync([executable(command), ...args].map((part) => (/[\s"&|<>^]/.test(part) ? `"${part.replace(/"/g, '""')}"` : part)).join(' '), { ...spawnOptions, shell: true })
    : spawnSync(executable(command), args, spawnOptions);
  return {
    command: [command, ...args].join(' '),
    cwd,
    code: result.status ?? 2,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? (result.signal ? `Process terminated by signal ${result.signal}` : ''),
    durationMs: Date.now() - started,
  };
}

export function truncateOutput(value: string, limit = 4000): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit / 2)}\n... <truncated> ...\n${value.slice(-limit / 2)}`;
}

export function waitForPort(port: number, host = '127.0.0.1', timeoutMs = 120000): Promise<void> {
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const attempt = (): void => {
      const socket = net.createConnection({ port, host });
      socket.setTimeout(1000);
      socket.once('connect', () => {
        socket.destroy();
        resolvePromise();
      });
      const retry = (): void => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) reject(new Error(`Timed out waiting for ${host}:${port}`));
        else setTimeout(attempt, 500);
      };
      socket.once('error', retry);
      socket.once('timeout', retry);
    };
    attempt();
  });
}
