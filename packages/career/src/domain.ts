import { createHash } from 'node:crypto';

// Career domain transitions. External effects are one-way: a dispatched action can never be
// replayed without a fresh explicit user command, and unknown outcomes never become a retry.

export function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function textSha256(text: string) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Deterministic uuid derived from a hex digest; the Agent receipt key uses the same mapping. */
export function uuidFromHash(hex: string) {
  const value = hex.padEnd(32, '0').slice(0, 32).split('');
  value[12] = '4';
  value[16] = '8';
  const raw = value.join('');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}

/** The Agent keeps one idempotent match receipt per scan work and site posting, so deleting a scan
 *  cannot find its receipts from the source rows alone. */
export function matchReceiptWorkId(scanWorkId: string, sitePostingId: string) {
  return uuidFromHash(digest({ match: scanWorkId, posting: sitePostingId }));
}

/** Resume source text keeps content exactly, only line endings are normalized. */
export function normalizeSourceText(text: string) {
  return text.replace(/\r\n?/g, '\n');
}

export type ConversationState = 'not_started' | 'dispatching' | 'confirmed' | 'failed' | 'unknown';
export type AttachmentState = 'blocked_by_conversation' | 'not_started' | 'awaiting_consent' | 'dispatching' | 'confirmed' | 'failed' | 'unknown';
export type EffectOutcome = 'confirmed' | 'awaiting_consent' | 'failed' | 'unknown';

const CONVERSATION_NEXT: Record<ConversationState, ConversationState[]> = {
  not_started: ['dispatching'], dispatching: ['confirmed', 'failed', 'unknown'], confirmed: [], failed: ['dispatching'], unknown: [],
};
const ATTACHMENT_NEXT: Record<AttachmentState, AttachmentState[]> = {
  blocked_by_conversation: ['not_started'], not_started: ['dispatching', 'awaiting_consent'], dispatching: ['confirmed', 'failed', 'unknown', 'awaiting_consent'],
  awaiting_consent: ['dispatching'], confirmed: [], failed: ['dispatching'], unknown: [],
};

export class EffectTransitionError extends Error {
  constructor(readonly from: string, readonly to: string) {
    super(`EFFECT_TRANSITION_REJECTED: ${from} -> ${to}`);
  }
}

function advance<T extends string>(table: Record<T, T[]>, from: T, to: T): T {
  if (!table[from].includes(to)) throw new EffectTransitionError(from, to);
  return to;
}

export function advanceConversation(from: ConversationState, to: ConversationState) {
  return advance(CONVERSATION_NEXT, from, to);
}

export function advanceAttachment(from: AttachmentState, to: AttachmentState, options: { explicitContinuation?: boolean } = {}) {
  if (from === 'awaiting_consent' && to === 'dispatching' && !options.explicitContinuation) throw new EffectTransitionError(from, to);
  return advance(ATTACHMENT_NEXT, from, to);
}

export function attachmentUnlocked(conversation: ConversationState): AttachmentState {
  return conversation === 'confirmed' ? 'not_started' : 'blocked_by_conversation';
}

export type RetryPhase = 'conversation' | 'attachment';

export function canRetryEffect(phase: RetryPhase, state: ConversationState | AttachmentState) {
  if (phase === 'conversation') return state === 'failed';
  return state === 'failed';
}

export function canReconcile(phase: RetryPhase, state: ConversationState | AttachmentState) {
  if (phase === 'conversation') return state === 'unknown';
  return state === 'unknown' || state === 'awaiting_consent';
}

/** One unknown or failed external effect per posting suspends that posting only. */
export function postingSuspended(conversation: ConversationState, attachment: AttachmentState) {
  return conversation === 'unknown' || attachment === 'unknown' || attachment === 'awaiting_consent';
}

export type BatchItemSettlement = { conversation: ConversationState; attachment: AttachmentState };
export type BatchState = 'approved' | 'delivering' | 'paused' | 'completed' | 'completed_with_review' | 'cancelled';

export function settleBatch(items: BatchItemSettlement[], options: { cancelled?: boolean; paused?: boolean } = {}): BatchState {
  if (options.cancelled) return 'cancelled';
  if (options.paused) return 'paused';
  if (items.some(item => item.conversation === 'dispatching' || item.attachment === 'dispatching' || item.conversation === 'not_started' || item.attachment === 'not_started')) return 'delivering';
  if (items.some(item => item.conversation === 'unknown' || item.attachment === 'unknown' || item.conversation === 'failed' || item.attachment === 'failed' || item.attachment === 'awaiting_consent')) return 'completed_with_review';
  return 'completed';
}

export const PAGE_FAILURE_PAUSE_THRESHOLD = 3;

export function shouldPauseForPageFailures(consecutiveFailures: number) {
  return consecutiveFailures >= PAGE_FAILURE_PAUSE_THRESHOLD;
}

export type BossObservedSession = 'absent' | 'login_required' | 'verification_required' | 'restricted' | 'ready' | 'unavailable';

/** Login, verification or site restriction pauses the whole batch instead of continuing per item. */
export function sessionPauseReason(observed: BossObservedSession, detail: string) {
  if (observed === 'ready') return null;
  if (observed === 'restricted') return { reason: 'site_restricted' as const, detail };
  // No managed page is open yet, or the page could not be read: automation stays paused. A page the
  // adapter cannot classify is not evidence of a login, and it is not evidence of readiness either.
  if (observed === 'absent' || observed === 'unavailable') return { reason: 'browser_unavailable' as const, detail };
  return { reason: observed, detail };
}

export type ApprovalDigestInput = {
  taskId: string;
  taskRevision: number;
  resumeVersionId: string;
  resumeTextSha256: string;
  attachmentSha256: string;
  modelConnectionId: string | null;
  sessionGeneration: number;
  accountMarker: string | null;
  items: Array<{ taskPostingId: string; postingSnapshotHash: string; greetingDraftRevision: number; finalGreeting: string }>;
};

/** Canonical approval digest over server-owned snapshots plus the candidate's final greetings. */
export function approvalDigest(input: ApprovalDigestInput) {
  return digest({
    version: 2,
    taskId: input.taskId,
    taskRevision: input.taskRevision,
    resumeVersionId: input.resumeVersionId,
    resumeTextSha256: input.resumeTextSha256,
    attachmentSha256: input.attachmentSha256,
    modelConnectionId: input.modelConnectionId,
    sessionGeneration: input.sessionGeneration,
    accountMarker: input.accountMarker,
    items: [...input.items]
      .map(item => ({ taskPostingId: item.taskPostingId, postingSnapshotHash: item.postingSnapshotHash, greetingDraftRevision: item.greetingDraftRevision, finalGreeting: item.finalGreeting }))
      .sort((left, right) => left.taskPostingId.localeCompare(right.taskPostingId)),
  });
}

/** A frozen batch may only act under the session generation and observed account it was approved
 *  with. A clear/reset bumps the generation; another login in the same profile changes the marker. */
export type ApprovedSession = { sessionGeneration: number; accountMarker: string | null };
export type ObservedAccount = { profileGeneration: number; accountMarker: string | null };

export function deliveryAuthorized(approved: ApprovedSession, observed: ObservedAccount | null) {
  if (!observed) return false;
  if (observed.profileGeneration !== approved.sessionGeneration) return false;
  // A batch approved without an observed marker can only be fenced by the generation. When the
  // approval recorded a marker, the same evidenced account is required.
  return approved.accountMarker === null || observed.accountMarker === approved.accountMarker;
}

const TASK_TRANSITIONS: Record<string, string[]> = {
  queued: ['searching', 'cancelled', 'failed', 'paused'],
  searching: ['matching', 'paused', 'failed', 'cancelled'],
  matching: ['review', 'paused', 'failed', 'cancelled'],
  review: ['paused', 'cancelled', 'failed'],
  paused: ['queued', 'searching', 'matching', 'review', 'cancelled'],
  failed: ['queued', 'cancelled'],
  cancelled: [],
};

export function advanceTaskPhase<P extends string>(from: P, to: P): P {
  const allowed = TASK_TRANSITIONS[from];
  if (!allowed) throw new Error(`UNKNOWN_TASK_PHASE: ${from}`);
  if (!allowed.includes(to)) throw new Error(`TASK_TRANSITION_REJECTED: ${from} -> ${to}`);
  return to;
}

export function greetingDigest(text: string) {
  return textSha256(text);
}
