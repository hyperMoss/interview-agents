import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ResumeDocument } from '../../contracts/src/resume-document';
import { ResumeSectionIcon, resumeIconNotice } from './icons';

function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*|==[^=]+==|\*[^*]+\*|<br\s*\/?\s*>)/gi).map((part, index) =>
    /^<br\s*\/?\s*>$/i.test(part) ? <br key={index} /> :
    part.startsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> :
    part.startsWith('==') ? <mark key={index}>{part.slice(2, -2)}</mark> :
    part.startsWith('*') && part.endsWith('*') ? <em key={index}>{part.slice(1, -1)}</em> : part)}</>;
}
function Bullets({ items }: { items: string[] }) {
  return items.length ? <ul>{items.map((text, index) => <li key={index}><p><Inline text={text} /></p></li>)}</ul> : null;
}
const titles = { summary: '个人简介', skills: '专业技能', work: '工作经历', projects: '项目经历', education: '教育背景' };
export function ResumeContent({ data }: { data: ResumeDocument }) {
  function section(key: ResumeDocument['order'][number]): ReactNode {
    if (key === 'header') return <header className="resume-header"><div className="resume-header-top"><div className="resume-header-identity"><h1 className="resume-name">{data.name}</h1></div><div className="resume-header-meta"><div className="resume-title-line">{[data.title, data.experience].filter(Boolean).join(' · ')}</div><div className="resume-contact-line">{data.contactMethod.items.map((item, i) => <span className="resume-contact-item" key={i}>{item.label ? <span className="resume-contact-label">{item.label}</span> : null}{item.value}</span>)}</div></div></div></header>;
    let content: ReactNode;
    switch (key) {
      case 'summary': content = data.summary.items.length ? <div className="resume-summary-content"><Bullets items={data.summary.items} /></div> : null; break;
      case 'skills': content = data.skills.length ? data.skills.map((entry, i) => <div className="resume-skill-item" key={i}><span className="resume-skill-level">{entry.level}</span><span className="resume-skill-content"><Inline text={entry.content} /></span></div>) : null; break;
      case 'work': content = data.work.length ? data.work.map((entry, i) => <div className="resume-entry" key={i}><div className="resume-entry-header"><div className="resume-entry-title">{entry.company} · {entry.position}</div><div className="resume-entry-date">{entry.date}</div></div><div className="resume-entry-summary"><Bullets items={entry.summary} /></div></div>) : null; break;
      case 'projects': content = data.projects.length ? data.projects.map((entry, i) => <div className="resume-entry resume-project-entry" key={i}><div className="resume-entry-header"><div className="resume-entry-title">{entry.name}</div><div className="resume-entry-date">{entry.date}</div></div><div className="resume-project-meta-list">{([['background', '项目背景'], ['techStack', '技术栈'], ['role', '职责']] as const).map(([field, label]) => entry[field] ? <div className="resume-project-meta" key={field}><span className="resume-project-meta-label">{label}</span><span className="resume-project-meta-value"><Inline text={entry[field]} /></span></div> : null)}</div><hr className="resume-project-divider" /><div className="resume-entry-summary"><Bullets items={entry.summary} /></div></div>) : null; break;
      case 'education': content = data.education.length ? data.education.map((entry, i) => <div className="resume-entry" key={i}><div className="resume-entry-header"><div><div className="resume-entry-title">{entry.institution}</div><div className="resume-entry-organization">{entry.degree}</div></div><div className="resume-entry-date">{entry.date}</div></div></div>) : null; break;
    }
    return content ? <section className="resume-section"><h2 className="resume-section-title"><ResumeSectionIcon section={key} />{titles[key]}</h2><div className="resume-section-content">{content}</div></section> : null;
  }
  return <>{data.exampleNotice ? <p className="resume-example-notice">{data.exampleNotice}</p> : null}{data.order.map((key, index) => <React.Fragment key={`${key}-${index}`}>{section(key)}</React.Fragment>)}</>;
}
export function resumeHtml(data: ResumeDocument, css: string) {
  const spacing = Object.entries(data.style?.spacing ?? {}).map(([key, value]) => `--${key}:${value}${key === 'resume-line-height' ? '' : 'px'}`).join(';');
  return '<!doctype html><!--' + resumeIconNotice + '-->' + renderToStaticMarkup(<html lang="zh-CN" data-theme={data.theme ?? 'minimal'}><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><meta httpEquiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" /><title>{`${data.name || '简历'}${data.title ? ` · ${data.title}` : ''}`}</title><style>{css + `\n:root{${spacing}}`}</style></head><body><ResumeContent data={data} /></body></html>);
}
