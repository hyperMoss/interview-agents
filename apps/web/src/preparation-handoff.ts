/**
 * 面试准备进入面试安排前的 JD 备题衔接判定。
 *
 * 判定只依赖资料、已选题库与已记录的选择，不触发生成或网络请求；
 * 页面负责在资料校验通过后调用，只有 `offer` 才弹引导。
 */

export type PreparationDecision = 'skipped' | 'opened';
export type PreparationHandoffDecision = { fingerprint: string; decision: PreparationDecision };
export type PreparationHandoff = { decisions: PreparationHandoffDecision[]; bankFingerprint?: string };
export type PreparationMaterial = { role: string; jobDescription: string; level: string; round: string; roleFamily: string; roleType?: 'technical' | 'nontechnical' };
export type PreparationOfferInput = PreparationMaterial & { detailsValid: boolean; bankIds: readonly string[]; handoff?: PreparationHandoff };
export type PreparationOffer = 'invalid' | 'selected-bank' | 'remembered' | 'offer';

const decisionLimit = 20;

function compact(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function hash32(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

/** 岗位、JD、级别、轮次与岗位方向决定一份备题资料；空白差异不算资料变化。 */
export function preparationFingerprint(material: PreparationMaterial) {
  const source = [compact(material.role), compact(material.jobDescription), material.level, material.round, material.roleFamily, material.roleType ?? 'technical'].join('\u0000');
  return `${hash32(source, 0x811c9dc5)}${hash32(source, 0x7f4a7c15)}`;
}

export function preparationOffer(input: PreparationOfferInput): PreparationOffer {
  if (!input.detailsValid) return 'invalid';
  const fingerprint = preparationFingerprint(input);
  if (input.bankIds.length > 0 && input.handoff?.bankFingerprint === fingerprint) return 'selected-bank';
  if (input.handoff?.decisions.some(entry => entry.fingerprint === fingerprint)) return 'remembered';
  return 'offer';
}

export function rememberPreparationDecision(handoff: PreparationHandoff | undefined, entry: PreparationHandoffDecision): PreparationHandoff {
  const decisions = (handoff?.decisions ?? []).filter(item => item.fingerprint !== entry.fingerprint);
  return { ...handoff, decisions: [...decisions, entry].slice(-decisionLimit) };
}

/**
 * 带入的已选题库（备题保存、BOSS 严格题单、资料档案）属于带入时的资料。
 * 只有完全没有历史记录时才建立这层关联，避免刷新或恢复档案后重复引导，
 * 同时保留旧 JD 题单在 JD 改变后重新判断的能力。
 */
export function associateSelectedBank(input: PreparationMaterial & { bankIds: readonly string[]; handoff?: PreparationHandoff }): PreparationHandoff | undefined {
  if (!input.bankIds.length || input.handoff) return input.handoff;
  return { decisions: [], bankFingerprint: preparationFingerprint(input) };
}
