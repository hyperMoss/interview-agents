import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,it,expect} from 'vitest';
import {BossBrowser,liveBossProfile} from '../apps/worker/src/boss-browser';
const suite=process.env.RUN_INTEGRATION==='1'?describe:describe.skip;
suite('authenticated home navigation',()=>{
  it('does not treat an unrelated login class as a login form and exposes no account identity from a display name',async()=>{
    const server=createServer((_req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end('<html><body><header class="login-area"><ul><li class="nav-figure"><span class="label-text">Synthetic candidate</span><img alt="avatar" width="20" height="20"></li></ul><a>消息</a><a>简历</a></header><input name="query" placeholder="搜索职位、公司"><button>搜索</button><section class="sign-form" hidden>登录</section></body></html>');});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Missing fixture address');
    const directory=await mkdtemp(join(tmpdir(),'boss-login-detection-'));const origin=`http://127.0.0.1:${address.port}`;
    try{const result=await promisify(execFile)(process.execPath,['--import','tsx',fileURLToPath(new URL('./files/boss-controls-probe.ts',import.meta.url)),origin,directory],{timeout:45000});const output=JSON.parse(result.stdout);expect(output.state).toBe('ready');expect(output.accountObserved).toBe(false);expect(output.mutationsAllowed).toBe(false);expect(output.evidence.authenticatedNavigation).toHaveLength(2);expect(output.evidence.loginForms).toEqual([]);expect(output.evidence.inputs).toEqual(expect.arrayContaining([expect.objectContaining({name:'query',placeholder:'搜索职位、公司'})]));expect(result.stdout).not.toContain('Synthetic candidate');}
    finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(directory,{recursive:true,force:true});}
  },60000);
});
