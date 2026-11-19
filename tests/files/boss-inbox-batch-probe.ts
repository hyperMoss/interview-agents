import 'reflect-metadata';
import {join} from 'node:path';
import {migrateSqlite} from '../../packages/database/src/migrate';
import {BossInboxService} from '../../apps/api/src/boss-inbox';
import {CareerWorker} from '../../apps/worker/src/career-worker';
import {BossBrowser,worksBossProfile} from '../../apps/worker/src/boss-browser';
import {readWorkerConfig} from '../../packages/config/src/index';
import {chromium} from 'patchright';
const [origin,directory]=process.argv.slice(2);
if(!origin||!directory||new URL(origin).hostname!=='127.0.0.1')throw Error('FIXTURE_ONLY');
// Keep real Chrome/DOM/Worker coverage without accepting clicks from the user's desktop.
const launch=chromium.launchPersistentContext.bind(chromium);
chromium.launchPersistentContext=(profile,options)=>launch(profile,{...options,headless:true,viewport:{width:1280,height:900}});
const database=`file:${join(directory,'app.sqlite')}`;
await migrateSqlite(database,'app');
const service=new BossInboxService({DATABASE_URL:database,BOSS_AUTOMATION:'manual'});
const browser=new BossBrowser({engine:'patchright',origin,profile:worksBossProfile(origin),profileDirectory:join(directory,'profile'),moliExecutable:'moli',headedFallback:true});
const worker=new CareerWorker(readWorkerConfig({NODE_ENV:'test',DATABASE_URL:database,AGENT_URL:'http://127.0.0.1:1',REDIS_URL:'',INTERNAL_SERVICE_TOKEN:'local-fixture-internal-key-123456789',CAREER_LOCAL_DATA_DIR:directory,BOSS_AUTOMATION:'manual',BOSS_SITE_ORIGIN:origin,BOSS_BROWSER_ENGINE:'patchright'}),{browserFor:()=>browser});
const owner=crypto.randomUUID();
try{
  await browser.openSession();const page=await browser.ensureBrowser();
  const results=[];
  const capture=browser.captureFirstConversations.bind(browser);
  for(const scenario of ['full','short','more','resume','pending','cancel','restricted']){
    await page.goto(`${origin}/web/geek/chat?scenario=${scenario}`);
    await service.career.writeSession(owner,{state:'ready',humanWindow:'open',engine:'patchright'});
    const job=await service.sync(owner,crypto.randomUUID(),'first_ten');
    browser.captureFirstConversations=async(guard,record,plan)=>capture(guard,async(next,snapshot)=>{
      await record(next,snapshot);
      if(scenario==='cancel'&&snapshot)await service.cancel(owner,job.id);
      if(scenario==='resume'&&next.nextIndex===2)throw Error('SYNTHETIC_INTERRUPTION');
    },plan);
    await worker.tick();
    let interrupted=null;
    if(scenario==='resume'){
      interrupted=await service.job(owner,job.id);
      await service.database.pool.query("UPDATE app_career_work SET status='queued',failure=NULL WHERE id=$1",[job.id]);
      browser.captureFirstConversations=capture;await worker.tick();
    }
    const rows=[];
    for(const summary of await service.store.list(owner)){
      const row=await service.store.get(owner,summary.id);
      if(row?.snapshot.title.startsWith(scenario+' '))rows.push(row);
    }
    const first=await service.job(owner,job.id);
    let replay=null;
    if(scenario==='full'){
      await service.sync(owner,crypto.randomUUID(),'first_ten');await worker.tick();
      replay=await service.store.list(owner);
    }
    results.push({scenario,interrupted,clicks:await page.locator('body').evaluate(body=>JSON.parse(body.getAttribute('data-clicks')??'[]')),job:first,count:rows.length,revisions:rows.map(row=>row.revision),replayCount:replay?.length??null,selected:await page.locator('body').evaluate(body=>body.getAttribute('data-selected'))});
  }
  process.stdout.write(JSON.stringify(results));
}finally{await worker.close();await service.onModuleDestroy();}
