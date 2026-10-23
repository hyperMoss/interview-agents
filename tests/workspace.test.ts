import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { WorkspaceStore } from '../apps/web/src/workspace-store';
import { workspaceBackupSchema } from '../packages/contracts/src/workspace';

class LegacyStorage implements Storage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
}
const intake = JSON.stringify({ role: '前端工程师', resume: '我的项目经历', jobDescription: '岗位要求', level: 'mid', questionCount: 6, focus: '' });
const answerKey = 'answer-6d89b3d8-0b3b-4e30-8037-3d13cf37af16-question-1';
const hot100 = (code: string) => JSON.stringify({ version: 1, selectedId: 1, filters: { query: '', group: 'all', difficulty: 'all', status: 'all' }, entries: [{ questionId: 1, code, notes: '哈希表', status: 'doing' }] });
const stores: WorkspaceStore[] = [];
function makeStore(factory = new IDBFactory(), legacyStorage?: Storage) {
  const store = new WorkspaceStore({ indexedDB: factory, legacyStorage, databaseName: 'workspace-test' }); stores.push(store); return store;
}
afterEach(() => { for (const store of stores) store.close(); stores.length = 0; vi.restoreAllMocks(); });

describe('long-term browser workspace', () => {
  it('migrates valid keys independently and retains corrupt and unrelated legacy values', async () => {
    const legacy = new LegacyStorage();
    legacy.setItem('interview-intake', intake); legacy.setItem('hot100-practice-v1', hot100('return 1'));
    legacy.setItem('jd-preparation-v1', '{broken'); legacy.setItem('model-api-key', 'never-import-this');
    const factory = new IDBFactory(); const store = makeStore(factory, legacy); await store.initialize();
    expect(store.read('interview-intake')).toBe(intake);
    expect(legacy.getItem('interview-intake')).toBeNull(); expect(legacy.getItem('hot100-practice-v1')).toBeNull();
    expect(legacy.getItem('jd-preparation-v1')).toBe('{broken'); expect(legacy.getItem('model-api-key')).toBe('never-import-this');
    expect(store.getSnapshot().warnings.length).toBeGreaterThan(0);
    store.close(); const reopened = makeStore(factory); await reopened.initialize();
    expect(reopened.read('hot100-practice-v1')).toBe(hot100('return 1'));
    expect(reopened.read('model-api-key')).toBeNull();
  });
  it('salvages valid answers from an old Hot 100 draft with one damaged entry', async () => {
    const legacy = new LegacyStorage(); const draft = JSON.parse(hot100('return 1'));
    draft.entries.push({ questionId: 2, code: 99, notes: '', status: 'doing' });
    draft.selectedId = 'broken selection'; draft.filters = { difficulty: 'broken filter' };
    legacy.setItem('hot100-practice-v1', JSON.stringify(draft));
    const store = makeStore(new IDBFactory(), legacy); await store.initialize();
    expect(JSON.parse(store.read('hot100-practice-v1') ?? '{}').entries).toEqual([{ questionId: 1, code: 'return 1', notes: '哈希表', status: 'doing' }]);
    expect(store.getSnapshot().warnings.length).toBeGreaterThan(0);
  });
  it('persists each key, reports saves, and keeps deletions across reopening', async () => {
    const factory = new IDBFactory(); const store = makeStore(factory); await store.initialize();
    const states: string[] = []; store.subscribe(() => states.push(store.getSnapshot().state));
    store.write('algorithm-view', 'hot100'); store.write('interview-intake', intake); store.write(answerKey, '独立保存的答案');
    await store.flush(); expect(states).toContain('saving'); expect(store.getSnapshot().state).toBe('saved');
    store.write('interview-intake', null); await store.flush(); store.close();
    const reopened = makeStore(factory); await reopened.initialize();
    expect(reopened.read('algorithm-view')).toBe('hot100'); expect(reopened.read('interview-intake')).toBeNull(); expect(reopened.read(answerKey)).toBe('独立保存的答案');
  });
  it('does not silently overwrite another tab and preserves both versions after closing', async () => {
    const factory = new IDBFactory(); const first = makeStore(factory); await first.initialize();
    first.write('hot100-practice-v1', hot100('original')); await first.flush();
    const second = makeStore(factory); await second.initialize();
    first.write('hot100-practice-v1', hot100('remote change')); await first.flush();
    second.write('hot100-practice-v1', hot100('my change')); await second.flush();
    expect(second.getSnapshot().state).toBe('conflict');
    expect(second.getSnapshot().conflicts[0]).toMatchObject({ localValue: hot100('my change'), remoteValue: hot100('remote change') });
    second.close(); const reopened = makeStore(factory); await reopened.initialize();
    expect(reopened.read('hot100-practice-v1')).toBe(hot100('my change'));
    expect(reopened.getSnapshot().conflicts[0]?.remoteValue).toBe(hot100('remote change'));
    reopened.write('hot100-practice-v1', hot100('my change')); await reopened.flush();
    expect(reopened.getSnapshot().state).toBe('conflict');
    const backup = reopened.backup(); expect(backup.conflicts[0]).toMatchObject({ localValue: hot100('my change'), remoteValue: hot100('remote change') });
    const restored = makeStore(); await restored.initialize(); await restored.restore(restored.previewImport(JSON.stringify(backup)));
    expect(restored.getSnapshot().conflicts[0]).toMatchObject({ localValue: hot100('my change'), remoteValue: hot100('remote change') });
    await reopened.resolveConflict('hot100-practice-v1', 'local');
    expect(reopened.getSnapshot().state).toBe('saved');
    reopened.close(); const final = makeStore(factory); await final.initialize(); expect(final.read('hot100-practice-v1')).toBe(hot100('my change'));
  });
  it('refreshes external changes into a conflict and rechecks the version before keeping local', async () => {
    const factory = new IDBFactory(); const first = makeStore(factory); await first.initialize();
    first.write(answerKey, '原作答'); await first.flush(); const second = makeStore(factory); await second.initialize();
    first.write(answerKey, '远端新作答'); await first.flush(); await second.refresh();
    expect(second.read(answerKey)).toBe('原作答'); expect(second.getSnapshot().state).toBe('conflict');
    first.write(answerKey, '再次修改'); await first.flush();
    await expect(second.resolveConflict(answerKey, 'local')).rejects.toThrow('再次修改');
    await second.resolveConflict(answerKey, 'reload'); expect(second.read(answerKey)).toBe('再次修改');
  });
  it('updates page preferences without treating navigation in separate tabs as a content conflict', async () => {
    const factory = new IDBFactory(); const first = makeStore(factory); await first.initialize();
    first.write('workspace-route', '#/home'); await first.flush(); const second = makeStore(factory); await second.initialize();
    first.write('workspace-route', '#/algorithms/hot100/1'); await first.flush(); await second.refresh();
    expect(second.read('workspace-route')).toBe('#/algorithms/hot100/1'); expect(second.getSnapshot().state).toBe('saved');
    second.write('workspace-route', '#/settings/data'); await second.flush();
    expect(second.getSnapshot().conflicts).toEqual([]);
  });
  it('preserves both profiles when two mounted pages create the first collection', async () => {
    const factory = new IDBFactory(); const first = makeStore(factory); const second = makeStore(factory);
    await first.initialize(); await second.initialize();
    expect(first.read('job-profiles-v1')).toBeNull(); expect(second.read('job-profiles-v1')).toBeNull();
    const profile = (name: string) => JSON.stringify({ version: 1, profiles: [{ id: crypto.randomUUID(), name, input: JSON.parse(intake), updatedAt: new Date().toISOString() }] });
    const a = profile('页面 A 档案'); const b = profile('页面 B 档案');
    first.write('job-profiles-v1', a); await first.flush(); await second.refresh();
    second.write('job-profiles-v1', b); await second.flush();
    expect(second.getSnapshot().state).toBe('conflict');
    expect(second.getSnapshot().conflicts[0]).toMatchObject({ localValue: b, remoteValue: a });
    const reopened = makeStore(factory); await reopened.initialize();
    expect(reopened.getSnapshot().conflicts[0]).toMatchObject({ localValue: b, remoteValue: a });
  });
  it('retains migration source and memory after a failed write, then safely retries', async () => {
    const legacy = new LegacyStorage(); legacy.setItem('hot100-practice-v1', hot100('preserve me'));
    const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const factory = new IDBFactory(); const store = makeStore(factory, legacy); await store.initialize();
    expect(store.read('hot100-practice-v1')).toBe(hot100('preserve me')); expect(legacy.getItem('hot100-practice-v1')).not.toBeNull();
    expect(store.getSnapshot().state).toBe('error'); expect(store.backup().records[0]?.value).toBe(hot100('preserve me'));
    failure.mockRestore(); await store.retry();
    expect(store.getSnapshot().state).toBe('saved'); expect(legacy.getItem('hot100-practice-v1')).toBeNull();
    store.close(); const reopened = makeStore(factory); await reopened.initialize(); expect(reopened.read('hot100-practice-v1')).toBe(hot100('preserve me'));
  });
  it('keeps writing in memory when IndexedDB is unavailable and exposes backup recovery', async () => {
    const store = new WorkspaceStore({}); stores.push(store); await store.initialize();
    expect(store.write('hot100-practice-v1', hot100('not lost'))).toBe(true); await store.flush();
    expect(store.read('hot100-practice-v1')).toBe(hot100('not lost')); expect(store.getSnapshot().state).toBe('error');
    expect(store.backup().records).toEqual([{ key: 'hot100-practice-v1', value: hot100('not lost') }]);
  });
  it('preserves edits made during a storage outage when reopening the database', async () => {
    const legacy = new LegacyStorage(); legacy.setItem('hot100-practice-v1', hot100('old draft'));
    const factory = new IDBFactory(); const blocked = vi.spyOn(factory, 'open').mockImplementationOnce(() => { throw new DOMException('denied', 'SecurityError'); });
    const store = makeStore(factory, legacy); await store.initialize(); store.write('hot100-practice-v1', hot100('edited during outage')); await store.flush();
    blocked.mockRestore(); await store.retry();
    expect(store.read('hot100-practice-v1')).toBe(hot100('edited during outage')); expect(store.getSnapshot().state).toBe('saved');
    expect(legacy.getItem('hot100-practice-v1')).toBeNull();
  });
  it('excludes personal material by default and never admits credentials', async () => {
    const store = makeStore(); await store.initialize(); store.write('interview-intake', intake); store.write(answerKey, '用户的答案'); store.write('hot100-practice-v1', hot100('return 1'));
    expect(store.write('model-api-key', 'secret')).toBe(false); await store.flush();
    expect(store.backup().records.map(record => record.key)).toEqual(['hot100-practice-v1']);
    expect(store.backup(true).records.map(record => record.key)).toEqual(['interview-intake', answerKey, 'hot100-practice-v1']);
    expect(JSON.stringify(store.backup(true))).not.toContain('secret');
  });
  it('rejects malformed, unknown, duplicate and oversized imports before changing any data', async () => {
    const store = makeStore(); await store.initialize(); store.write('algorithm-view', 'patterns'); await store.flush();
    const bundle = store.backup();
    expect(() => store.previewImport('{broken')).toThrow();
    expect(() => store.previewImport(JSON.stringify({ ...bundle, records: [{ key: 'cookie', value: 'secret' }] }))).toThrow();
    expect(() => store.previewImport(JSON.stringify({ ...bundle, records: [...bundle.records, ...bundle.records] }))).toThrow();
    expect(() => store.previewImport(' '.repeat(12_000_001))).toThrow('12 MB');
    expect(store.read('algorithm-view')).toBe('patterns');
  });
  it('previews per-record conflicts and retains existing data unless selected for overwrite', async () => {
    const store = makeStore(); await store.initialize(); store.write('algorithm-view', 'patterns'); await store.flush();
    const bundle = workspaceBackupSchema.parse({ ...store.backup(), records: [{ key: 'algorithm-view', value: 'hot100' }, { key: 'hot100-practice-v1', value: hot100('imported') }] });
    const preview = store.previewImport(JSON.stringify(bundle)); expect(preview.records[0]?.conflict).toBe(true);
    expect(await store.restore(preview)).toBe(1); expect(store.read('algorithm-view')).toBe('patterns');
    expect(await store.restore(preview, ['algorithm-view'])).toBe(1); expect(store.read('algorithm-view')).toBe('hot100');
  });
  it('rolls back every record when a restore transaction fails partway through', async () => {
    const factory = new IDBFactory(); const store = makeStore(factory); await store.initialize(); store.write('algorithm-view', 'patterns'); await store.flush();
    const preview = store.previewImport(JSON.stringify({ ...store.backup(), records: [{ key: 'algorithm-view', value: 'hot100' }, { key: 'hot100-practice-v1', value: hot100('partial') }] }));
    const original = IDBObjectStore.prototype.put;
    let writes = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      writes++; if (writes === 2) throw new DOMException('full', 'QuotaExceededError');
      return original.call(this, value, key);
    });
    await expect(store.restore(preview, ['algorithm-view'])).rejects.toThrow('原有数据未改变');
    expect(store.read('algorithm-view')).toBe('patterns'); expect(store.read('hot100-practice-v1')).toBeNull();
    store.close(); const reopened = makeStore(factory); await reopened.initialize();
    expect(reopened.read('algorithm-view')).toBe('patterns'); expect(reopened.read('hot100-practice-v1')).toBeNull();
  });
  it('rejects a stale overwrite preview instead of replacing changes made after preview', async () => {
    const factory = new IDBFactory(); const store = makeStore(factory); await store.initialize(); store.write('algorithm-view', 'patterns'); await store.flush();
    const preview = store.previewImport(JSON.stringify({ ...store.backup(), records: [{ key: 'algorithm-view', value: 'hot100' }] }));
    store.write('algorithm-view', 'hot100'); await store.flush(); store.write('algorithm-view', 'patterns'); await store.flush();
    await expect(store.restore(preview, ['algorithm-view'])).rejects.toThrow('原有数据未改变'); expect(store.read('algorithm-view')).toBe('patterns');
  });
  it('clears only the requested local category and keeps unrelated drafts', async () => {
    const factory = new IDBFactory(); const store = makeStore(factory); await store.initialize();
    store.write('algorithm-view', 'hot100'); store.write('hot100-practice-v1', hot100('clear')); store.write('interview-intake', intake); await store.flush();
    await store.clearCategory('algorithm'); expect(store.read('hot100-practice-v1')).toBeNull(); expect(store.read('interview-intake')).toBe(intake);
    store.close(); const reopened = makeStore(factory); await reopened.initialize(); expect(reopened.read('algorithm-view')).toBeNull(); expect(reopened.read('interview-intake')).toBe(intake);
  });
});
