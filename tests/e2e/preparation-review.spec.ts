import { test, expect } from '@playwright/test';
import { bankListSchema } from '../../packages/contracts/src/bank';

const headers={Origin:'http://localhost:5173'};
test.use({actionTimeout:10000});
test('priority corrections and unfinished edits survive refresh and remain attached to saved bank questions',async({page})=>{
  await page.goto('/');await page.getByRole('tab',{name:'JD 备题',exact:true}).click();
  const quote='熟悉 React 和 TypeScript，能够解释实际项目中的状态管理与验证。';
  await page.getByRole('textbox',{name:'备题岗位',exact:true}).fill('前端工程师');await page.getByRole('textbox',{name:'备题 JD',exact:true}).fill(quote);
  await page.getByLabel('预生成题量',{exact:true}).fill('3');await page.getByRole('button',{name:'根据 JD 生成题单',exact:true}).click();
  await expect(page.locator('.preparation-card')).toHaveCount(3);
  await page.getByRole('combobox',{name:'要求 1 分类',exact:true}).click();await page.getByRole('option',{name:'加分项',exact:true}).click();
  await page.getByRole('textbox',{name:'题目 1 题面',exact:true}).fill('');
  await page.reload();await page.getByRole('tab',{name:'JD 备题',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'题目 1 题面',exact:true})).toHaveValue('');
  await expect(page.locator('.requirement-list article').first().getByRole('heading')).toContainText('加分项');
  await expect(page.getByRole('button',{name:'保存所选到题库',exact:true})).toBeDisabled();
  await page.getByRole('textbox',{name:'题目 1 题面',exact:true}).fill('请结合实际项目解释状态管理的设计取舍，并说明验证方法。');
  await page.getByRole('button',{name:'清空选择',exact:true}).click();await page.getByRole('checkbox',{name:'选择备题 1',exact:true}).check();
  await page.getByRole('button',{name:'保存所选到题库',exact:true}).click();await expect(page.getByRole('status')).toContainText('所选 1 道题已保存');
  const saved=bankListSchema.parse(await(await page.request.get('/api/v1/question-bank')).json()).find(question=>question.editable);
  if(!saved)throw new Error('Missing saved JD question');
  try{
    expect(saved.jdRequirement).toEqual({competency:'岗位要求 1',priority:'preferred',quote});
    await page.getByRole('tab',{name:'题库管理',exact:true}).click();const row=page.locator('.bank-card').filter({hasText:saved.title});
    await row.getByText('查看题面',{exact:true}).click();await expect(row).toContainText('JD 依据 · 加分项');await expect(row).toContainText(quote);
    await row.getByRole('button',{name:`编辑 ${saved.title}`,exact:true}).click();
    await page.getByLabel('题目标题',{exact:true}).fill('保留 JD 依据的修改题');await page.getByRole('button',{name:'保存题目',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('题目已更新');
    const updated=bankListSchema.parse(await(await page.request.get('/api/v1/question-bank')).json()).find(question=>question.id===saved.id);
    expect(updated?.jdRequirement).toEqual(saved.jdRequirement);
  }finally{await page.request.delete(`/api/v1/question-bank/${saved.id}`,{headers});}
});

test('explicit intake handoff replaces an older preparation form and preserves current planning choices',async({page})=>{
  await page.goto('/');await page.getByRole('tab',{name:'JD 备题',exact:true}).click();
  await page.getByRole('textbox',{name:'备题岗位',exact:true}).fill('旧前端岗位');
  await page.getByRole('textbox',{name:'备题 JD',exact:true}).fill('旧岗位负责 React 页面开发，理解组件状态与自动化测试。');
  await page.getByLabel('预生成题量',{exact:true}).fill('3');await page.getByRole('button',{name:'根据 JD 生成题单',exact:true}).click();
  await expect(page.locator('.preparation-card')).toHaveCount(3);
  await page.getByRole('tab',{name:'面试练习',exact:true}).click();await page.getByRole('button',{name:'填入示例',exact:true}).click();
  const currentJd='负责团队招聘协作、资源取舍与风险沟通，能够用实际行动说明项目目标与结果。';
  await page.getByRole('textbox',{name:'目标岗位',exact:true}).fill('新项目负责人');await page.getByRole('textbox',{name:'岗位描述 / JD',exact:true}).fill(currentJd);
  for(const [name,label] of [['候选人级别','社招'],['面试轮次','HR 面'],['岗位类型','非技术岗'],['岗位方向','后端']]){
    await page.getByRole('combobox',{name,exact:true}).click();await page.getByRole('option',{name:label,exact:true}).click();
  }
  await page.getByRole('button',{name:'根据 JD 提前备题',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'备题岗位',exact:true})).toHaveValue('新项目负责人');await expect(page.getByRole('textbox',{name:'备题 JD',exact:true})).toHaveValue(currentJd);
  const form=page.locator('.preparation-form');
  for(const label of ['社招','HR 面','非技术岗','后端'])await expect(form.getByText(label,{exact:true})).toBeVisible();
  await expect(page.getByRole('note').filter({hasText:'输入已修改'})).toBeVisible();
  await page.getByRole('button',{name:'重新生成题单',exact:true}).click();await expect(page.locator('.preparation-result h2')).toContainText('新项目负责人');
  expect((await page.locator('.preparation-card-heading').allTextContents()).every(value=>value.includes('综合素质')&&value.includes('深入'))).toBe(true);
  await page.getByRole('textbox',{name:'备题重点',exact:true}).fill('保留独立修改的备题重点');
  await page.getByRole('tab',{name:'面试练习',exact:true}).click();await page.getByRole('tab',{name:'JD 备题',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'备题重点',exact:true})).toHaveValue('保留独立修改的备题重点');
});
