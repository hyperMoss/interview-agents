import { z } from 'zod';

const text = z.string();
const bullets = z.array(text.min(1));
export const resumeThemes = ['minimal', 'navy', 'ats', 'teal', 'graphite', 'editorial', 'green'] as const;
export const resumeSections = ['header', 'summary', 'skills', 'work', 'projects', 'education'] as const;
export const resumeDocumentSchema = z.looseObject({
  schemaVersion: z.literal(3),
  name: text, title: text, experience: text, exampleNotice: text.optional(),
  theme: z.enum(resumeThemes).optional(),
  style: z.looseObject({ spacing: z.strictObject({
    'resume-line-height': z.number().min(1).max(3).optional(),
    'resume-heading-size': z.number().int().min(18).max(48).optional(),
    'resume-section-heading-size': z.number().int().min(12).max(30).optional(),
    'resume-body-padding-y': z.number().int().min(0).max(80).optional(),
    'resume-section-gap': z.number().int().min(0).max(60).optional(),
    'resume-entry-gap': z.number().int().min(0).max(48).optional(),
    'resume-list-gap': z.number().int().min(0).max(16).optional(),
  }).optional() }).optional(),
  order: z.array(z.enum(resumeSections)).min(1),
  contactMethod: z.looseObject({ items: z.array(z.looseObject({ label: text.optional(), value: text.min(1) })) }),
  summary: z.looseObject({ items: bullets }),
  work: z.array(z.looseObject({ company: text.min(1), position: text.min(1), date: text.min(1), summary: bullets })),
  projects: z.array(z.looseObject({ name: text.min(1), date: text.min(1), background: text.optional(), techStack: text.optional(), role: text.optional(), summary: bullets })),
  skills: z.array(z.looseObject({ level: text.optional(), content: text.min(1) })),
  education: z.array(z.looseObject({ institution: text.min(1), degree: text, date: text.min(1) })),
});
export type ResumeDocument = z.infer<typeof resumeDocumentSchema>;

const legacySchema = z.looseObject({
  schemaVersion: z.literal(2).optional(),
  basicInfo: z.looseObject({ items: z.array(z.looseObject({ label: text.optional(), value: text.min(1) })) }).optional(),
  contactMethod: resumeDocumentSchema.shape.contactMethod.optional(),
  order: z.array(text),
  skills: z.array(z.looseObject({ category: text.optional(), keywords: text.optional(), level: text.optional(), content: text.optional() })),
});
export function parseResumeDocument(raw: unknown): ResumeDocument {
  const record = z.record(z.string(), z.unknown()).parse(raw);
  if (record.schemaVersion === 2 || (record.schemaVersion === undefined && 'basicInfo' in record)) {
    const old = legacySchema.parse(record);
    const { basicInfo, ...rest } = old;
    return resumeDocumentSchema.parse({ ...rest, schemaVersion: 3,
      contactMethod: old.contactMethod ?? basicInfo,
      order: old.order.filter(key => key !== 'basicInfo'),
      skills: old.skills.map(skill => {
        if (skill.content !== undefined) return skill;
        const { category, keywords, ...extra } = skill;
        return { ...extra, level: category || '熟悉', content: keywords ? `${category ? `${category}: ` : ''}${keywords}` : category || '' };
      }).filter(skill => skill.content?.trim()),
    });
  }
  return resumeDocumentSchema.parse({ ...record, schemaVersion: record.schemaVersion ?? 3 });
}
export const resumeDraftInputSchema = z.strictObject({
  label: z.string().trim().min(1).max(100),
  document: z.unknown().transform((raw, ctx) => {
    try { return parseResumeDocument(raw); }
    catch (error) {
      if (error instanceof z.ZodError) for (const issue of error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
      else ctx.addIssue({ code: 'custom', message: '无效的简历 JSON。' });
      return z.NEVER;
    }
  }),
});
export const resumeDraftUpdateSchema = resumeDraftInputSchema.extend({ revision: z.number().int().positive() });
export const resumeDraftSchema = z.object({
  id: z.uuid(), label: z.string(), revision: z.number().int().positive(), document: resumeDocumentSchema,
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});
export const resumeDraftSummarySchema = resumeDraftSchema.omit({ document: true });
export type ResumeDraft = z.infer<typeof resumeDraftSchema>;
export const emptyResume: ResumeDocument = {
  schemaVersion: 3, name: '', title: '', experience: '', theme: 'minimal',
  order: [...resumeSections], contactMethod: { items: [] }, summary: { items: [] },
  work: [], projects: [], skills: [], education: [],
};
