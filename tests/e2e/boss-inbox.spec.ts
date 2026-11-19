import {test,expect} from '@playwright/test';
import {z} from 'zod';
import {BossInboxStore} from '../../packages/career/src/inbox';
import {openDatabase} from '../../packages/database/src/client';
import {emptyResume} from '../../packages/contracts/src/resume-document';
import {navigateModule} from './ui-helpers';
test('browses snapshots, isolates owners and carries exact JD, resume and selected chat context to preparation',async({page},info)=>{
  const database=z.string().startsWith('file:').parse(info.config.metadata.sqliteTestDatabase);
  await page.goto('/#/home');
  const headers={Origin:new URL(page.url()).origin};
  const resumeId=crypto.randomUUID();
  const created=await page.request.post('/api/v1/resume-drafts',{headers,data:{id:resumeId,label:'合成会话面试简历',document:{...emptyResume,title:'全栈工程师',summary:{items:['合成经历：负责 React 与 NestJS 开发，设计接口并编写自动化测试。']}}}});
  expect(created.ok()).toBe(true);
  const db=openDatabase(database);
  let id='';
  try{
    const row=await db.pool.query('SELECT owner FROM app_resume_drafts WHERE id=$1',[resumeId]);const owner=z.object({owner:z.string()}).parse(row.rows[0]).owner;
    const store=new BossInboxStore(db.pool);
    const saved=await store.save(owner,{accountKey:'fixture-account',conversationKey:'fixture-chat',postingId:'fixture-job',company:'合成会话公司',title:'全栈工程师',jdText:'岗位要求：负责 React 与 NestJS 开发、接口设计、自动化测试和项目架构复盘。',postingUrl:null,exchangeEvidence:'已交换简历',sourceUrl:'https://www.zhipin.com/web/geek/chat',observedAt:new Date().toISOString(),scope:'visible_window',messages:[{sourceId:'m1',direction:'recruiter',text:'请重点准备架构与测试策略。',timeLabel:'10:00'}]});
    if(!saved)throw Error('Missing fixture');id=saved.id;
    await store.save(crypto.randomUUID(),{...saved.snapshot,company:'别人的公司'});
  }finally{await db.pool.end();}
  await navigateModule(page,'已交换简历会话');
  await expect(page.getByText('别人的公司',{exact:true})).not.toBeVisible();
  await page.getByRole('button',{name:'合成会话公司 全栈工程师'}).click();
  await expect(page.getByText('请重点准备架构与测试策略。',{exact:true})).toBeVisible();
  await page.reload();await expect(page).toHaveURL(new RegExp(`boss-conversations/${id}$`));
  await expect(page.getByText('请重点准备架构与测试策略。',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/resumes/boss-inbox-desktop.png',fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('heading',{name:'合成会话公司 · 全栈工程师'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/resumes/boss-inbox-mobile.png',fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('combobox',{name:'会话面试简历',exact:true}).click();await page.getByRole('option',{name:'合成会话面试简历',exact:true}).click();
  await page.getByRole('checkbox',{name:'将下面的沟通摘要作为备题关注点'}).check();
  await page.getByLabel('沟通关注点').fill('招聘方关注：架构与测试策略。');
  await page.getByRole('button',{name:'JD 备题',exact:true}).click();await page.getByRole('button',{name:'确认带入',exact:true}).click();
  await expect(page.locator('#prep-jd')).toHaveValue('岗位要求：负责 React 与 NestJS 开发、接口设计、自动化测试和项目架构复盘。');
  await navigateModule(page,'面试准备');
  await expect(page.locator('#intake-resume')).toHaveValue(/合成经历/);
  await expect(page.locator('#intake-jd')).toHaveValue(/项目架构复盘/);
  await navigateModule(page,'已交换简历会话');await page.getByRole('button',{name:'合成会话公司 全栈工程师'}).click();
  await page.getByRole('combobox',{name:'会话面试简历',exact:true}).click();await page.getByRole('option',{name:'合成会话面试简历',exact:true}).click();
  await page.getByRole('button',{name:'模拟面试',exact:true}).click();await page.getByRole('button',{name:'确认带入',exact:true}).click();
  await expect(page.locator('#intake-resume')).toHaveValue(/合成经历/);
  await expect(page.locator('#intake-jd')).toHaveValue('岗位要求：负责 React 与 NestJS 开发、接口设计、自动化测试和项目架构复盘。');
  await navigateModule(page,'已交换简历会话');await page.getByRole('button',{name:'合成会话公司 全栈工程师'}).click();
  await page.getByRole('button',{name:'删除本地会话',exact:true}).click();await page.getByRole('button',{name:'删除会话',exact:true}).click();
  await expect(page.getByRole('button',{name:'合成会话公司 全栈工程师'})).not.toBeVisible();
});

test('starts the first-ten sync, shows durable progress and preserves it after cancellation',async({page})=>{
  const id=crypto.randomUUID();let status='processing';
  await page.route('**/api/v1/boss-conversations/sync',async route=>{
    expect(route.request().postDataJSON()).toMatchObject({mode:'first_ten'});
    await route.fulfill({json:{id,status,progress:{total:10,completed:2,skipped:1},failure:null}});
  });
  await page.route(`**/api/v1/boss-conversations/sync/${id}`,route=>route.fulfill({json:{id,status,progress:{total:10,completed:2,skipped:1},failure:null}}));
  await page.route(`**/api/v1/boss-conversations/sync/${id}/cancel`,async route=>{status='cancelled';await route.fulfill({json:{id,status,progress:{total:10,completed:2,skipped:1},failure:null}});});
  await page.goto('/#/boss-conversations');
  await page.getByRole('button',{name:'自动同步最多 10 条',exact:true}).click();
  await expect(page.getByText('同步状态：正在读取 · 已同步 2 / 10 条 · 已跳过 1 条',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'同步当前会话',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'取消同步',exact:true}).click();
  await expect(page.getByText('同步状态：已取消 · 已同步 2 / 10 条 · 已跳过 1 条',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByText('同步状态：已取消 · 已同步 2 / 10 条 · 已跳过 1 条',{exact:true})).toBeVisible();
});
