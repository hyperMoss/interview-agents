import { test,expect,type Page } from '@playwright/test';
import { input,answer } from '../fixtures';
import { startProviderFixture } from '../provider-fixture';
test('browser: intake → interview → report → reload/history → deletion, with mobile layout',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'准备练习资料'})).toBeVisible();
  await page.getByRole('button',{name:'填入示例'}).click();
  await configureShortStrict(page);
  await page.screenshot({path:'docs/evidence/screenshots/intake-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'开始练习',exact:true}).click();
  await answerUntilReport(page);
  await expect(page.getByRole('heading',{name:'练习完成，可以开始复盘了。'})).toBeVisible({timeout:20000});
  await expect(page.getByLabel('练习报告')).toContainText('规则演示');
  await page.screenshot({path:'docs/evidence/screenshots/report-desktop.png',fullPage:true});
  await page.reload();await expect(page.getByRole('heading',{name:'练习完成，可以开始复盘了。'})).toBeVisible();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出本次记录'}).click();expect((await download).suggestedFilename()).toMatch(/^interview-/);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));await expect(page.locator('.sidebar')).toHaveCSS('position','static');await page.screenshot({path:'docs/evidence/screenshots/report-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'删除此练习及简历资料'}).click();
  await expect(page.getByRole('heading',{name:'准备练习资料'})).toBeVisible();expect(errors).toEqual([]);
});
test('HTTP boundary: Origin, signed cookie, cross browser ownership and cancellation',async({browser})=>{
  const a=await browser.newContext();const b=await browser.newContext();
  const created=await a.request.post('http://localhost:3000/api/v1/interviews',{headers:{Origin:'http://localhost:5173'},data:{input}});expect(created.status()).toBe(201);
  const session: {id:string}=await created.json();
  expect((await b.request.get(`http://localhost:3000/api/v1/interviews/${session.id}`,{headers:{'x-owner-id':'spoofed'}})).status()).toBe(404);
  expect((await a.request.post(`http://localhost:3000/api/v1/interviews/${session.id}/cancel`,{headers:{Origin:'https://attacker.invalid'},data:{}})).status()).toBe(403);
  const cancelled=await a.request.post(`http://localhost:3000/api/v1/interviews/${session.id}/cancel`,{headers:{Origin:'http://localhost:5173'},data:{}});expect((await cancelled.json()).status).toBe('cancelled');
  await a.request.delete(`http://localhost:3000/api/v1/interviews/${session.id}`,{headers:{Origin:'http://localhost:5173'}});await a.close();await b.close();
});
test('model settings actually enable live interview, export excludes keys, clear restores defaults',async({page})=>{
  const provider=await startProviderFixture();
  try{
    await page.goto('/');await page.getByRole('button',{name:'模型设置',exact:true}).click();
    const panel=page.getByRole('dialog',{name:'模型设置'});
    await panel.getByLabel('API 根地址').fill(provider.baseUrl);await panel.getByLabel('API Key',{exact:true}).fill('fixture-alpha-key');
    await panel.getByRole('button',{name:'读取模型列表'}).click();await expect(panel.getByRole('status')).toContainText('模型列表已加载');
    await panel.getByLabel('模型名',{exact:true}).fill('coach-alpha');await panel.getByRole('button',{name:'测试连接'}).click();await expect(panel.getByRole('status')).toContainText('连接成功');
    await panel.evaluate(element=>element.scrollTop=0);await page.screenshot({path:'docs/evidence/screenshots/model-settings.png'});
    await page.setViewportSize({width:390,height:844});await panel.evaluate(element=>element.scrollTop=0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'docs/evidence/screenshots/model-settings-mobile.png'});await page.setViewportSize({width:1280,height:720});
    await panel.getByRole('button',{name:'保存并启用'}).click();await expect(panel).not.toBeVisible();await expect(page.locator('.mode-indicator')).toContainText('coach-alpha');
    const storage=await page.evaluate(()=>JSON.stringify({session:{...sessionStorage},local:{...localStorage}}));expect(storage).not.toContain('fixture-alpha-key');
    await page.getByRole('button',{name:'填入示例'}).click();await configureShortStrict(page);await page.getByRole('button',{name:'开始练习',exact:true}).click();
    await answerUntilReport(page);
    await expect(page.getByRole('heading',{name:'练习完成，可以开始复盘了。'})).toBeVisible({timeout:20000});await expect(page.getByLabel('练习报告').getByLabel('三维评估')).toBeVisible();
    expect(provider.calls.some(call=>call.model==='coach-alpha'&&call.authorization==='Bearer fixture-alpha-key')).toBe(true);
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出本次记录'}).click();const file=await download;expect(file.suggestedFilename()).toMatch(/\.md$/);
    const {readFile}=await import('node:fs/promises');const path=await file.path();if(!path)throw new Error('Missing export');const report=await readFile(path,'utf8');expect(report).toContain('coach-alpha');expect(report).toContain('技术能力');expect(report).not.toContain('fixture-alpha-key');
    await page.getByLabel('导出格式').selectOption('json');const jsonDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出本次记录'}).click();const jsonFile=await jsonDownload;expect(jsonFile.suggestedFilename()).toMatch(/\.json$/);const jsonPath=await jsonFile.path();if(!jsonPath)throw new Error('Missing JSON export');expect(await readFile(jsonPath,'utf8')).not.toContain('fixture-alpha-key');
    await page.evaluate(()=>window.scrollTo(0,0));await expect(page.getByRole('navigation',{name:'练习历史'})).toContainText('已完成');
    await page.screenshot({path:'docs/evidence/screenshots/live-report.png',fullPage:true});
    await page.getByRole('button',{name:'用相同资料再练一次'}).click();await expect(page.getByLabel('目标岗位')).toHaveValue('Web 全栈工程师');await expect(page.getByLabel('简历与项目经历')).not.toHaveValue('');await page.getByRole('navigation',{name:'练习历史'}).getByRole('button').click();await expect(page.getByLabel('练习报告')).toBeVisible();
    await page.getByRole('button',{name:'模型设置',exact:true}).click();await page.getByRole('button',{name:'清除连接并恢复默认'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button',{name:'删除此练习及简历资料'}).click();await expect(page.locator('.mode-indicator')).toContainText('规则演示');
  }finally{await provider.close();}
});
test('browser preserves intake/answer drafts and recovers failed generation using saved answer',async({page})=>{
  const provider=await startProviderFixture();
  try{
    await page.goto('/');await page.getByRole('button',{name:'填入示例'}).click();await page.reload();await expect(page.getByLabel('目标岗位')).toHaveValue('Web 全栈工程师');
    await page.getByRole('button',{name:'模型设置',exact:true}).click();const panel=page.getByRole('dialog',{name:'模型设置'});
    await panel.getByLabel('API 根地址').fill(provider.baseUrl);await panel.getByLabel('API Key',{exact:true}).fill('fixture-alpha-key');await panel.getByLabel('模型名',{exact:true}).fill('coach-alpha');await panel.getByRole('button',{name:'保存并启用'}).click();await expect(panel).not.toBeVisible();
    await configureShortStrict(page);await page.getByRole('button',{name:'开始练习',exact:true}).click();await expect(page.getByLabel('你的回答')).toBeVisible({timeout:20000});
    await page.getByLabel('你的回答').fill(answer);await page.reload();await expect(page.getByLabel('你的回答')).toHaveValue(answer);
    provider.state.failure=true;await page.getByRole('button',{name:'提交回答',exact:true}).click();await expect(page.getByRole('button',{name:'用当前模型重试本轮'})).toBeVisible({timeout:25000});await expect(page.locator('.recovery-panel')).toContainText(answer);
    provider.state.failure=false;await page.getByRole('button',{name:'用当前模型重试本轮'}).click();await expect(page.locator('.question-label')).toContainText('第 2 题',{timeout:20000});await expect(page.locator('.feedback')).toHaveCount(1);
    await page.getByRole('button',{name:'取消练习',exact:true}).click();await page.getByRole('button',{name:'模型设置',exact:true}).click();await page.getByRole('button',{name:'清除连接并恢复默认'}).click();await page.getByRole('button',{name:'删除此练习及简历资料'}).click();
  }finally{await provider.close();}
});

async function configureShortStrict(page:Page){
  await page.getByLabel('面试时长（分钟）',{exact:true}).fill('10');
  await page.getByRole('combobox',{name:'题库使用模式',exact:true}).selectOption('strict');
  await expect(page.getByRole('button',{name:'开始练习',exact:true})).toBeEnabled();
}
async function answerUntilReport(page:Page){
  for(let index=0;index<8;index++){
    const report=page.getByRole('heading',{name:'练习完成，可以开始复盘了。'});
    await expect(page.locator('.question-label').or(report)).toBeVisible({timeout:20000});
    if(await report.isVisible())return;
    await expect(page.locator('.question-label')).toContainText(`第 ${index+1} 题`);
    await page.getByLabel('你的回答',{exact:true}).fill(answer);
    await page.getByRole('button',{name:'提交回答',exact:true}).click();
    await expect(page.locator('.question-label').filter({hasText:`第 ${index+1} 题`})).toHaveCount(0,{timeout:20000});
  }
  throw new Error('Strict bank interview failed to finish within its bounded inventory');
}
