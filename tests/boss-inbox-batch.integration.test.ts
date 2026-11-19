import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {bossInboxJobSchema} from '../packages/contracts/src/boss-inbox';
function fixture(scenario:string){
  return `<body data-account-id="fixture-account"><ul><li class="nav-figure"><span class="label-text">Fixture account</span></li></ul><div class="chat-user" data-v-00ec7992><ul class="label-list"><li class="selected"><span class="label-name">全部</span></li>${scenario==='more'?'<li><span class="label-name more">更多</span><ul class="more-label" style="display:none"><li><span>有交换</span></li></ul></li>':'<li><span class="label-name">有交换</span></li>'}</ul><div class="user-list-content"></div></div><div id="chat"></div><script>
  const scenario=${JSON.stringify(scenario)},host=document.querySelector('.chat-user'),list=document.querySelector('.user-list-content');
  const rows=Array.from({length:scenario==='short'?4:12},(_,i)=>({uniqueId:scenario+'-'+(i+1),encryptJobId:'job-'+(i+1)}));
  if(document.querySelector('.label-name.more'))document.querySelector('.label-name.more').onclick=()=>{document.querySelector('.more-label').style.display='block';};
  const runtime={$options:{name:'boss-list'},fullList:[],loading$:0,curLabel$:{name:'全部'}};host.__vue__=runtime;
  function select(row,i){document.body.setAttribute('data-clicks',JSON.stringify([...JSON.parse(document.body.getAttribute('data-clicks')||'[]'),row.uniqueId]));document.body.setAttribute('data-selected',row.uniqueId);document.querySelector('#chat').innerHTML='<div data-conversation-id="'+row.uniqueId+'" data-job-id="'+row.encryptJobId+'"><span data-company-name>合成公司 '+(i+1)+'</span><span data-job-title>'+scenario+' 岗位 '+(i+1)+'</span><div class="conversation-jd">熟悉 React 与 NestJS 开发、自动化测试与系统架构设计，负责高质量接口。</div><div class="chat-message-list">'+(scenario==='short'&&i===3?'':'<div data-message-id="m1" data-direction="recruiter">准备架构设计和验证方法。</div><div class="message-item item-system" data-mid="system-1"><div class="hyper-link text">'+((scenario==='pending'&&i===2||scenario==='resume'&&i===1)?'请求交换简历':scenario==='full'&&i<3?['你已向对方发送附件简历','附件简历请求已发送','对方可以查看您的附件简历'][i]:'已交换简历')+'</div></div>')+'</div>'+(scenario==='restricted'&&i===2?'<div class="captcha">人工验证</div>':'')+'</div>';}
  function renderRows(){
    const virtual=scenario==='pending';
    if(virtual)list.style.cssText='height:200px;overflow-y:auto';
    const content=document.createElement('div');
    if(virtual)content.style.cssText='position:relative;height:'+(rows.length*40)+'px';
    list.replaceChildren(content);
    const render=()=>{
      const first=virtual?Math.floor(list.scrollTop/40):0;
      content.replaceChildren();
      rows.slice(first,first+(virtual?5:rows.length)).forEach((row,offset)=>{
        const i=first+offset,wrapper=document.createElement('div');
        wrapper.className='friend-content-warp';
        if(virtual)wrapper.style.cssText='position:absolute;height:40px;top:'+(i*40)+'px';
        wrapper.innerHTML='<div class="friend-content" data-v-3d67f5a8>招聘方 '+(i+1)+'</div>';
        wrapper.__vue__={$options:{name:'boss-item'},boss:row};
        wrapper.firstChild.onclick=()=>select(row,i);
        content.appendChild(wrapper);
      });
    };
    if(virtual)list.onscroll=render;
    render();
  }
  (document.querySelector('.more-label li')??document.querySelectorAll('.label-list li')[1]).onclick=function(event){event.stopPropagation();document.querySelectorAll('.label-list li').forEach(node=>node.classList.remove('selected'));this.classList.add('selected');if(document.querySelector('.more-label'))document.querySelector('.more-label').style.display='none';if(document.querySelector('.label-name.more')){document.querySelector('.label-name.more').textContent='有交换';document.querySelector('.label-name.more').parentElement.classList.add('selected');}runtime.curLabel$={name:'有交换'};runtime.loading$=1;list.innerHTML='';setTimeout(()=>{runtime.fullList=rows;runtime.loading$=0;renderRows();},40);};
  Object.defineProperty(document,'cookie',{get(){throw Error('COOKIE_READ_FORBIDDEN')}});
  </script></body>`;
}
it.skipIf(process.env.RUN_INTEGRATION!=='1')('fills ten from the loaded list, persists skips and stops on cancellation and verification',async()=>{
  const requests:string[]=[];
  const server=createServer((req,res)=>{requests.push(req.method??'');const url=new URL(req.url??'/',`http://${req.headers.host}`);res.setHeader('content-type','text/html; charset=utf-8');res.end(fixture(url.searchParams.get('scenario')??'full'));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('NO_SERVER');
  const directory=await mkdtemp(join(tmpdir(),'inbox-batch-'));
  try{
    const output=await promisify(execFile)(process.execPath,['--import','tsx',fileURLToPath(new URL('./files/boss-inbox-batch-probe.ts',import.meta.url)),`http://127.0.0.1:${address.port}`,directory],{timeout:65000});
    const results=z.array(z.object({scenario:z.string(),interrupted:bossInboxJobSchema.nullable(),clicks:z.array(z.string()),job:bossInboxJobSchema,count:z.number(),revisions:z.array(z.number()),replayCount:z.number().nullable(),selected:z.string().nullable()})).parse(JSON.parse(output.stdout));
    const get=(scenario:string)=>{const result=results.find(row=>row.scenario===scenario);if(!result)throw Error('MISSING_SCENARIO');return result;};
    expect(get('full').job,get('full').job.failure??'').toMatchObject({status:'completed',progress:{total:10,completed:10}});expect(get('full').count).toBe(10);expect(get('full').replayCount).toBe(10);expect(get('full').revisions).toEqual(Array(10).fill(1));expect(get('full').selected).toBe('full-10');
    expect(get('short').job).toMatchObject({status:'completed',progress:{total:4,completed:3,skipped:1}});expect(get('short').count).toBe(3);
    expect(get('more').job,get('more').job.failure??'').toMatchObject({status:'completed',progress:{total:10,completed:10}});
    expect(get('resume').interrupted).toMatchObject({status:'failed',progress:{total:10,completed:1,skipped:1}});expect(get('resume').job).toMatchObject({status:'completed',progress:{total:10,completed:10,skipped:1}});expect(get('resume').count).toBe(10);expect(get('resume').clicks.filter(key=>key==='resume-1'||key==='resume-2')).toEqual(['resume-1','resume-2']);
    expect(get('pending').job,get('pending').job.failure??'').toMatchObject({status:'completed',progress:{total:10,completed:10,skipped:1}});expect(get('pending').count).toBe(10);expect(get('pending').clicks).toEqual(Array.from({length:11},(_,i)=>'pending-'+(i+1)));expect(get('pending').selected).toBe('pending-11');
    expect(get('cancel').job).toMatchObject({status:'cancelled',progress:{total:10,completed:1}});expect(get('cancel').count).toBe(1);expect(get('cancel').selected).toBe('cancel-1');
    expect(get('restricted').job).toMatchObject({status:'failed',progress:{total:10,completed:2}});expect(get('restricted').count).toBe(2);expect(get('restricted').selected).toBe('restricted-3');expect(requests.every(method=>method==='GET')).toBe(true);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
},75000);
