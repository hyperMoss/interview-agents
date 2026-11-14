import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {bossConversationViewSchema,bossInboxJobSchema} from '../packages/contracts/src/boss-inbox';
const resultSchema=z.object({status:bossInboxJobSchema,saved:bossConversationViewSchema.nullable(),linked:bossInboxJobSchema,enriched:bossConversationViewSchema.nullable(),replay:bossInboxJobSchema,pending:bossInboxJobSchema,diagnostic:z.object({count:z.number(),privateText:z.boolean(),mode:z.number()}),listCount:z.number(),snapshots:z.number()});
const componentResultSchema=resultSchema.extend({component:bossInboxJobSchema,componentSaved:bossConversationViewSchema.nullable(),selectionRetained:z.boolean(),rejected:z.array(bossInboxJobSchema)});
function componentFixture(url:URL){
  const selected={uniqueId:'component-chat',encryptBossId:'component-boss',encryptJobId:url.searchParams.has('mismatch')?'other-job':'fixture-job'};
  const detail={uniqueId:'component-chat',encryptBossId:'component-boss',encryptJobId:'fixture-job',companyName:'合成组件公司',jobName:'全栈工程师',securityId:'fixture-only-token'};
  return `<div class="chat-container"><div class="chat-conversation" data-v-29cd61d6><div class="user-info"><div class="base-info"><span>${url.searchParams.has('visibleMismatch')?'错误公司':'合成组件公司'}</span><span class="base-title">招聘方</span></div></div><div class="chat-position-content" data-v-d2e04850><span class="position-name">全栈工程师</span></div><div class="chat-message"><ul class="im-list"><li class="message-item item-friend" data-mid="c1"><div class="item-time"><span class="time">昨天 10:00</span></div><div class="text">请准备架构设计。</div></li><li class="message-item item-myself" data-mid="c2"><div class="text"><i class="message-status">已读</i>好的，我会准备。</div></li><li class="message-item item-system" data-mid="c3"><div class="text">${url.searchParams.has('pending')?'附件简历请求已发送':'简历已发送'}</div></li><li class="message-item item-myself" data-mid="c4"><div class="text"><i class="message-status">已读</i><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></div></li></ul></div><button onclick="fetch('/must-not-send',{method:'POST'})">发送</button></div></div><script>const selected=${JSON.stringify(selected)},detail=${JSON.stringify(detail)};document.querySelector('.chat-conversation').__vue__={$options:{name:'conversation-box'},selectedFriend$:selected,$store:{state:{userInfo:{userId:${url.searchParams.has('missingAccount')?'null':'"component-account"'},identity:0}}}};document.querySelector('.chat-position-content').__vue__={$options:{name:'ConversationPositionInfo'},conversation$:detail};Object.defineProperty(document,'cookie',{get(){throw Error('COOKIE_READ_FORBIDDEN')}});</script>`;
}
it.skipIf(process.env.RUN_INTEGRATION!=='1')('syncs the owned existing chat through Worker without sending, rejects pending exchange and preserves identity',async()=>{
  const requests:string[]=[];
  const nav='<ul><li class="nav-figure"><span class="label-text">Synthetic account</span></li></ul>';
  const server=createServer((req,res)=>{const url=new URL(req.url??'/',`http://${req.headers.host}`);requests.push(`${req.method} ${url.pathname}`);res.setHeader('content-type','text/html; charset=utf-8');
    if(url.pathname==='/job_detail/fixture-job.html'){res.end(nav+'<div class="job-banner"><h1>全栈工程师</h1><span class="text-city">广州</span><span class="salary">18-25K</span></div><div class="job-sec-text">完整岗位：负责 React 和 NestJS 全栈开发，自动化测试、系统架构设计和工程质量。</div><div class="sider-company"><div class="company-info"><a>合成测试公司</a></div>自有研发团队</div>');return;}
    if(url.searchParams.has('component')){res.end(nav+componentFixture(url));return;}
    res.end(nav+(url.pathname==='/web/geek/chat'?`<body data-account-id="synthetic-account"><div data-conversation-id="synthetic-chat" data-job-id="fixture-job"><span data-company-name>合成测试公司</span><span data-job-title>全栈工程师</span>${url.searchParams.has('linked')?'<a href="/job_detail/fixture-job.html">岗位详情</a>':'<div class="conversation-jd">负责 React 和 NestJS 全栈开发，编写自动化测试并参与系统架构设计。</div>'}<div class="resume-exchange-status">${url.searchParams.has('pending')?'请求交换简历':'已交换简历'}</div><div class="chat-message-list"><div data-message-id="m1" data-direction="recruiter"><time>10:00</time><div class="message-text">请准备系统架构与项目复盘。</div></div><div data-message-id="m2" data-direction="self"><div class="message-text">好的，我会准备。</div></div></div><button onclick="fetch('/must-not-send',{method:'POST'})">发送消息</button><input type="file" onchange="fetch('/must-not-upload',{method:'POST'})"></div></body>`:''));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Missing server');
  const directory=await mkdtemp(join(tmpdir(),'inbox-browser-'));
  try {
    const output=await promisify(execFile)(process.execPath,['--import','tsx',fileURLToPath(new URL('./files/boss-inbox-probe.ts',import.meta.url)),`http://127.0.0.1:${address.port}`,directory],{timeout:60000});
    const result=componentResultSchema.parse(JSON.parse(output.stdout));
    expect(result.component.status,result.component.failure??'').toBe('completed');
    expect(result.status.status,result.status.failure??'').toBe('completed');expect(result.saved?.snapshot.company).toBe('合成测试公司');expect(result.saved?.snapshot.messages).toHaveLength(2);
    expect(result.saved?.snapshot.jdText).toContain('架构设计');expect(result.replay.status).toBe('completed');expect(result.linked.status,result.linked.failure??'').toBe('completed');expect(result.listCount).toBe(2);expect(result.snapshots).toBe(2);expect(result.enriched?.snapshot.jdText).toContain('完整岗位');expect(requests.filter(path=>path==='GET /job_detail/fixture-job.html')).toHaveLength(2);
    expect(result.component.status,result.component.failure??'').toBe('completed');expect(result.componentSaved?.snapshot.company).toBe('合成组件公司');expect(result.componentSaved?.snapshot.messages.map(message=>message.direction)).toEqual(['recruiter','self','system','self']);expect(result.componentSaved?.snapshot.messages[1]?.text).toBe('好的，我会准备。');expect(result.componentSaved?.snapshot.messages[3]?.text).toBe('[非文本消息，未提取内容]');expect(result.selectionRetained).toBe(true);expect(JSON.stringify(result.componentSaved)).not.toContain('fixture-only-token');expect(result.rejected.every(job=>job.status==='failed')).toBe(true);expect(result.rejected.map(job=>job.failure).join(' ')).toMatch(/岗位标识|账号标识|公司岗位|没有明确/);
    expect(result.pending.status).toBe('failed');expect(result.pending.failure).toContain('没有明确');expect(result.pending.failure).not.toMatch(/locator.evaluate|UtilityScript/);expect(result.diagnostic.count).toBeGreaterThan(0);expect(result.diagnostic.privateText).toBe(false);expect(result.diagnostic.mode).toBe(0o600);expect(requests.every(request=>request.startsWith('GET '))).toBe(true);expect(requests.some(path=>/must-not/.test(path))).toBe(false);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
},75000);
