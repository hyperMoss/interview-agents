import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';
import { z } from 'zod';
import type { AgentConfig } from '../../../packages/config/src/index';
import type { ModelDraft } from '../../../packages/contracts/src/models';
import { preparationOutputSchema, preparedQuestionSchema, preparationResultSchema, type PreparationInput, type PreparationOutput } from '../../../packages/contracts/src/preparation';
import { preparationDifficulty, validatePreparation } from '../../../packages/interview/src/preparation';
import { coachModel } from './coach-model';
import { ModelAccessError } from './models';

import {preparationInstructions} from './preparation-instructions';

export async function generatePreparation(config: AgentConfig, input: PreparationInput, signal: AbortSignal, connection?: ModelDraft) {
  if (config.MODEL_MODE === 'disabled' && !connection) throw new ModelAccessError('MODEL_NOT_CONFIGURED', 409, '先启用模型连接，再生成备题单。');
  const modelMode = connection ? 'live' : config.MODEL_MODE;
  let output: PreparationOutput;
  if (modelMode === 'demo') output = demoPreparation(input);
  else {
    const mastra = new Mastra({ agents: { preparer: new Agent({ id: 'jd-preparation', name: 'JD Preparation', instructions:preparationInstructions, maxRetries: 0, model: coachModel(config, connection) }) }, logger: false });
    const agent = mastra.getAgent('preparer');
    const schema=preparationOutputSchema.extend({
      requirements:preparationOutputSchema.shape.requirements.max(Math.min(6,input.questionCount)),
      questions:z.array(preparedQuestionSchema.extend({
        answerOutline:z.array(z.string().trim().min(2).max(900)).min(4).max(6),
        category:z.literal(input.round==='hr'||input.roleType==='nontechnical'?'behavioral':'technical'),
        difficulty:z.literal(preparationDifficulty(input)),
      })).length(input.questionCount),
    });
    const outputSchema=z.toJSONSchema(schema);
    const generate=async(correcting:boolean)=>{
      const result = await agent.generate(JSON.stringify({ kind: 'jd-preparation', input, difficulty: preparationDifficulty(input), outputSchema,
        ...(correcting?{correction:'上次输出未通过结构或岗位依据校验。重新生成完整 JSON，严格遵守字段、数量、下标、逐字引用和问题去重约束。'}:{}),
      }), {
        maxSteps: 1, maxProcessorRetries: 0, abortSignal: signal,
        modelSettings: { maxOutputTokens: Math.max(12000,input.questionCount*2000)+(correcting?4000:0), maxRetries: 0 },
        structuredOutput: { schema: outputSchema, errorStrategy: 'strict' },
      });
      signal.throwIfAborted();
      return validatePreparation(input, result.object);
    };
    try { output=await generate(false); }
    catch(error){
      if(signal.aborted||!isPreparationValidationError(error)&&!isPreparationOutputLimit(error))throw error;
      output=await generate(true);
    }
  }
  return preparationResultSchema.parse({ ...output, modelMode, model: modelMode === 'demo' ? 'rules-demo-v1' : connection?.model ?? config.LLM_MODEL });
}

export function isPreparationValidationError(error:unknown){
  return error instanceof z.ZodError||error instanceof Error&&(
    error.message.startsWith('PREPARATION_')||error.message.startsWith('Structured output validation failed')||error.message.startsWith('No object generated')||error.name==='AI_JSONParseError'
  );
}

export function isPreparationOutputLimit(error:unknown){
  const parsed=z.object({id:z.literal('STRUCTURED_OUTPUT_TRUNCATED'),details:z.object({finishReason:z.literal('length')})}).safeParse(error);
  return parsed.success;
}

export function demoPreparation(input: PreparationInput): PreparationOutput {
  const quotes = input.jobDescription.match(/[^\n。；;!?！？]+[。；;!?！？]?/g)?.map(value => value.trim()).filter(value => value.length >= 2) ?? [];
  const requirements = (quotes.length ? quotes : [input.jobDescription]).slice(0, Math.min(4, input.questionCount)).map((quote, index) => ({
    competency: `岗位要求 ${index + 1}`,
    priority: /优先|加分|preferred|bonus|nice.to.have/i.test(quote) ? 'preferred' satisfies 'preferred' : 'required' satisfies 'required',
    quote: quote.slice(0, 600).replace(/[\uD800-\uDBFF]$/, ''),
  }));
  const angles = ['基础理解', '实际行动', '方案取舍', '故障定位', '结果验证', '协作沟通', '风险应对', '学习计划', '约束变化', '反馈改进', '职责边界', '复盘总结'];
  const questions = Array.from({ length: input.questionCount }, (_, index) => {
    const requirementIndex = index % requirements.length;
    const requirement = requirements[requirementIndex];
    if (!requirement) throw new Error('PREPARATION_REQUIREMENT_MISSING');
    const behavioral = input.round === 'hr' || input.roleType === 'nontechnical';
    return {
      title: `${angles[index]}与岗位匹配`, requirementIndex, difficulty: preparationDifficulty(input),
      category: behavioral ? 'behavioral' satisfies 'behavioral' : 'technical' satisfies 'technical',
      text: `围绕 JD 中的「${requirement.quote}」，从${angles[index]}的角度${behavioral ? '描述一个真实经历或可执行的处理思路，说明你的行动与证据。' : `说明你对${input.role}相关问题的理解，给出具体方案、边界与验证方法。`}`,
      answerOutline: [
        '结论与目标：这一题首先要把岗位要求转化为可验证的问题，明确输入、输出和约束，再选择实现方案。规则演示只能提供通用回答结构；具体技术结论需要结合真实题目核对，个人经历必须由你补充可查证的事实。',
        behavioral?'行动与沟通：假设场景中，先确认各方目标、时间约束和各自责任，将分歧整理成需要决定的问题，再提出可执行的下一步，并约定反馈时间。描述实际经历时，应区分自己的行动和团队行动，不能把通用建议当成已完成的工作。':'实施与例子：假设需要实现一个业务管理页面，先明确接口字段和状态流转，将数据读取、业务处理、结果展示分开，按正常路径逐步完成，再补充请求失败与数据缺失的处理。这个例子用于展示组织答案的方法，并非当前题目的已验证技术解答。',
        '取舍与异常：对比至少一种可行替代方案，说明各自适用条件和引入的维护成本。当需求或输入异常时，先识别影响范围，再决定重试、降级或人工处理；不要为了显示知识面堆砌与题目无关的技术，也不要虚构采用某方案后取得的收益。',
        '验证与复盘：为正常输入、边界条件和失败路径分别准备可重复的检查，通过测试结果、日志和反馈核对行为是否符合目标。使用指标时解释其含义和局限，记录尚未确认的假设；若要加入个人案例，此处补充自己真实负责的工作及其证据。',
      ],
      followUps: ['如果约束发生变化，你会如何调整，怎样验证调整有效？'],
    };
  });
  return validatePreparation(input, { requirements, questions });
}
