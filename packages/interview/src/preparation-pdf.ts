import type { PreparationPdf } from '../../contracts/src/preparation';
import { preparationAnswerSteps } from './preparation';

function escape(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

export function preparationPdfHtml({ input, result, drafts }: PreparationPdf) {
  const levels = { intern: '实习', new_grad: '校招', experienced: '社招' };
  const rounds = { first: '一面', second: '二面', hr: 'HR 面' };
  const difficulty = { easy: '简单', medium: '中等', hard: '困难' };
  const paragraphs = (steps: string[]) => `<ol>${preparationAnswerSteps(steps).map(step => `<li>${escape(step)}</li>`).join('')}</ol>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escape(input.role)}备题单</title>
<style>
@page{size:A4;margin:16mm 17mm 19mm}*{box-sizing:border-box}body{font-family:Arial,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;font-size:11pt;line-height:1.7;color:#172033;margin:0;overflow-wrap:anywhere}h1{font-size:23pt;line-height:1.3;margin:0 0 10pt}h2{font-size:16pt;margin:24pt 0 10pt;padding-bottom:5pt;border-bottom:1px solid #ccd6e3}h3{font-size:13pt;line-height:1.5;margin:20pt 0 7pt}h4{font-size:11pt;margin:13pt 0 5pt}h1,h2,h3,h4{break-after:avoid}p,li,.answer{white-space:pre-wrap;orphans:3;widows:3}p{margin:6pt 0}blockquote{margin:7pt 0 12pt;border-left:3px solid #9cabca;padding-left:11pt;white-space:pre-wrap;color:#42516b}.meta,.note{font-size:9pt;color:#56647a}.note{margin-top:24pt;border-top:1px solid #ccd6e3;padding-top:9pt}ol{padding-left:21pt;margin:6pt 0}li{padding-left:3pt;margin:0 0 9pt}.demo{padding:8pt 10pt;background:#fff5d7;border:1px solid #eddaa1}
</style></head><body><h1>${escape(input.role)}备题单</h1>
<p class="meta">${levels[input.candidateLevel]} · ${rounds[input.round]} · ${result.questions.length} 道题</p>
<p class="meta">生成模型：${escape(result.model)}</p>
${result.modelMode === 'demo' ? '<p class="demo">规则演示题单，内容需自行校核。</p>' : ''}
${input.focus ? `<p>备题重点：${escape(input.focus)}</p>` : ''}
<h2>岗位要求</h2>${result.requirements.map((item, index) => `<h3>${index + 1}. ${escape(item.competency)} · ${item.priority === 'required' ? '必备项' : '加分项'}</h3><blockquote>${escape(item.quote)}</blockquote>`).join('')}
<h2>面试题</h2>${result.questions.map((question, index) => {
    const draft = drafts?.[index];
    return `<article><h3>${index + 1}. ${escape(draft?.title ?? question.title)}</h3><p class="meta">${question.category === 'technical' ? '技术问答' : '行为问答'} · ${difficulty[question.difficulty]} · 对应要求 ${question.requirementIndex + 1}</p>
<p>${escape(draft?.content ?? question.text)}</p>
${draft ? `<h4>参考回答与追问</h4><div class="answer">${escape(draft.expectedAnswer)}</div>` : `<h4>参考回答</h4>${paragraphs(question.answerOutline)}<h4>追问</h4>${paragraphs(question.followUps)}`}</article>`;
  }).join('')}
<p class="note">参考回答用于学习与复述，假设示例不代表候选人已有经历。</p></body></html>`;
}
