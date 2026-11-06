import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe,it,expect } from 'vitest';
const suite=process.env.RUN_INTEGRATION==='1'?describe:describe.skip;
suite('works-style preview through API, SQLite, Worker and Patchright',()=>{
 for(const scenario of ['normal','restriction','unknown','retry_before_click','custom'] as const)it(scenario==='restriction'?'stops on a verification page without reading details':scenario==='unknown'?'keeps an unconfirmed click unknown and never repeats it':'filters inside the system and clicks only one approved native preset-contact button',async()=>{
  const restricted=scenario==='restriction';
  let contactEnabled=scenario!=='retry_before_click';
  const requests:string[]=[];const queries:string[]=[];
  const server=createServer((req,res)=>{
   const url=new URL(req.url??'/', 'http://127.0.0.1');requests.push(url.pathname);if(url.searchParams.has('query'))queries.push(url.searchParams.get('query')??'');res.setHeader('content-type','text/html; charset=utf-8');
   if(url.pathname==='/fixture-enable-contact'){contactEnabled=true;res.end('ok');return;}
   const nav='<ul><li class="nav-figure"><span class="label-text">Fixture user</span></li></ul><a href="http://'+req.headers.host+'/web/geek/resume">简历</a>';
   if(url.pathname==='/web/geek/jobs'){
    res.end(nav+(restricted?'<div class="captcha">请完成安全验证</div>':'<ul class="rec-job-list">'+['qualified','low-salary'].map(id=>`<li class="job-card-box"><a class="job-name" href="/job_detail/${id}.html">全栈工程师</a><span class="company-name">合成自研公司</span><span class="company-location">广州</span><span class="salary">${id==='low-salary'?'10-15K':'15-25K'}</span></li>`).join('')+'</ul>'));return;
   }
   if(url.pathname==='/web/geek/resume'){res.end(nav+'<span class="attachment-name">Fixture user.pdf</span><button>发送简历</button>');return;}
   if(url.pathname.startsWith('/job_detail/')){res.end(nav+`<div class="job-banner"><div class="company-info"><span class="name">全栈工程师 18-25K</span></div><h1>全栈工程师</h1><button class="op-btn op-btn-chat" ${contactEnabled?'':'disabled'} onclick="${scenario==='unknown'?'':"this.textContent='继续沟通';"}fetch('/fixture-contact')">立即沟通</button><input id="chat-input"><button onclick="fetch('/extra-message')">发送</button><span class="text-city">广州</span><span class="salary">${url.pathname.includes('low')?'10-15K':'15-25K'}</span></div><div class="job-sec-text">负责 React 与 NestJS、C++ 全栈应用开发及自动化测试，公司直招，自有研发团队。</div><div class="sider-company"><div class="company-info"><a>合成自研公司</a></div>公司直招</div>`);return;}
   res.end(nav);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('NO_ADDRESS');
  const directory=await mkdtemp(join(tmpdir(),'works-preview-'));
  try{
   const result=await promisify(execFile)(process.execPath,['--import','tsx',fileURLToPath(new URL('./files/works-preview-probe.ts',import.meta.url)),`http://127.0.0.1:${address.port}`,directory,scenario],{timeout:70000}).catch(error=>{throw new Error(`${error.message}\n${error.stderr??''}\nstdout:${error.stdout??''}`);});
   const output=JSON.parse(result.stdout);expect(output.agentCalls).toBe(0);expect(output.task.mode).toBe('preview');expect(output.task.model).toBeNull();expect(output.task.resumeVersionId).toBeNull();expect(output.task.batches).toEqual([]);
   if(restricted){expect(output.task.state.status).toBe('paused');expect(requests.some(path=>path.startsWith('/job_detail/'))).toBe(false);}
   else{expect(output.task.state).toEqual({status:'active',phase:'review'});expect(output.postings).toHaveLength(2);expect(output.reinspected).toBe(true);expect(output.task.readCount).toBe(2);expect(requests.filter(path=>path==='/web/geek/jobs')).toHaveLength(1);expect(output.postings.every((p:{observed:{company:string}})=>p.observed.company==='合成自研公司')).toBe(true);expect(output.resumeNameMatched).toBe(true);expect(output.contactState).toBe(scenario==='unknown'?'unknown':'confirmed');expect(requests.filter(path=>path==='/fixture-contact')).toHaveLength(1);expect(output.task.shortlistCount).toBe(1);expect(output.task.excludedCount).toBe(1);expect(output.postings.every((p:{match:unknown;greeting:unknown;observed:{nativeFilterEvidence:{method:string}}})=>p.match===null&&p.greeting===null&&p.observed.nativeFilterEvidence.method==='search_url')).toBe(true);}
   expect(requests.some(path=>/chat|apply|upload|send|extra-message/.test(path))).toBe(false);if(scenario==='custom'){expect(output.task.policy.roleTargets).toEqual([]);expect(output.task.policy.customRoleKeywords).toEqual(['C++']);expect(queries).toContain('C++');}
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(directory,{recursive:true,force:true});}
 },90000);
});
