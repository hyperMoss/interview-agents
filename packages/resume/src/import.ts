import { emptyResume, resumeDocumentSchema, type ResumeDocument } from '../../contracts/src/resume-document';

/** Local conversion keeps unclassified source text rather than guessing employment entries. */
export function resumeFromText(input: { filename: string; text: string; warnings: string[] }): ResumeDocument {
  const lines = input.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const field = (labels: string) => lines.map(line => line.match(new RegExp(`^(?:${labels})[：:]\\s*(.+)$`))?.[1]).find(Boolean) ?? '';
  return resumeDocumentSchema.parse({ ...emptyResume,
    name: field('姓名|Name'), title: field('求职意向|目标岗位|应聘职位|Title'), experience: field('工作年限|经验年限'),
    summary: { items: lines },
    importSource: { filename: input.filename, text: input.text, warnings: input.warnings, status: 'needs_review' },
  });
}

export function resumeText(document: ResumeDocument): string {
  return document.order.flatMap(section => {
    switch (section) {
      case 'header': return [document.name, document.title, document.experience, ...document.contactMethod.items.map(item => [item.label, item.value].filter(Boolean).join('：'))];
      case 'summary': return document.summary.items;
      case 'skills': return document.skills.map(item => [item.level, item.content].filter(Boolean).join('：'));
      case 'work': return document.work.flatMap(item => [item.company, item.position, item.date, ...item.summary]);
      case 'projects': return document.projects.flatMap(item => [item.name, item.date, item.background ?? '', item.techStack ?? '', item.role ?? '', ...item.summary]);
      case 'education': return document.education.flatMap(item => [item.institution, item.degree, item.date]);
    }
  }).filter(Boolean).join('\n');
}
