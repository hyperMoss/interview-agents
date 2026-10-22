import { z } from 'zod';

export const roleFamilySchema=z.enum(['frontend','backend','fullstack','data','embedded','qa','general']);
export const difficultySchema=z.enum(['easy','medium','hard']);
export const stageSchema=z.enum(['intro','qa','coding','reverse']);
export const bankModeSchema=z.enum(['strict','mixed','adaptive']);
export const jdRequirementSchema=z.strictObject({competency:z.string().trim().min(2).max(80),priority:z.enum(['required','preferred']),quote:z.string().trim().min(2).max(600)});
export const bankDraftSchema=z.strictObject({
  title:z.string().trim().min(2).max(200),content:z.string().trim().min(10).max(14000),
  category:z.enum(['intro','technical','behavioral','coding','reverse']),difficulty:difficultySchema,
  roleFamilies:z.array(roleFamilySchema).min(1).max(7),tags:z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  expectedAnswer:z.string().trim().max(8000).default(''),
  jdRequirement:jdRequirementSchema.optional(),
});
export const bankQuestionSchema=bankDraftSchema.extend({id:z.uuid(),source:z.enum(['custom','builtin','leetcode']),sourceUrl:z.url().nullable(),editable:z.boolean(),createdAt:z.iso.datetime(),revision:z.number().int().nonnegative()});
export type BankQuestion=z.infer<typeof bankQuestionSchema>;
export type BankDraft=z.infer<typeof bankDraftSchema>;
export const bankListSchema=z.array(bankQuestionSchema).max(500);
export const bankCreateSchema=z.strictObject({requestId:z.uuid(),draft:bankDraftSchema});
export const bankUpdateSchema=z.strictObject({revision:z.number().int().nonnegative(),draft:bankDraftSchema});
export const leetcodeImportSchema=z.strictObject({url:z.string().trim().max(300)}).superRefine((value,ctx)=>{
  try{const url=new URL(value.url);if(url.protocol!=='https:'||!['leetcode.com','leetcode.cn'].includes(url.hostname)||url.search||url.hash||url.username||url.password||!/^\/problems\/[a-z0-9-]+\/?$/.test(url.pathname))throw new Error();}
  catch{ctx.addIssue({code:'custom',message:'填写 https://leetcode.cn/problems/题目名/ 或 leetcode.com 的公开题目链接。'});}
});
export const leetcodeBatchSchema=z.strictObject({questions:z.array(bankDraftSchema.extend({slug:z.string().regex(/^[a-z0-9-]{1,100}$/),region:z.enum(['cn','com']).default('cn')})).min(1).max(100)});
export const bankImportResultSchema=z.strictObject({imported:z.number().int().nonnegative(),skipped:z.number().int().nonnegative()});
