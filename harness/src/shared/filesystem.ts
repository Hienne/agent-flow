import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizePath } from './paths.js';

export function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function writeFileAtomic(path: string, content: string): void {
  const directory = dirname(path);
  ensureDirectory(directory);
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = openSync(temporary, 'w');
  try {
    writeFileSync(descriptor, content, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
  try {
    const directoryDescriptor = openSync(directory, 'r');
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } catch {
    // Windows does not expose directory fsync consistently; the file itself is flushed above.
  }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function removePath(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

export function fileHash(paths: string[], seed = ''): string {
  const hash = createHash('sha256').update(seed);
  for (const path of [...new Set(paths)].sort()) {
    hash.update(normalizePath(path)).update('\0');
    if (!existsSync(path) || statSync(path).isDirectory()) {
      hash.update('<missing>\0');
      continue;
    }
    hash.update(readFileSync(path)).update('\0');
  }
  return hash.digest('hex');
}

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
