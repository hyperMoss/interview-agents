import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { startProviderFixture } from '../provider-fixture';
import { answer } from '../fixtures';

const headers={Origin:'http://localhost:5173'};
const jd='熟悉 React 与 TypeScript，负责复杂页面状态与性能优化。优先考虑熟悉自动化测试的候选人。';
test.setTimeout(90000);
test.use({actionTimeout:10000});
async function openPreparation(page:Page){
  await page.getByRole('tab',{name:'JD 备题',exact:true}).click();
  await page.getByLabel('备题岗位',{exact:true}).fill('前端工程师');
  await page.getByRole('textbox',{name:'备题 JD',exact:true}).fill(jd);
  await page.getByLabel('预生成题量',{exact:true}).fill('3');
}
test('JD-only preview, edits, selected idempotent save, refresh, export and strict practice',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'填入示例',exact:true}).click();
  const resume='固定测试经历：负责前端页面和接口，使用测试验证请求竞争与页面状态的一致性。';
  await page.getByRole('textbox',{name:'简历与项目经历',exact:true}).fill(resume);
  await page.getByRole('button',{name:'根据 JD 提前备题',exact:true}).click();
  await page.getByLabel('备题岗位',{exact:true}).fill('前端工程师');await page.getByRole('textbox',{name:'备题 JD',exact:true}).fill(jd);await page.getByLabel('预生成题量',{exact:true}).fill('3');
  await page.getByRole('button',{name:'根据 JD 生成题单',exact:true}).click();
  await expect(page.locator('.preparation-card')).toHaveCount(3);await expect(page.getByLabel('JD 能力要求')).toContainText('加分项');
  const edited='请结合你亲自实现的页面，说明如何防止旧请求覆盖新请求，并给出验证步骤。';
  await page.getByRole('textbox',{name:'题目 1 题面',exact:true}).fill(edited);
  await page.locator('.preparation-card').first().getByText('回答要点与追问，可编辑',{exact:true}).click();
  await page.getByRole('textbox',{name:'题目 1 回答要点',exact:true}).fill('先定义有效请求，再验证乱序响应不会覆盖当前结果。');
  await page.getByRole('checkbox',{name:'选择备题 2',exact:true}).uncheck();await page.getByRole('checkbox',{name:'选择备题 3',exact:true}).uncheck();
  for(let index=0;index<2;index++){
    await page.getByRole('button',{name:'保存所选到题库',exact:true}).click();
    await expect(page.getByRole('status')).toContainText('所选 1 道题已保存到题库');
  }
  const bank=await (await page.request.get('/api/v1/question-bank')).json();
  const saved=bank.filter((question:{content:string})=>question.content===edited);expect(saved).toHaveLength(1);
  await page.reload();await page.getByRole('tab',{name:'JD 备题',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'题目 1 题面',exact:true})).toHaveValue(edited);
  await expect(page.getByRole('textbox',{name:'题目 1 题面',exact:true})).toHaveAttribute('readonly','');
  await expect(page.getByRole('checkbox',{name:'选择备题 2',exact:true})).not.toBeChecked();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出备题单',exact:true}).click();
  const path=await (await download).path();if(!path)throw new Error('Missing export');const markdown=await readFile(path,'utf8');expect(markdown).toContain(edited);expect(markdown).toContain('先定义有效请求');expect(markdown).toContain('优先考虑');
  await page.screenshot({path:'docs/evidence/screenshots/jd-preparation-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'docs/evidence/screenshots/jd-preparation-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:'保存并带入练习',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'简历与项目经历',exact:true})).toHaveValue(resume);await expect(page.getByRole('textbox',{name:'岗位描述 / JD',exact:true})).toHaveValue(jd);
  await page.getByRole('button',{name:'开始练习',exact:true}).click();await expect(page.getByLabel('你的回答',{exact:true})).toBeVisible({timeout:20000});
  await page.getByLabel('你的回答',{exact:true}).fill(answer);await page.getByRole('button',{name:'提交回答',exact:true}).click();
  await expect(page.locator('.question-panel h2')).toHaveText(edited,{timeout:20000});
  await page.getByRole('button',{name:'删除此练习及简历资料',exact:true}).click();
  for(const question of saved)await page.request.delete(`/api/v1/question-bank/${question.id}`,{headers});
});
test('custom model failures preserve the previous JD draft and HR preparation stays behavioral',async({page})=>{
  const provider=await startProviderFixture();
  try{
    await page.goto('/');await page.request.get('/api/v1/identity');
    const enabled=await page.request.post('/api/v1/models/settings',{headers,data:{baseUrl:provider.baseUrl,model:'coach-alpha',apiKey:'fixture-alpha-key',remember:false,timeoutMs:10000}});expect(enabled.ok()).toBe(true);
    await page.reload();await openPreparation(page);
    const round=page.getByRole('combobox',{name:/备题轮次/});await round.click();await round.press('ArrowDown');await round.press('ArrowDown');await round.press('Enter');
    await page.getByRole('button',{name:'根据 JD 生成题单',exact:true}).click();await expect(page.locator('.preparation-card')).toHaveCount(3);
    await expect(page.locator('.preparation-card-heading')).toHaveText([/综合素质/,/综合素质/,/综合素质/]);
    await expect(page.locator('.preparation-result .session-model')).toContainText('coach-alpha');
    const text=await page.getByRole('textbox',{name:'题目 1 题面',exact:true}).inputValue();
    provider.state.badPreparationEvidence=true;
    await page.getByRole('button',{name:'重新生成题单',exact:true}).click();await expect(page.getByRole('alert')).toContainText('备题生成失败',{timeout:20000});
    await expect(page.getByRole('textbox',{name:'题目 1 题面',exact:true})).toHaveValue(text);await expect(page.getByRole('textbox',{name:'备题 JD',exact:true})).toHaveValue(jd);
    const storage=await page.evaluate(()=>JSON.stringify({...sessionStorage}));expect(storage).not.toContain('fixture-alpha-key');
  }finally{await page.request.delete('/api/v1/models/settings',{headers});await provider.close();}
});
test('the HTTP batch boundary accepts valid large Chinese notes and rejects duplicate save keys',async({page})=>{
  await page.goto('/');await page.request.get('/api/v1/identity');
  const questions=Array.from({length:12},(_,index)=>({requestId:crypto.randomUUID(),draft:{title:`长备题 ${index}`,content:'请结合实际项目解释页面状态管理与异步请求竞争的验证方法。',category:'technical',difficulty:'medium',roleFamilies:['frontend'],tags:['JD备题'],expectedAnswer:'验证与证据'.repeat(1500),jdRequirement:{competency:'状态管理',priority:'required',quote:'能够解释实际项目中的状态管理与验证。'}}}));
  expect(Buffer.byteLength(JSON.stringify({questions}))).toBeGreaterThan(128*1024);
  const response=await page.request.post('/api/v1/question-bank/import/preparation',{headers,data:{questions}});expect(response.ok()).toBe(true);
  try{
    const repeat=await page.request.post('/api/v1/question-bank/import/preparation',{headers,data:{questions}});expect(repeat.ok()).toBe(true);
    expect((await repeat.json()).map((question:{id:string})=>question.id)).toEqual(questions.map(question=>question.requestId));
    const duplicate=await page.request.post('/api/v1/question-bank/import/preparation',{headers,data:{questions:[questions[0],questions[0]]}});expect(duplicate.status()).toBe(400);
    const first=questions[0];if(!first)throw new Error('Missing question');
    const noEvidence=await page.request.post('/api/v1/question-bank/import/preparation',{headers,data:{questions:[{...first,draft:{...first.draft,jdRequirement:undefined}}]}});expect(noEvidence.status()).toBe(400);
  }finally{for(const question of questions)await page.request.delete(`/api/v1/question-bank/${question.requestId}`,{headers});}
});
