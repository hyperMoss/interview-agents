import { z } from 'zod';
import {
  isSensitiveWorkspaceKey, isWorkspaceKey, normalizeWorkspaceValue, workspaceBackupSchema,
  workspaceCategory, type WorkspaceBackup, type WorkspaceCategory,
} from '../../../packages/contracts/src/workspace';

const recordSchema = z.strictObject({ key: z.string(), value: z.string().nullable(), version: z.number().int().positive(), updatedAt: z.iso.datetime() });
const conflictSchema = z.strictObject({
  key: z.string(), localValue: z.string().nullable(), remoteValue: z.string().nullable(), remoteVersion: z.number().int().nonnegative(),
});
function isPagePreference(key: string) { return key === 'workspace-route' || key === 'algorithm-view' || key === 'interview-selected'; }
type StoredRecord = z.infer<typeof recordSchema>;
export type WorkspaceConflict = z.infer<typeof conflictSchema>;
type MemoryRecord = { value: string | null; version: number; updatedAt: string; dirty: boolean };
export type WorkspaceSnapshot = {
  state: 'saving' | 'saved' | 'error' | 'conflict'; initialized: boolean;
  records: { key: string; category: WorkspaceCategory; value: string; updatedAt: string }[];
  conflicts: WorkspaceConflict[]; errors: string[]; warnings: string[];
};
export type WorkspaceImportPreview = {
  bundle: WorkspaceBackup;
  records: { key: string; category: WorkspaceCategory; conflict: boolean; same: boolean; currentValue: string | null; version: number }[];
};
type LegacyStorage = Pick<Storage, 'getItem' | 'removeItem' | 'key' | 'length'>;
function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error ?? new Error('本机数据请求失败。')); });
}
function opened(operation: IDBOpenDBRequest) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; reject(new Error('本机数据打开超时。')); }, 1500);
    operation.onsuccess = () => { clearTimeout(timeout); if (timedOut) operation.result.close(); else resolve(operation.result); };
    operation.onerror = () => { clearTimeout(timeout); reject(operation.error ?? new Error('本机数据无法打开。')); };
  });
}
function completed(transaction: IDBTransaction) {
  const result = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('本机数据操作已撤销。'));
    transaction.onerror = () => reject(transaction.error ?? new Error('本机数据操作失败。'));
  });
  void result.catch(() => {});
  return result;
}
function errorMessage(error: unknown) {
  return error instanceof Error && error.name === 'QuotaExceededError'
    ? '本机存储空间不足。请导出备份后清理浏览器空间，再重试保存。'
    : '本机数据未能保存。请保持页面打开、导出备份，再重试保存或检查浏览器存储权限。';
}
export class WorkspaceStore {
  private db: IDBDatabase | null = null;
  private memory = new Map<string, MemoryRecord>();
  private observedVersions = new Map<string, number>();
  private conflicts = new Map<string, WorkspaceConflict>();
  private errors = new Map<string, string>();
  private warnings: string[] = [];
  private pending = new Set<string>();
  private legacyKeys = new Set<string>();
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private initialization: Promise<void> | null = null;
  private initialized = false;
  private channel: BroadcastChannel | null = null;
  private snapshot: WorkspaceSnapshot = { state: 'saved', initialized: false, records: [], conflicts: [], errors: [], warnings: [] };
  constructor(private options: { indexedDB?: IDBFactory; legacyStorage?: LegacyStorage; databaseName?: string; broadcast?: boolean }) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  read(key: string) {
    this.observedVersions.set(key, this.memory.get(key)?.version ?? 0);
    return this.peek(key);
  }
  private peek(key: string) { return this.memory.get(key)?.value ?? null; }
  private publish() {
    this.snapshot = {
      initialized: this.initialized,
      state: this.conflicts.size ? 'conflict' : this.errors.size ? 'error' : this.pending.size || [...this.memory.values()].some(record => record.dirty) ? 'saving' : 'saved',
      records: [...this.memory].flatMap(([key, record]) => record.value === null ? [] : [{ key, value: record.value, category: workspaceCategory(key), updatedAt: record.updatedAt }]),
      conflicts: [...this.conflicts.values()], errors: [...this.errors.values()], warnings: [...this.warnings],
    };
    for (const listener of this.listeners) listener();
  }
  initialize() {
    this.initialization ??= this.load();
    return this.initialization;
  }
  private async load() {
    try {
      if (!this.options.indexedDB) throw new Error('IndexedDB 不可用');
      const opening = this.options.indexedDB.open(this.options.databaseName ?? 'interview-agents-workspace', 1);
      opening.onupgradeneeded = () => {
        if (!opening.result.objectStoreNames.contains('records')) opening.result.createObjectStore('records', { keyPath: 'key' });
        if (!opening.result.objectStoreNames.contains('conflicts')) opening.result.createObjectStore('conflicts', { keyPath: 'key' });
      };
      opening.onblocked = () => { this.errors.set('open', '本机数据升级被其他页面阻止。请关闭其他面试练习页面后刷新。'); this.publish(); };
      this.db = await opened(opening);
      this.db.onversionchange = () => { this.db?.close(); this.db = null; this.errors.set('open', '本机数据版本已更新，请导出当前修改后刷新页面。'); this.publish(); };
      const transaction = this.db.transaction(['records', 'conflicts'], 'readonly');
      const done = completed(transaction);
      const [rawRecords, rawConflicts] = await Promise.all([request<unknown[]>(transaction.objectStore('records').getAll()), request<unknown[]>(transaction.objectStore('conflicts').getAll())]);
      await done;
      for (const raw of rawRecords) {
        const result = recordSchema.safeParse(raw);
        if (!result.success || !isWorkspaceKey(result.data.key)) { this.warnings.push('一项无法识别的旧数据已隔离，其他数据可正常使用。'); continue; }
        const record = result.data;
        try {
          const value = record.value === null ? null : normalizeWorkspaceValue(record.key, record.value, true);
          if (!this.memory.get(record.key)?.dirty) this.memory.set(record.key, { ...record, value, dirty: false });
          if (value !== record.value) this.warnings.push('已保留旧草稿中可恢复的作答，损坏条目已隔离。');
        } catch { this.warnings.push('一项旧草稿无法恢复，原记录仍保留在本机。'); }
      }
      for (const raw of rawConflicts) {
        const result = conflictSchema.safeParse(raw);
        if (result.success && isWorkspaceKey(result.data.key)) {
          try {
            const conflict = { ...result.data, localValue: result.data.localValue === null ? null : normalizeWorkspaceValue(result.data.key, result.data.localValue, true), remoteValue: result.data.remoteValue === null ? null : normalizeWorkspaceValue(result.data.key, result.data.remoteValue, true) };
            this.conflicts.set(conflict.key, conflict);
            const record = this.memory.get(conflict.key);
            this.memory.set(conflict.key, { value: conflict.localValue, version: record?.version ?? 0, updatedAt: record?.updatedAt ?? new Date().toISOString(), dirty: true });
          } catch { this.warnings.push('一项损坏的冲突版本已隔离，其他草稿可正常恢复。'); }
        }
      }
      if (this.options.broadcast && typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel(`${this.options.databaseName ?? 'interview-agents-workspace'}-changes`);
        this.channel.onmessage = () => { void this.refresh(); };
      }
    } catch (error) { if (!this.errors.has('open')) this.errors.set('open', errorMessage(error)); }
    if (!this.initialized) await this.migrateLegacy();
    this.initialized = true;
    this.publish();
  }
  private async migrateLegacy() {
    const legacy = this.options.legacyStorage;
    if (!legacy) return;
    const keys: string[] = [];
    try { for (let index = 0; index < legacy.length; index++) { const key = legacy.key(index); if (key && isWorkspaceKey(key)) keys.push(key); } }
    catch { this.warnings.push('无法读取旧标签页草稿，原数据未被清理。'); return; }
    for (const key of keys) {
      try {
        const raw = legacy.getItem(key);
        if (raw === null) continue;
        const normalized = normalizeWorkspaceValue(key, raw, true);
        this.legacyKeys.add(key);
        const existing = this.memory.get(key);
        if (existing && existing.value !== normalized) {
          const conflict = { key, localValue: normalized, remoteValue: existing.value, remoteVersion: existing.version };
          this.conflicts.set(key, conflict);
          this.memory.set(key, { ...existing, value: normalized, dirty: true });
          if (this.db) {
            const transaction = this.db.transaction('conflicts', 'readwrite'); const done = completed(transaction);
            transaction.objectStore('conflicts').put(conflict); await done;
          }
          continue;
        }
        if (!existing) this.memory.set(key, { value: normalized, version: 0, updatedAt: new Date().toISOString(), dirty: true });
        if (!this.db) continue;
        if (!existing || existing.dirty) await this.save(key);
        if (!this.errors.has(key) && !this.conflicts.has(key)) { legacy.removeItem(key); this.legacyKeys.delete(key); }
        if (normalized !== raw) this.warnings.push('旧草稿已迁移，可恢复条目已保留。');
      } catch { this.warnings.push('一项旧标签页草稿无法迁移，已保留原数据。'); }
    }
  }
  write(key: string, value: string | null): boolean {
    try { if (!isWorkspaceKey(key)) throw new Error('未知数据类型'); if (value !== null) value = normalizeWorkspaceValue(key, value); }
    catch { this.errors.set(key, '草稿格式不正确，未写入本机。请保留当前内容并导出备份。'); this.publish(); return false; }
    const current = this.memory.get(key);
    if (current?.value === value && !current.dirty) return true;
    this.memory.set(key, { value, version: this.observedVersions.get(key) ?? current?.version ?? 0, updatedAt: new Date().toISOString(), dirty: true });
    this.pending.add(key); this.errors.delete(key); this.publish();
    this.queue = this.queue.then(() => this.save(key));
    return true;
  }
  private async save(key: string) {
    const local = this.memory.get(key);
    if (!local?.dirty) { this.pending.delete(key); this.publish(); return; }
    if (!this.db) { this.errors.set(key, errorMessage(null)); this.pending.delete(key); this.publish(); return; }
    this.pending.add(key); this.publish();
    try {
      const unresolved = this.conflicts.get(key);
      if (unresolved) {
        const conflict = { ...unresolved, localValue: local.value };
        const transaction = this.db.transaction('conflicts', 'readwrite'); const done = completed(transaction);
        transaction.objectStore('conflicts').put(conflict); await done; this.conflicts.set(key, conflict);
        this.pending.delete(key); this.publish(); return;
      }
      const transaction = this.db.transaction(['records', 'conflicts'], 'readwrite'); const done = completed(transaction);
      const raw: unknown = await request(transaction.objectStore('records').get(key));
      const actual = raw === undefined ? null : recordSchema.parse(raw);
      if ((actual?.version ?? 0) !== local.version && !isPagePreference(key)) {
        const conflict = { key, localValue: local.value, remoteValue: actual?.value ?? null, remoteVersion: actual?.version ?? 0 };
        transaction.objectStore('conflicts').put(conflict); await done; this.conflicts.set(key, conflict);
      } else {
        const record: StoredRecord = { key, value: local.value, version: (actual?.version ?? 0) + 1, updatedAt: local.updatedAt };
        transaction.objectStore('records').put(record); await done;
        const latest = this.memory.get(key);
        if (latest) this.memory.set(key, { ...latest, version: record.version, dirty: latest.value !== local.value });
        this.observedVersions.set(key, record.version);
        this.errors.delete(key); this.conflicts.delete(key); this.channel?.postMessage({ key });
        try {
          if (this.legacyKeys.has(key) || this.options.legacyStorage?.getItem(key) === local.value) { this.options.legacyStorage?.removeItem(key); this.legacyKeys.delete(key); }
        } catch {}
      }
    } catch (error) { this.errors.set(key, errorMessage(error)); }
    this.pending.delete(key); this.publish();
  }
  async flush() { await this.queue; }
  async retry() {
    if (!this.db) {
      this.initialization = null;
      await this.initialize();
      if (!this.db) return;
    }
    this.errors.delete('open');
    for (const [key, record] of this.memory) if (record.dirty && !this.conflicts.has(key)) { this.pending.add(key); this.queue = this.queue.then(() => this.save(key)); }
    this.publish(); await this.flush();
  }
  async refresh() {
    await this.flush(); if (!this.db) return;
    try {
      const transaction = this.db.transaction('records', 'readonly'); const done = completed(transaction);
      const raw: unknown[] = await request(transaction.objectStore('records').getAll()); await done;
      for (const item of raw) {
        const parsed = recordSchema.safeParse(item); if (!parsed.success || !isWorkspaceKey(parsed.data.key)) continue;
        const actual = parsed.data; const local = this.memory.get(actual.key);
        if (!local) {
          if (!isPagePreference(actual.key) && !this.observedVersions.has(actual.key)) this.observedVersions.set(actual.key, 0);
          this.memory.set(actual.key, { ...actual, dirty: false }); continue;
        }
        if (isPagePreference(actual.key)) { if (!local.dirty) this.memory.set(actual.key, { ...actual, dirty: false }); continue; }
        if (actual.version !== local.version && actual.value !== local.value) {
          const conflict = { key: actual.key, localValue: local.value, remoteValue: actual.value, remoteVersion: actual.version };
          this.conflicts.set(actual.key, conflict);
          const conflictTransaction = this.db.transaction('conflicts', 'readwrite'); const conflictDone = completed(conflictTransaction);
          conflictTransaction.objectStore('conflicts').put(conflict); await conflictDone;
        } else if (actual.value === local.value) this.memory.set(actual.key, { ...local, version: actual.version });
      }
      this.publish();
    } catch (error) { this.errors.set('refresh', errorMessage(error)); this.publish(); }
  }
  async resolveConflict(key: string, choice: 'reload' | 'local') {
    await this.flush(); if (!this.db || !this.conflicts.has(key)) return;
    const transaction = this.db.transaction(['records', 'conflicts'], 'readwrite'); const done = completed(transaction);
    const raw: unknown = await request(transaction.objectStore('records').get(key)); const actual = raw === undefined ? null : recordSchema.parse(raw);
    const conflict = this.conflicts.get(key); if (!conflict) return;
    if (choice === 'local' && (actual?.version ?? 0) !== conflict.remoteVersion) {
      const refreshed = { ...conflict, remoteValue: actual?.value ?? null, remoteVersion: actual?.version ?? 0 };
      transaction.objectStore('conflicts').put(refreshed); await done; this.conflicts.set(key, refreshed); this.publish();
      throw new Error('其他页面再次修改了此项。已保留双方内容，请重新核对后选择。');
    }
    const local = this.memory.get(key);
    const chosenValue = choice === 'reload' ? actual?.value ?? null : local ? local.value : conflict.localValue;
    const record = { key, value: chosenValue, version: (actual?.version ?? 0) + 1, updatedAt: new Date().toISOString() };
    transaction.objectStore('records').put(record); transaction.objectStore('conflicts').delete(key); await done;
    this.memory.set(key, { ...record, dirty: false }); this.conflicts.delete(key); this.errors.delete(key); this.channel?.postMessage({ key }); this.publish();
    this.observedVersions.set(key, record.version);
    try { if (this.legacyKeys.has(key)) { this.options.legacyStorage?.removeItem(key); this.legacyKeys.delete(key); } } catch {}
  }
  backup(includeSensitive = false): WorkspaceBackup {
    return workspaceBackupSchema.parse({ format: 'interview-agents-workspace', version: 1, exportedAt: new Date().toISOString(), includesSensitive: includeSensitive,
      records: [...this.memory].flatMap(([key, record]) => record.value === null || (!includeSensitive && isSensitiveWorkspaceKey(key)) ? [] : [{ key, value: record.value }]),
      conflicts: [...this.conflicts.values()].filter(conflict => includeSensitive || !isSensitiveWorkspaceKey(conflict.key)).map(({ key, localValue, remoteValue }) => ({ key, localValue: this.memory.get(key)?.value === undefined ? localValue : this.memory.get(key)?.value ?? null, remoteValue })),
    });
  }
  previewImport(text: string): WorkspaceImportPreview {
    if (new Blob([text]).size > 12_000_000) throw new Error('备份文件不能超过 12 MB。');
    const bundle = workspaceBackupSchema.parse(JSON.parse(text));
    const candidates = new Map(bundle.records.map(record => [record.key, record.value]));
    for (const conflict of bundle.conflicts) candidates.set(conflict.key, conflict.localValue ?? '');
    return { bundle, records: [...candidates].map(([key, value]) => ({ key, category: workspaceCategory(key), conflict: this.peek(key) !== null && (this.peek(key) !== value || bundle.conflicts.some(conflict => conflict.key === key)), same: this.peek(key) === value && !bundle.conflicts.some(conflict => conflict.key === key), currentValue: this.peek(key), version: this.memory.get(key)?.version ?? 0 })) };
  }
  async restore(preview: WorkspaceImportPreview, overwriteKeys: string[] = []) {
    await this.flush();
    if (!this.db) throw new Error('本机存储不可用，未导入任何数据。');
    const bundle = workspaceBackupSchema.parse(preview.bundle);
    const overwrite = new Set(overwriteKeys);
    const transaction = this.db.transaction(['records', 'conflicts'], 'readwrite'); const done = completed(transaction);
    const applied: StoredRecord[] = [];
    const appliedConflicts: WorkspaceConflict[] = [];
    const candidates = new Map<string, string | null>(bundle.records.map(record => [record.key, record.value]));
    for (const conflict of bundle.conflicts) candidates.set(conflict.key, conflict.remoteValue);
    try {
      for (const [key, value] of candidates) {
        const raw: unknown = await request(transaction.objectStore('records').get(key));
        const actual = raw === undefined ? null : recordSchema.parse(raw);
        const memory = this.memory.get(key);
        if ((actual?.value !== null && actual?.value !== undefined || memory?.value !== null && memory?.value !== undefined) && !overwrite.has(key)) continue;
        const expected = preview.records.find(record => record.key === key);
        if (!expected || expected.version !== (actual?.version ?? 0) || expected.currentValue !== this.peek(key)) throw new Error('预览后本机数据发生变化，请重新选择备份。');
        const stored = { key, value, version: (actual?.version ?? 0) + 1, updatedAt: new Date().toISOString() };
        transaction.objectStore('records').put(stored); transaction.objectStore('conflicts').delete(key); applied.push(stored);
        const backedConflict = bundle.conflicts.find(conflict => conflict.key === key);
        if (backedConflict) {
          const conflict = { ...backedConflict, remoteVersion: stored.version };
          transaction.objectStore('conflicts').put(conflict); appliedConflicts.push(conflict);
        }
      }
      await done;
    } catch (error) { try { transaction.abort(); } catch {} await done.catch(() => {}); throw new Error('备份恢复失败，原有数据未改变。', { cause: error }); }
    for (const record of applied) { this.memory.set(record.key, { ...record, dirty: false }); this.conflicts.delete(record.key); this.errors.delete(record.key); }
    for (const conflict of appliedConflicts) { const record = this.memory.get(conflict.key); if (record) this.memory.set(conflict.key, { ...record, value: conflict.localValue, dirty: true }); this.conflicts.set(conflict.key, conflict); }
    this.channel?.postMessage({ restored: true }); this.publish(); return applied.length;
  }
  async clearCategory(category: WorkspaceCategory) {
    await this.flush(); if (!this.db) throw new Error('本机存储不可用，未清理数据。');
    const transaction = this.db.transaction(['records', 'conflicts'], 'readwrite'); const done = completed(transaction);
    const keys = [...this.memory.keys()].filter(key => workspaceCategory(key) === category);
    const records: StoredRecord[] = [];
    for (const key of keys) {
      const raw: unknown = await request(transaction.objectStore('records').get(key)); const actual = raw === undefined ? null : recordSchema.parse(raw);
      const record = { key, value: null, version: (actual?.version ?? 0) + 1, updatedAt: new Date().toISOString() };
      transaction.objectStore('records').put(record); transaction.objectStore('conflicts').delete(key); records.push(record);
    }
    await done;
    for (const record of records) { this.memory.set(record.key, { ...record, dirty: false }); this.conflicts.delete(record.key); this.errors.delete(record.key); try { this.options.legacyStorage?.removeItem(record.key); } catch {} }
    this.channel?.postMessage({ cleared: category }); this.publish();
  }
  close() { this.db?.close(); this.db = null; this.channel?.close(); }
}

let workspace: WorkspaceStore | null = null;
function browserStorage() { try { return globalThis.sessionStorage; } catch { return undefined; } }
function currentWorkspace() {
  workspace ??= new WorkspaceStore({ indexedDB: globalThis.indexedDB, legacyStorage: browserStorage(), broadcast: typeof window !== 'undefined' });
  return workspace;
}
export function initializeWorkspace() { return currentWorkspace().initialize(); }
export function subscribeWorkspace(listener: () => void) { return currentWorkspace().subscribe(listener); }
export function getWorkspaceSnapshot() { return currentWorkspace().getSnapshot(); }
export function readWorkspaceValue(key: string) { return currentWorkspace().read(key); }
export function writeWorkspaceValue(key: string, value: string | null) { return currentWorkspace().write(key, value); }
export function flushWorkspace() { return currentWorkspace().flush(); }
export function retryWorkspaceSaves() { return currentWorkspace().retry(); }
export function resolveWorkspaceConflict(key: string, choice: 'reload' | 'local') { return currentWorkspace().resolveConflict(key, choice); }
export function createWorkspaceBackup(includeSensitive = false) { return currentWorkspace().backup(includeSensitive); }
export function previewWorkspaceImport(text: string) { return currentWorkspace().previewImport(text); }
export function restoreWorkspaceBackup(preview: WorkspaceImportPreview, overwriteKeys: string[] = []) { return currentWorkspace().restore(preview, overwriteKeys); }
export function clearWorkspaceCategory(category: WorkspaceCategory) { return currentWorkspace().clearCategory(category); }
