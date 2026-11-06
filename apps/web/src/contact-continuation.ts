import type { CareerContactView } from '../../../packages/contracts/src/career';

type Contact = Pick<CareerContactView, 'id' | 'state' | 'updatedAt'>;
export type ContinuationResult = { completed: number; reason: 'completed' | 'blocked' | 'changed' | 'failed' | 'unknown' | 'cancelled' | 'timeout' };
export async function continueApprovedContacts(input: {
  read: () => Promise<Contact[]>;
  retry: (contact: Contact) => Promise<unknown>;
  signal: AbortSignal;
  wait: () => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}): Promise<ContinuationResult> {
  const now = input.now ?? Date.now;
  let completed = 0;
  const result = (reason: ContinuationResult['reason']): ContinuationResult => ({ completed, reason });
  const initial = await input.read();
  if (initial.some(row => ['unknown', 'queued', 'dispatching'].includes(row.state))) return result('blocked');
  const targets = initial.filter(row => row.state === 'failed');
  for (const target of targets) {
    if (input.signal.aborted) return result('cancelled');
    const rows = await input.read();
    if (input.signal.aborted) return result('cancelled');
    if (rows.some(row => ['unknown', 'queued', 'dispatching'].includes(row.state))) return result('blocked');
    const current = rows.find(row => row.id === target.id);
    if (!current || current.state !== 'failed' || current.updatedAt !== target.updatedAt) return result('changed');
    await input.retry(current);
    const deadline = now() + (input.timeoutMs ?? 90000);
    for (;;) {
      if (input.signal.aborted) return result('cancelled');
      const row = (await input.read()).find(row => row.id === target.id);
      if (input.signal.aborted) return result('cancelled');
      if (!row) return result('changed');
      if (row.state === 'confirmed' || row.state === 'already_contacted') { completed++; break; }
      if (row.state === 'failed' || row.state === 'unknown' || row.state === 'cancelled') return result(row.state);
      if (now() >= deadline) return result('timeout');
      await input.wait();
    }
  }
  return result('completed');
}
