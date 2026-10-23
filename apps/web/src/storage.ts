import { getWorkspaceSnapshot, readWorkspaceValue, writeWorkspaceValue } from './workspace-store';

export function readSession(key: string) {
  if (getWorkspaceSnapshot().initialized) return readWorkspaceValue(key);
  try { return sessionStorage.getItem(key); } catch { return null; }
}
export function readDraftValue(key: string) {
  return getWorkspaceSnapshot().initialized ? readWorkspaceValue(key) : sessionStorage.getItem(key);
}
export function writeSession(key: string, value: string | null) {
  if (getWorkspaceSnapshot().initialized) return writeWorkspaceValue(key, value);
  try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); return true; } catch { return false; }
}
export function tryClearInterviewDrafts(id: string) {
  for (const record of getWorkspaceSnapshot().records) if (record.key.startsWith(`answer-${id}-`)) writeWorkspaceValue(record.key, null);
  try {
    const keys: string[] = [];
    for (let index = 0; index < sessionStorage.length; index++) { const key = sessionStorage.key(index); if (key?.startsWith(`answer-${id}-`)) keys.push(key); }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {}
}
