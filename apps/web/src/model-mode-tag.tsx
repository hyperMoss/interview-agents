import { Badge, type BadgeVariant } from '@astryxdesign/core/Badge';
import { z } from 'zod';
import { modelSettingsSchema, type ModelSource } from '../../../packages/contracts/src/models';
import './model-mode.css';

type ModelSettings = z.infer<typeof modelSettingsSchema>;

/**
 * One mode reading for one surface. `label` is the user-facing copy; `hint` explains where the
 * reading comes from, so an unconfirmed reading never degrades into a demo claim.
 */
export type ModelModeBadge = {
  tone: 'live' | 'demo' | 'pending' | 'unconfigured' | 'unconfirmed';
  label: string;
  hint: string;
};

const badgeVariants: Record<ModelModeBadge['tone'], BadgeVariant> = {
  live: 'green', demo: 'orange', pending: 'neutral', unconfigured: 'neutral', unconfirmed: 'neutral',
};

const demoBadge: ModelModeBadge = {
  tone: 'demo',
  label: '演示模式',
  hint: '规则演示：不调用模型，评分与题单只用于体验流程，不代表专业能力评价。',
};

const unconfirmedBadge = (hint: string): ModelModeBadge => ({ tone: 'unconfirmed', label: '未确认', hint });

const liveBadge = (model: string, hint: string): ModelModeBadge => ({ tone: 'live', label: `AI · ${model}`, hint });

/**
 * Mode of an already started or finished interview, read from that session's frozen snapshot.
 * Later model-setting changes never alter this reading. `scope` decides the wording: a session row
 * and a per-turn row can legitimately differ because a retry may snapshot another connection
 * (`apps/api/src/interviews.ts` replaces `modelSource` on retry).
 */
export type FrozenScope = 'session' | 'turn';

const scopeNote = (scope: FrozenScope) => scope === 'turn'
  ? '这一题按本题记录显示当时实际使用的模型。'
  : '按本场记录快照显示，之后切换设置不会改写它；重试换过连接时，单题来源可能与这里不同。';

export function describeFrozenMode(mode: 'demo' | 'live' | undefined, source: ModelSource | null | undefined, scope: FrozenScope = 'session'): ModelModeBadge {
  if (mode === 'demo') return scope === 'turn'
    ? { ...demoBadge, hint: '这一题使用规则演示评分，不调用模型，不代表专业能力评价。' }
    : { ...demoBadge, hint: '这场面试使用规则演示，不调用模型；之后切换设置不会改写这条记录。' };
  if (mode !== 'live') return unconfirmedBadge('这条面试记录没有保存模型模式，无法确认当时使用的模型。');
  if (!source) return unconfirmedBadge('这场面试记录了 AI 模式，但没有保存模型来源。');
  if (source.kind === 'custom') return source.model
    ? liveBadge(source.model, `你自带的模型连接。${scopeNote(scope)}`)
    : unconfirmedBadge('这条记录缺少模型名；连接 ID 不会当作模型名展示。');
  return source.model
    ? liveBadge(source.model, `部署方默认模型。${scopeNote(scope)}`)
    : liveBadge('部署方默认模型', `没有记录具体模型名。${scopeNote(scope)}`);
}

/**
 * Mode of a record that keeps only `modelMode` (plus an optional model name), such as interview
 * history rows and preparation results. A missing model name stays visible as an unknown name.
 */
export function describeRecordedMode(mode: 'demo' | 'live' | undefined, model: string | undefined): ModelModeBadge {
  if (mode === 'demo') return demoBadge;
  if (mode !== 'live') return unconfirmedBadge('这条记录没有保存模型模式。');
  return model
    ? liveBadge(model, '按这条记录保存时的快照显示，不随当前模型设置变化。')
    : { tone: 'live', label: 'AI 模式', hint: '这条记录只保存了 AI 模式，没有保存模型名。' };
}

/**
 * Readiness of a not-yet-started entry point. Deployment default, an enabled personal connection
 * and the demo rules mode stay distinguishable; an unreadable or unavailable setting is unconfirmed.
 */
export function describeRuntimeMode(input: { data?: ModelSettings | undefined; pending?: boolean; failed?: boolean }): ModelModeBadge {
  if (input.pending) return { tone: 'pending', label: '读取模型状态…', hint: '正在读取本机模型设置。' };
  const settings = input.data;
  if (input.failed || !settings) return unconfirmedBadge('暂时读不到本机模型设置，可稍后重试；这里不会按演示模式显示。');
  if (settings.active) return liveBadge(settings.active.model, '已启用你自带的模型连接，开始练习时固定到这场记录。');
  if (settings.mode === 'live') return liveBadge(settings.defaultModel || '部署方默认模型', '使用部署方默认模型，开始练习时固定到这场记录。');
  if (settings.mode === 'demo') return demoBadge;
  return { tone: 'unconfigured', label: '未配置模型', hint: '还没有可用的模型，开始 AI 练习前需要先启用连接。' };
}

/** Small shared badge. It only renders the reading it receives; no key, hash or connection ID is shown. */
export function ModelModeTag({ badge, className }: { badge: ModelModeBadge; className?: string }) {
  return <span className={className ? `model-mode-tag ${className}` : 'model-mode-tag'} title={badge.hint} data-model-mode={badge.tone}>
    <Badge label={badge.label} variant={badgeVariants[badge.tone]} />
  </span>;
}
