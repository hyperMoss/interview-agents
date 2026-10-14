import { test,expect,type Page } from '@playwright/test';
import { answer } from '../fixtures';
import { serveFixture } from '../provider-fixture';
test.setTimeout(90000);test.use({actionTimeout:10000});
const headers={Origin:'http://localhost:5173'};
async function finish(page:Page){
  for(let n=1;n<=8;n++){
    const report=page.getByRole('heading',{name:'练习完成，可以开始复盘了。'});
    await expect(page.locator('.question-label').or(report)).toBeVisible({timeout:20000});
    if(await report.isVisible())return;
    await expect(page.locator('.question-label')).toContainText(`第 ${n} 题`);
    await page.getByLabel('你的回答',{exact:true}).fill(answer);
    await page.getByRole('button',{name:'提交回答',exact:true}).click();
    await expect(page.locator('.question-label').filter({hasText:`第 ${n} 题`})).toHaveCount(0,{timeout:20000});
  }
  throw new Error('Interview failed to finish within the selected strict bank');
}
test('resume preview, owned bank CRUD/import, coding gates and replan preserve the current draft',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'填入示例'}).click();
  await page.getByLabel('上传自己的简历').setInputFiles('tests/files/resume.docx');
  await expect(page.getByLabel('提取文本预览')).toHaveValue(/负责业务接口/);
  const ownResume='真实个人经历。负责 React 页面与后端接口，设计测试用例并使用指标核验改善结果。';
  await page.getByLabel('提取文本预览').fill(ownResume);
  await page.getByRole('button',{name:'使用到简历'}).click();await expect(page.getByLabel('简历与项目经历')).toHaveValue(ownResume);
  await page.getByLabel('上传自己的简历').setInputFiles('tests/files/resume.pdf');await expect(page.getByLabel('提取文本预览')).toHaveValue(/Built APIs/);
  await page.getByRole('button',{name:'放弃提取结果'}).click();await expect(page.getByLabel('简历与项目经历')).toHaveValue(ownResume);
  await page.getByRole('button',{name:'题库管理',exact:true}).click();const panel=page.getByRole('dialog',{name:'题库管理'});
  await panel.getByLabel('题目标题',{exact:true}).fill('私有重试题');await panel.getByLabel('题面',{exact:true}).fill('请结合自己的实际项目，解释如何识别请求竞争并拒绝旧响应。');await panel.getByLabel('题目难度').selectOption('easy');await panel.getByLabel('适用岗位').selectOption('frontend');await panel.getByLabel('标签，以逗号分隔').fill('异步,前端');
  await panel.getByRole('button',{name:'创建题目',exact:true}).click();await expect(panel.getByRole('status')).toContainText('题目已创建');
  const row=panel.locator('.bank-card').filter({hasText:'私有重试题'});
  await row.getByRole('button',{name:'编辑 私有重试题',exact:true}).click();await panel.getByLabel('题目标题',{exact:true}).fill('私有竞争题');await panel.getByRole('button',{name:'保存题目',exact:true}).click();await expect(panel.getByRole('status')).toContainText('题目已更新');
  const batch=JSON.stringify({questions:[{slug:'fixture-array',region:'cn',title:'数组合并练习',content:'编写函数合并两个有序数组，说明重复值、空输入和复杂度。',category:'coding',difficulty:'easy',roleFamilies:['frontend'],tags:['数组'],expectedAnswer:''}]});
  for(let n=0;n<2;n++){await panel.getByLabel('导入 LeetCode JSON 题库').setInputFiles({name:'bank.json',mimeType:'application/json',buffer:Buffer.from(batch)});await expect(panel.getByRole('status')).toContainText(n?'导入 0 题，跳过 1':'导入 1 题，跳过 0');}
  await panel.evaluate(e=>e.scrollTop=0);await page.screenshot({path:'docs/evidence/screenshots/bank-management.png'});
  await panel.getByRole('button',{name:'关闭题库管理'}).click();
  await page.getByLabel('候选人级别').selectOption('intern');await page.getByLabel('岗位方向').selectOption('frontend');await page.getByLabel('题库使用模式').selectOption('strict');await page.getByLabel('安排编程题').check();
  await page.getByLabel('练习模式').selectOption('interviewer');await expect(page.getByLabel('安排编程题')).toBeDisabled();await page.getByLabel('练习模式').selectOption('candidate');
  await page.getByLabel('岗位类型').selectOption('nontechnical');await expect(page.getByLabel('安排编程题')).toBeDisabled();await page.getByLabel('岗位类型').selectOption('technical');
  await page.getByLabel('面试时长（分钟）',{exact:true}).fill('60');await page.getByLabel('面试轮次').selectOption('hr');await expect(page.getByLabel('面试时长（分钟）',{exact:true})).toHaveValue('30');await expect(page.getByLabel('安排编程题')).toBeDisabled();
  await page.getByLabel('面试轮次').selectOption('first');await page.getByLabel('安排编程题').check();
  await page.getByText('选择本次使用的题库',{exact:false}).click();await page.getByLabel('私有竞争题',{exact:false}).check();await page.getByLabel('数组合并练习',{exact:false}).check();
  await expect(page.getByRole('button',{name:'开始练习',exact:true})).toBeEnabled();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'docs/evidence/screenshots/intake-extension.png',fullPage:true});
  await page.getByRole('button',{name:'开始练习',exact:true}).click();await expect(page.locator('.question-label')).toContainText('第 1 题',{timeout:20000});
  const question=await page.locator('.question-panel h2').innerText();await page.getByLabel('你的回答',{exact:true}).fill(answer);
  await page.getByText('调整剩余计划',{exact:true}).click();await page.getByLabel('新的总时长（分钟）').fill('35');await page.getByRole('button',{name:'重新规划',exact:true}).click();await expect(page.getByLabel('面试计划')).toContainText('35 分钟');await expect(page.locator('.question-panel h2')).toHaveText(question);await expect(page.getByLabel('你的回答',{exact:true})).toHaveValue(answer);
  await page.reload();await expect(page.getByLabel('你的回答',{exact:true})).toHaveValue(answer);await finish(page);
  await expect(page.locator('.feedback')).toHaveCount(4);await expect(page.locator('.feedback')).toContainText(['自我介绍','私有竞争题','数组合并练习','你的反问']);
  await page.locator('.feedback').nth(2).locator('summary').click();await expect(page.locator('.feedback').nth(2).getByLabel('三维评估')).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'docs/evidence/screenshots/extension-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'删除此练习及简历资料'}).click();await page.getByRole('button',{name:'题库管理',exact:true}).click();await page.getByRole('dialog').locator('.bank-card').filter({hasText:'私有竞争题'}).getByRole('button',{name:'删除 私有竞争题',exact:true}).click();await expect(page.getByRole('dialog').getByRole('status')).toContainText('已删除');
});
test('confirmed search query and sources survive clearing a connection; failed search supports explicit off retry',async({page})=>{
  const calls:Array<{query:string;authorization:string|null}>=[];let failure=false;
  const fixture=await serveFixture(async request=>{const body=await request.json();calls.push({query:body.query,authorization:request.headers.get('authorization')});return failure?Response.json({error:'unavailable'},{status:503}):Response.json({results:[{title:'公开岗位资料',url:'https://example.test/jobs',content:'公开岗位需要掌握接口设计、状态管理和协作。'}]});});
  try{
    await page.goto('/');await page.getByRole('button',{name:'联网搜索',exact:true}).click();const panel=page.getByRole('dialog',{name:'联网搜索设置'});
    await panel.getByLabel('搜索 API 根地址').fill(fixture.origin);await panel.getByLabel('搜索 API Key').fill('fixture-search-key');await panel.getByRole('button',{name:'测试搜索',exact:true}).click();await expect(panel.getByRole('status')).toContainText('搜索连接成功');await panel.getByRole('button',{name:'保存搜索连接'}).click();await expect(panel).not.toBeVisible();
    await page.getByRole('button',{name:'填入示例'}).click();await page.getByLabel('题库使用模式').selectOption('strict');await page.getByLabel('面试时长（分钟）',{exact:true}).fill('10');await page.getByLabel('本场启用联网搜索').check();await page.getByLabel('确认搜索关键词').fill('确认的全栈公开资料');
    failure=true;await page.getByRole('button',{name:'开始练习',exact:true}).click();await expect(page.getByRole('button',{name:'关闭本场搜索并重试'})).toBeVisible({timeout:25000});await page.getByRole('button',{name:'关闭本场搜索并重试'}).click();await expect(page.getByLabel('你的回答',{exact:true})).toBeVisible({timeout:20000});await page.getByRole('button',{name:'取消练习',exact:true}).click();await page.getByRole('button',{name:'删除此练习及简历资料'}).click();
    failure=false;await page.getByRole('button',{name:'填入示例'}).click();await page.getByRole('combobox',{name:'题库使用模式',exact:true}).selectOption('strict');await page.getByLabel('面试时长（分钟）',{exact:true}).fill('10');await page.getByLabel('本场启用联网搜索').check();await page.getByLabel('确认搜索关键词').fill('确认的全栈公开资料');await page.getByRole('button',{name:'开始练习',exact:true}).click();await expect(page.getByLabel('你的回答',{exact:true})).toBeVisible({timeout:20000});
    await page.getByText('本场联网资料',{exact:false}).click();await expect(page.getByRole('link',{name:'公开岗位资料'})).toHaveAttribute('href','https://example.test/jobs');
    const count=calls.length;await page.getByRole('button',{name:'联网搜索',exact:true}).click();await page.getByRole('button',{name:'清除搜索连接'}).click();await expect(page.getByRole('dialog',{name:'联网搜索设置'})).not.toBeVisible();await finish(page);expect(calls.length).toBe(count);expect(calls.at(-1)).toEqual({query:'确认的全栈公开资料',authorization:'Bearer fixture-search-key'});expect(JSON.stringify(calls)).not.toContain('示例经历');
    const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));expect(storage).not.toContain('fixture-search-key');
    await page.getByLabel('导出格式').selectOption('json');const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出本次记录'}).click();const path=await (await download).path();if(!path)throw new Error('Missing export');const {readFile}=await import('node:fs/promises');const output=await readFile(path,'utf8');expect(output).toContain('example.test/jobs');expect(output).not.toContain('fixture-search-key');
    await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'docs/evidence/screenshots/search-report.png',fullPage:true});await page.getByRole('button',{name:'删除此练习及简历资料'}).click();
  }finally{await fixture.close();await page.request.delete('/api/v1/search/settings',{headers});}
});
test('public LeetCode URL imports through the application and repeated import is idempotent',async({page})=>{
  test.skip(process.env.RUN_PUBLIC_IMPORT!=='1','Explicit opt-in makes one public internet request.');
  await page.goto('/');await page.getByRole('button',{name:'题库管理',exact:true}).click();const panel=page.getByRole('dialog',{name:'题库管理'});
  await panel.getByLabel('LeetCode 公开题目链接').fill('https://leetcode.cn/problems/two-sum/');
  for(let n=0;n<2;n++){await panel.getByRole('button',{name:'导入公开题目',exact:true}).click();await expect(panel.getByRole('status')).toContainText(n?'导入 0 题，跳过 1':'导入 1 题，跳过 0',{timeout:20000});}
  const row=panel.locator('.bank-card').filter({hasText:'两数之和'});await row.getByText('查看题面',{exact:true}).click();await expect(row.getByRole('link',{name:'查看原始来源'})).toHaveAttribute('href','https://leetcode.cn/problems/two-sum/');await row.getByRole('button',{name:'删除 两数之和',exact:true}).click();await expect(panel.getByRole('status')).toContainText('已删除');
});
