import { describe, expect, it } from 'vitest';
import { associateSelectedBank, preparationFingerprint, preparationOffer, rememberPreparationDecision } from '../apps/web/src/preparation-handoff';

const material = {
  role: '前端工程师',
  jobDescription: '岗位职责：负责 React 页面的状态管理、接口联调与性能优化。任职要求：能解释自动化测试如何验证请求竞争。',
  level: 'mid',
  round: 'first',
  roleFamily: 'frontend',
};
const selectedBank = '6d89b3d8-0b3b-4e30-8037-3d13cf37af16';
const offer = (patch: Partial<Parameters<typeof preparationOffer>[0]> = {}) => preparationOffer({ ...material, detailsValid: true, bankIds: [], ...patch });

describe('JD 备题衔接判定', () => {
  it('never offers preparation before the intake details pass validation', () => {
    expect(preparationOffer({ ...material, detailsValid: false, bankIds: [] })).toBe('invalid');
    expect(preparationOffer({ ...material, detailsValid: false, bankIds: [selectedBank] })).toBe('invalid');
  });

  it('offers preparation when the material is valid and no questions are selected', () => {
    expect(offer()).toBe('offer');
    expect(offer({ handoff: { decisions: [] } })).toBe('offer');
  });

  it('continues without asking when the selected bank belongs to the current material', () => {
    expect(offer({ bankIds: [selectedBank], handoff: { decisions: [], bankFingerprint: preparationFingerprint(material) } })).toBe('selected-bank');
  });

  it('re-judges a selected bank that was carried from an earlier JD', () => {
    const earlier = { ...material, jobDescription: '岗位职责：负责 Node.js 接口与数据库设计。任职要求：能解释事务边界与幂等。' };
    expect(offer({ bankIds: [selectedBank], handoff: { decisions: [], bankFingerprint: preparationFingerprint(earlier) } })).toBe('offer');
  });

  it('remembers a skipped or opened choice for the same material and ignores whitespace-only edits', () => {
    const skipped = rememberPreparationDecision(undefined, { fingerprint: preparationFingerprint(material), decision: 'skipped' });
    expect(offer({ handoff: skipped })).toBe('remembered');
    expect(offer({ handoff: skipped, role: ` ${material.role} `, jobDescription: material.jobDescription.replace(' ', '  \n ') })).toBe('remembered');
    const opened = rememberPreparationDecision(undefined, { fingerprint: preparationFingerprint(material), decision: 'opened' });
    expect(offer({ handoff: opened })).toBe('remembered');
  });

  it('re-judges after the JD, level, round or role family changes', () => {
    const skipped = rememberPreparationDecision(undefined, { fingerprint: preparationFingerprint(material), decision: 'skipped' });
    expect(offer({ handoff: skipped, jobDescription: `${material.jobDescription} 另需负责数据看板。` })).toBe('offer');
    expect(offer({ handoff: skipped, level: 'senior' })).toBe('offer');
    expect(offer({ handoff: skipped, round: 'second' })).toBe('offer');
    expect(offer({ handoff: skipped, roleFamily: 'backend' })).toBe('offer');
    expect(offer({ handoff: skipped, roleType: 'nontechnical' })).toBe('offer');
    expect(offer({ handoff: skipped, role: '后端工程师' })).toBe('offer');
  });

  it('keeps one decision per material and bounds the remembered history', () => {
    let handoff = rememberPreparationDecision(undefined, { fingerprint: preparationFingerprint(material), decision: 'skipped' });
    handoff = rememberPreparationDecision(handoff, { fingerprint: preparationFingerprint(material), decision: 'opened' });
    expect(handoff.decisions).toEqual([{ fingerprint: preparationFingerprint(material), decision: 'opened' }]);
    for (let index = 0; index < 25; index++) handoff = rememberPreparationDecision(handoff, { fingerprint: preparationFingerprint({ ...material, role: `岗位 ${index}` }), decision: 'skipped' });
    expect(handoff.decisions).toHaveLength(20);
    expect(handoff.decisions.at(-1)?.fingerprint).toBe(preparationFingerprint({ ...material, role: '岗位 24' }));
    expect(handoff.decisions[0]?.fingerprint).toBe(preparationFingerprint({ ...material, role: '岗位 5' }));
  });

  it('associates carried questions with the material they arrived with, without overwriting recorded history', () => {
    expect(associateSelectedBank({ ...material, bankIds: [] })).toBeUndefined();
    expect(associateSelectedBank({ ...material, bankIds: [selectedBank] })).toEqual({ decisions: [], bankFingerprint: preparationFingerprint(material) });
    const recorded = rememberPreparationDecision(undefined, { fingerprint: preparationFingerprint(material), decision: 'skipped' });
    expect(associateSelectedBank({ ...material, bankIds: [selectedBank], handoff: recorded })).toBe(recorded);
  });

  it('produces a stable, bounded fingerprint', () => {
    const fingerprint = preparationFingerprint(material);
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(preparationFingerprint({ ...material, role: `  ${material.role}  ` })).toBe(fingerprint);
    expect(preparationFingerprint({ ...material, jobDescription: material.jobDescription.replace(' ', '\n') })).toBe(fingerprint);
    expect(preparationFingerprint({ ...material, jobDescription: `${material.jobDescription}。` })).not.toBe(fingerprint);
  });
});
