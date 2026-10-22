import { describe, expect, it } from 'vitest';
import { preparationInputSchema, savePreparationSchema, type PreparationInput, type PreparationResult } from '../packages/contracts/src/preparation';
import { demoPreparation, generatePreparation } from '../apps/agent/src/preparation';
import { preparationBankDraft, preparationMarkdown, validatePreparation } from '../packages/interview/src/preparation';
import { agentConfig } from './fixtures';

export const preparationInput:PreparationInput={role:'前端工程师',jobDescription:'熟悉 React 与 TypeScript，负责复杂页面状态与性能优化。优先考虑熟悉自动化测试的候选人。',candidateLevel:'new_grad',round:'first',roleType:'technical',roleFamily:'frontend',questionCount:6,focus:'请求竞争与状态管理'};

describe('JD preparation contracts',()=>{
  it('generates requested question counts with literal JD quotes and optional requirements',()=>{
    for(const questionCount of [3,6,12]){
      const input={...preparationInput,questionCount};const output=demoPreparation(input);
      expect(output.questions).toHaveLength(questionCount);
      expect(output.requirements.every(requirement=>input.jobDescription.includes(requirement.quote))).toBe(true);
      expect(output.requirements.some(requirement=>requirement.priority==='preferred')).toBe(true);
      expect(output.questions.every(question=>question.difficulty==='medium'&&question.category==='technical')).toBe(true);
      expect(validatePreparation(input,output)).toEqual(output);
    }
  });
  it('uses round-specific categories and candidate-specific difficulties',()=>{
    for(const candidateLevel of ['intern','new_grad','experienced'] satisfies PreparationInput['candidateLevel'][]){
      const output=demoPreparation({...preparationInput,candidateLevel,round:'hr'});
      expect(output.questions.every(question=>question.category==='behavioral')).toBe(true);
      expect(output.questions.every(question=>question.difficulty==={intern:'easy',new_grad:'medium',experienced:'hard'}[candidateLevel])).toBe(true);
    }
    expect(demoPreparation({...preparationInput,roleType:'nontechnical'}).questions.every(question=>question.category==='behavioral')).toBe(true);
    expect(demoPreparation({...preparationInput,round:'second'}).questions.every(question=>question.difficulty==='hard')).toBe(true);
  });
  it('rejects fabricated evidence, invalid references, repeated questions and incompatible categories',()=>{
    const mutate=(change:(output:ReturnType<typeof demoPreparation>)=>void)=>{const output=demoPreparation(preparationInput);change(output);return output;};
    expect(()=>validatePreparation(preparationInput,mutate(output=>{if(output.requirements[0])output.requirements[0].quote='虚构的岗位要求';}))).toThrow('UNGROUNDED');
    expect(()=>validatePreparation(preparationInput,mutate(output=>{if(output.questions[0])output.questions[0].requirementIndex=11;}))).toThrow('REQUIREMENT_MISMATCH');
    expect(()=>validatePreparation(preparationInput,mutate(output=>{output.questions.pop();}))).toThrow('COUNT_MISMATCH');
    expect(()=>validatePreparation(preparationInput,mutate(output=>{if(output.questions[0]&&output.questions[1])output.questions[1].text=output.questions[0].text;}))).toThrow('DUPLICATE');
    expect(()=>validatePreparation(preparationInput,mutate(output=>{if(output.questions[0])output.questions[0].category='behavioral';}))).toThrow('CATEGORY_MISMATCH');
    expect(()=>validatePreparation(preparationInput,mutate(output=>{if(output.questions[0])output.questions[0].difficulty='hard';}))).toThrow('DIFFICULTY_MISMATCH');
  });
  it('accepts JD-only inputs, enforces bounds and rejects repeated save IDs',()=>{
    expect(preparationInputSchema.parse(preparationInput)).not.toHaveProperty('resume');
    for(const questionCount of [0,2,13,1.5])expect(preparationInputSchema.safeParse({...preparationInput,questionCount}).success).toBe(false);
    const question=demoPreparation(preparationInput).questions[0];if(!question)throw new Error('Missing question');
    const item={requestId:crypto.randomUUID(),draft:preparationBankDraft(preparationInput,question,demoPreparation(preparationInput).requirements)};
    expect(savePreparationSchema.safeParse({questions:[item,item]}).success).toBe(false);
    expect(savePreparationSchema.safeParse({questions:[{...item,draft:{...item.draft,jdRequirement:undefined}}]}).success).toBe(false);
  });
  it('exports edited question text and answer notes with original JD requirements',()=>{
    const result:PreparationResult={...demoPreparation(preparationInput),modelMode:'demo',model:'rules-demo-v1'};
    const drafts=result.questions.map(question=>preparationBankDraft(preparationInput,question,result.requirements));
    if(!drafts[0])throw new Error('Missing draft');drafts[0].content='编辑过的题面需要保留到导出的备题单中。';drafts[0].expectedAnswer='编辑后的回答要点';
    const markdown=preparationMarkdown(preparationInput,result,drafts);
    expect(markdown).toContain(drafts[0].content);expect(markdown).toContain(drafts[0].expectedAnswer);expect(markdown).toContain('规则演示');expect(markdown).toContain('优先考虑');
  });
  it('never silently falls back when the default model is disabled',async()=>{
    await expect(generatePreparation({...agentConfig(),MODEL_MODE:'disabled'},preparationInput,new AbortController().signal)).rejects.toThrow('先启用模型');
  });
});
