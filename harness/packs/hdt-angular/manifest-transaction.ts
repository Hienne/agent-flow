import { closeSync, existsSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { contentHash, ensureDirectory, readJson, writeFileAtomic, writeJsonAtomic } from '../../src/shared/filesystem.js';
import { SCRATCH_ROOT, normalizePath } from '../../src/shared/paths.js';

// SCRATCH_ROOT is read at call time: the CLI binds the project root before any transaction runs.
const transactionsRoot = (): string => join(SCRATCH_ROOT, 'transactions');
const locksRoot = (): string => join(SCRATCH_ROOT, 'locks');
const LOCK_TTL_MS = 8 * 60 * 60 * 1000;

export type TransactionState = 'prepared' | 'applied' | 'restored' | 'conflict' | 'abandoned';

export interface ManifestTransactionJournal {
  schemaVersion: 1;
  id: string;
  state: TransactionState;
  path: string;
  key: string;
  originalValue: unknown;
  overrideValue: unknown;
  beforeHash: string;
  afterHash: string;
  createdAt: string;
  updatedAt: string;
  conflict?: string;
}

export interface ManifestRestoration {
  status: 'restored' | 'merged' | 'conflict';
  content: string | null;
}

export interface ManifestTransaction {
  journal: ManifestTransactionJournal;
  restore: () => ManifestRestoration;
}

function processRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockPath(path: string): string {
  return join(locksRoot(), `${contentHash(resolve(path)).slice(0, 20)}.lock`);
}

function acquireLock(path: string): () => void {
  ensureDirectory(locksRoot());
  const target = lockPath(path);
  const owner = { pid: process.pid, acquiredAt: new Date().toISOString(), path: normalizePath(resolve(path)) };
  const create = (): void => {
    const descriptor = openSync(target, 'wx');
    try {
      writeFileSync(descriptor, `${JSON.stringify(owner)}\n`, 'utf8');
    } finally {
      closeSync(descriptor);
    }
  };
  try {
    create();
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    const current = readJson<{ pid?: number; acquiredAt?: string }>(target, {});
    const pid = Number(current.pid);
    const age = Date.now() - Date.parse(current.acquiredAt ?? '');
    const deadOwner = Number.isInteger(pid) && pid > 0 && !processRunning(pid);
    const staleUnknownOwner = (!Number.isInteger(pid) || pid <= 0) && Number.isFinite(age) && age > LOCK_TTL_MS;
    if (!deadOwner && !staleUnknownOwner) throw new Error(`Manifest transaction lock is held by PID ${current.pid ?? 'unknown'} since ${current.acquiredAt ?? 'unknown'}`);
    unlinkSync(target);
    create();
  }
  return () => {
    const current = readJson<{ pid?: number }>(target, {});
    if (Number(current.pid) === process.pid && existsSync(target)) unlinkSync(target);
  };
}

function transactionPath(id: string): string {
  return join(transactionsRoot(), id);
}

function saveJournal(directory: string, journal: ManifestTransactionJournal): void {
  journal.updatedAt = new Date().toISOString();
  writeJsonAtomic(join(directory, 'transaction.json'), journal);
}

export function restoreManifestContent(originalText: string, overrideText: string, currentText: string, key: string, overrideValue: unknown): ManifestRestoration {
  if (currentText === overrideText) return { status: 'restored', content: originalText };
  try {
    const original = JSON.parse(originalText) as Record<string, unknown>;
    const current = JSON.parse(currentText) as Record<string, unknown>;
    if (current[key] !== overrideValue) return { status: 'conflict', content: null };
    current[key] = original[key];
    return { status: 'merged', content: `${JSON.stringify(current, null, 4)}\n` };
  } catch {
    return { status: 'conflict', content: null };
  }
}

function restoreTransactionLocked(directory: string, journal: ManifestTransactionJournal): ManifestRestoration {
  const originalText = readFileSync(join(directory, 'before.manifest.json'), 'utf8');
  const overrideText = readFileSync(join(directory, 'after.manifest.json'), 'utf8');
  const currentText = readFileSync(journal.path, 'utf8');
  const restoration = restoreManifestContent(originalText, overrideText, currentText, journal.key, journal.overrideValue);
  if (restoration.content === null) {
    journal.state = 'conflict';
    journal.conflict = 'The harness-owned manifest key changed after the transaction was applied.';
    saveJournal(directory, journal);
    return restoration;
  }
  writeFileAtomic(journal.path, restoration.content);
  journal.state = 'restored';
  delete journal.conflict;
  saveJournal(directory, journal);
  return restoration;
}

function restoreTransaction(directory: string, journal: ManifestTransactionJournal): ManifestRestoration {
  const release = acquireLock(journal.path);
  try {
    return restoreTransactionLocked(directory, journal);
  } finally {
    release();
  }
}

export function beginManifestTransaction(path: string, key: string, overrideValue: unknown): ManifestTransaction {
  const release = acquireLock(path);
  let lockHandedToTransaction = false;
  try {
    const beforeText = readFileSync(path, 'utf8');
    const manifest = JSON.parse(beforeText) as Record<string, unknown>;
    if (!(key in manifest)) throw new Error(`Manifest key not found: ${key}`);
    const originalValue = manifest[key];
    manifest[key] = overrideValue;
    const afterText = `${JSON.stringify(manifest, null, 4)}\n`;
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const directory = transactionPath(id);
    ensureDirectory(directory);
    writeFileAtomic(join(directory, 'before.manifest.json'), beforeText);
    writeFileAtomic(join(directory, 'after.manifest.json'), afterText);
    const now = new Date().toISOString();
    const journal: ManifestTransactionJournal = {
      schemaVersion: 1,
      id,
      state: 'prepared',
      path: normalizePath(resolve(path)),
      key,
      originalValue,
      overrideValue,
      beforeHash: contentHash(beforeText),
      afterHash: contentHash(afterText),
      createdAt: now,
      updatedAt: now,
    };
    saveJournal(directory, journal);
    const currentText = readFileSync(path, 'utf8');
    if (contentHash(currentText) !== journal.beforeHash) {
      journal.state = 'conflict';
      journal.conflict = 'Manifest changed between prepare and apply.';
      saveJournal(directory, journal);
      throw new Error(journal.conflict);
    }
    writeFileAtomic(path, afterText);
    if (contentHash(readFileSync(path, 'utf8')) !== journal.afterHash) {
      journal.state = 'conflict';
      journal.conflict = 'Applied manifest hash does not match the transaction journal.';
      saveJournal(directory, journal);
      throw new Error(journal.conflict);
    }
    journal.state = 'applied';
    saveJournal(directory, journal);
    lockHandedToTransaction = true;
    let lockReleased = false;
    return {
      journal,
      restore: () => {
        if (journal.state === 'restored') return { status: 'restored', content: readFileSync(join(directory, 'before.manifest.json'), 'utf8') };
        if (lockReleased) return restoreTransaction(directory, journal);
        try {
          return restoreTransactionLocked(directory, journal);
        } finally {
          lockReleased = true;
          release();
        }
      },
    };
  } finally {
    if (!lockHandedToTransaction) release();
  }
}

function readJournal(directory: string, expectedId?: string): ManifestTransactionJournal {
  const path = join(directory, 'transaction.json');
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid manifest transaction journal ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid manifest transaction journal ${path}`);
  const journal = value as Partial<ManifestTransactionJournal>;
  if (journal.schemaVersion !== 1 || typeof journal.id !== 'string' || (expectedId && journal.id !== expectedId)
      || !['prepared', 'applied', 'restored', 'conflict', 'abandoned'].includes(journal.state ?? '')
      || typeof journal.path !== 'string' || typeof journal.key !== 'string'
      || typeof journal.beforeHash !== 'string' || typeof journal.afterHash !== 'string') {
    throw new Error(`Invalid manifest transaction journal ${path}`);
  }
  return journal as ManifestTransactionJournal;
}

function validateJournalArtifacts(directory: string, journal: ManifestTransactionJournal): void {
  const before = readFileSync(join(directory, 'before.manifest.json'), 'utf8');
  const after = readFileSync(join(directory, 'after.manifest.json'), 'utf8');
  if (contentHash(before) !== journal.beforeHash || contentHash(after) !== journal.afterHash) {
    throw new Error(`Manifest transaction ${journal.id} artifact hashes do not match its journal`);
  }
}

export function listManifestTransactions(): ManifestTransactionJournal[] {
  ensureDirectory(transactionsRoot());
  return readdirSync(transactionsRoot(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readJournal(join(transactionsRoot(), entry.name), entry.name))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

// expectedPath is the host manifest the caller means: a journal never steers a write to another file.
export function recoverManifestTransaction(id: string, expectedPath: string): ManifestRestoration {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{5,127}$/.test(id)) throw new Error('Invalid transaction id');
  const directory = transactionPath(id);
  const journal = readJournal(directory, id);
  if (resolve(expectedPath) !== resolve(journal.path)) throw new Error(`Transaction ${id} targets an unexpected manifest path`);
  validateJournalArtifacts(directory, journal);
  if (journal.state === 'restored' || journal.state === 'abandoned') return { status: 'restored', content: readFileSync(join(directory, 'before.manifest.json'), 'utf8') };
  if (!['prepared', 'applied', 'conflict'].includes(journal.state)) throw new Error(`Transaction ${id} is not recoverable from state ${journal.state}`);
  const release = acquireLock(journal.path);
  try {
    if (journal.state === 'prepared') {
      const currentText = readFileSync(journal.path, 'utf8');
      if (contentHash(currentText) === journal.beforeHash) {
        journal.state = 'abandoned';
        saveJournal(directory, journal);
        return { status: 'restored', content: currentText };
      }
      journal.state = 'applied';
      saveJournal(directory, journal);
    }
    return restoreTransactionLocked(directory, journal);
  } finally {
    release();
  }
}
