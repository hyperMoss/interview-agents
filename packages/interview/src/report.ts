import type { Session,Turn } from '../../contracts/src/index';
import type { Evaluation } from '../../contracts/src/planning';
function evaluationLines(evaluation:Evaluation|undefined){return evaluation?['','| 评估维度 | 分数 |','| --- | ---: |',`| 技术能力 | ${evaluation.technical===null?'不适用':evaluation.technical} |`,`| 沟通表达 | ${evaluation.communication} |`,`| 综合素质 | ${evaluation.overallQuality} |`,'',...(evaluation.rationale.technical?[`技术能力：${evaluation.rationale.technical}`]:[]),`沟通表达：${evaluation.rationale.communication}`,`综合素质：${evaluation.rationale.overallQuality}`,'']:[];}
function dimensionLines(dimensions:Turn['assessment']['dimensions']){
  if(!dimensions)return [];
  return ['','| 维度 | 分数 |','| --- | ---: |',`| 岗位相关 | ${dimensions.relevance} |`,`| 技术深度 | ${dimensions.depth} |`,`| 表达结构 | ${dimensions.clarity} |`,`| 结果证据 | ${dimensions.evidence} |`,''];
}
export function reportMarkdown(session:Session){
  const lines=[`# ${session.role}：面试练习记录`,'',`日期：${new Date(session.createdAt).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})}`,`模式：${session.modelMode==='demo'?'规则演示（非专业能力评价）':'AI 面试练习'}`,`状态：${session.status}`,''];
  if(session.plan)lines.push(`面试轮次：${{first:'一面',second:'二面',hr:'HR 面'}[session.plan.options.round]}`,`候选人级别：${{intern:'实习',new_grad:'校招',experienced:'社招'}[session.plan.options.candidateLevel]}`,`时长预算：${session.plan.options.durationMinutes} 分钟`,'');
  if(session.status==='completed')lines.push(`综合评分：${session.report.overallScore}/100`,'',session.report.summary,...(session.report.evaluation?evaluationLines(session.report.evaluation):dimensionLines(session.report.dimensions)),'','## 可保留的表达','',...session.report.strengths.map(text=>`- ${text}`),'','## 下一次练习重点','',...session.report.improvements.map(text=>`- ${text}`),'');
  for(const [index,turn]of session.turns.entries())lines.push(`## 第 ${index+1} 题 QA：${turn.question.competency}`,'',turn.question.text,'',`评分模型：${turn.modelSource.model??'部署方默认模型'}`,'','### 作答','',turn.answer,'','### 反馈','',`评分：${turn.assessment.score}/100`,...(turn.assessment.evaluation?evaluationLines(turn.assessment.evaluation):dimensionLines(turn.assessment.dimensions)),'',turn.assessment.feedback,'',`回答依据：${turn.assessment.evidence}`,'','可保留的表达：','',...turn.assessment.strengths.map(text=>`- ${text}`),'','改进方向：','',...turn.assessment.improvements.map(text=>`- ${text}`),'',...(turn.research?['参考来源：',...turn.research.sources.map(source=>`- [${source.title}](${source.url})`),'']:[]));
  return lines.join('\n');
}
