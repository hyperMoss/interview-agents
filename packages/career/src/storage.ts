import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, lstat, mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { BossEngine } from '../../contracts/src/career';

// Private local storage for resume originals and dedicated browser profiles.
// Paths are opaque, owner-derived and never returned to clients.

const KEY = /^[0-9a-f]{32}\/[0-9a-f-]{36}\.(pdf|docx|txt|md)$/;
const ALLOWED_EXT = new Set(['pdf', 'docx', 'txt', 'md']);

export class CareerStorageError extends Error {
  constructor(readonly code: 'STORAGE_UNAVAILABLE' | 'STORAGE_PATH' | 'STORAGE_PERMISSIONS', message: string) {
    super(`${code}: ${message}`);
  }
}

export function careerDataDir(env: { CAREER_LOCAL_DATA_DIR?: string; XDG_DATA_HOME?: string } = process.env) {
  if (env.CAREER_LOCAL_DATA_DIR) {
    if (!isAbsolute(env.CAREER_LOCAL_DATA_DIR)) throw new CareerStorageError('STORAGE_PATH', 'CAREER_LOCAL_DATA_DIR must be an absolute path');
    return env.CAREER_LOCAL_DATA_DIR;
  }
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'interview-agents', 'career');
  return join(env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'interview-agents', 'career');
}

function ownerSegment(owner: string) {
  return createHash('sha256').update(`career-owner:${owner}`).digest('hex').slice(0, 32);
}

async function ensurePrivateDirectory(path: string) {
  try {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new CareerStorageError('STORAGE_PATH', `${path} is not a private directory`);
    if ((info.mode & 0o077) !== 0) await chmod(path, 0o700);
  } catch (error) {
    if (error instanceof CareerStorageError) throw error;
    throw new CareerStorageError('STORAGE_UNAVAILABLE', `Cannot prepare ${path}`);
  }
}

async function assertPrivateFile(path: string) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new CareerStorageError('STORAGE_PATH', 'Stored file is not a regular file');
  if ((info.mode & 0o077) !== 0) await chmod(path, 0o600);
  return info;
}

export type StoredResumeFile = { storageKey: string; sha256: string; byteSize: number };

export class ResumeFileStore {
  constructor(readonly root: string) {}

  private resolve(key: string) {
    if (!KEY.test(key)) throw new CareerStorageError('STORAGE_PATH', 'Invalid storage key');
    return join(this.root, 'resume', key);
  }

  async put(owner: string, input: { bytes: Buffer; extension: string }): Promise<StoredResumeFile> {
    const extension = input.extension.toLowerCase();
    if (!ALLOWED_EXT.has(extension)) throw new CareerStorageError('STORAGE_PATH', 'Unsupported resume extension');
    const directory = join(this.root, 'resume', ownerSegment(owner));
    await ensurePrivateDirectory(directory);
    const storageKey = `${ownerSegment(owner)}/${randomUUID()}.${extension}`;
    const path = this.resolve(storageKey);
    const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      await handle.writeFile(input.bytes);
    } finally {
      await handle.close();
    }
    await chmod(path, 0o600);
    return { storageKey, sha256: createHash('sha256').update(input.bytes).digest('hex'), byteSize: input.bytes.length };
  }

  async read(owner: string, storageKey: string) {
    if (!storageKey.startsWith(`${ownerSegment(owner)}/`)) throw new CareerStorageError('STORAGE_PATH', 'Storage key belongs to another owner');
    const path = this.resolve(storageKey);
    await assertPrivateFile(path);
    return readFile(path);
  }

  /** Absolute private path for Playwright file input. Still owner-guarded and never returned to clients. */
  async localPath(owner: string, storageKey: string) {
    if (!storageKey.startsWith(`${ownerSegment(owner)}/`)) throw new CareerStorageError('STORAGE_PATH', 'Storage key belongs to another owner');
    const path = this.resolve(storageKey);
    await assertPrivateFile(path);
    return path;
  }

  async size(owner: string, storageKey: string) {
    if (!storageKey.startsWith(`${ownerSegment(owner)}/`)) throw new CareerStorageError('STORAGE_PATH', 'Storage key belongs to another owner');
    return (await assertPrivateFile(this.resolve(storageKey))).size;
  }

  async remove(storageKey: string) {
    if (!KEY.test(storageKey)) throw new CareerStorageError('STORAGE_PATH', 'Invalid storage key');
    await rm(this.resolve(storageKey), { force: true });
  }

  async exists(storageKey: string) {
    try {
      await access(this.resolve(storageKey));
      return true;
    } catch {
      return false;
    }
  }
}

/** Dedicated per-owner browser profile directory. Each engine owns a separate profile, because a
 *  Patchright Chrome profile, a Moli profile and a Playwright build cannot be assumed interchangeable. */
export class BrowserProfileStore {
  constructor(readonly root: string) {}

  directory(owner: string, engine: BossEngine) {
    return join(this.root, 'browser', ownerSegment(owner), engine);
  }

  async prepare(owner: string, engine: BossEngine) {
    const directory = this.directory(owner, engine);
    await ensurePrivateDirectory(directory);
    return directory;
  }

  /** Clear removes every engine profile this owner has, so no old login or challenge state survives. */
  async remove(owner: string) {
    await rm(join(this.root, 'browser', ownerSegment(owner)), { recursive: true, force: true });
  }

  async present(owner: string, engine: BossEngine) {
    try {
      return (await stat(this.directory(owner, engine))).isDirectory();
    } catch {
      return false;
    }
  }
}
