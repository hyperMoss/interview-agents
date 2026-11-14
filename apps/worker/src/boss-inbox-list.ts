import {z} from 'zod';
import type {ManagedPage,EffectGuard} from './boss-browser';

const exchanged=/^(有交换|有交换简历|已交换简历|已换简历|已交换)$/;
const rowSchema=z.strictObject({key:z.string().min(1).max(200),postingId:z.string().regex(/^[A-Za-z0-9_-]{1,200}$/)});
export const bossInboxBatchPlanSchema=z.strictObject({targets:z.array(rowSchema).min(1).max(10),completed:z.number().int().min(0).max(10),accountKey:z.string().min(1).max(200).nullable()}).refine(plan=>plan.completed<=plan.targets.length);
export type BossInboxBatchPlan=z.infer<typeof bossInboxBatchPlanSchema>;
const rowsSelector='[data-inbox-conversation-id], .chat-user .friend-content[data-v-3d67f5a8]';

/** Project only identifiers from already rendered items; never invoke component methods. */
function observeRows(body:HTMLElement){
  return Array.from(body.querySelectorAll('[data-inbox-conversation-id], .chat-user .friend-content[data-v-3d67f5a8]')).map((node,index)=>{
    const runtime:unknown=Reflect.get(node.closest('.friend-content-warp')??node,'__vue__');
    const options:unknown=runtime&&typeof runtime==='object'?Reflect.get(runtime,'$options'):null;
    const boss:unknown=options&&typeof options==='object'&&Reflect.get(options,'name')==='boss-item'?Reflect.get(runtime??{},'boss'):null;
    return {index,key:boss&&typeof boss==='object'?Reflect.get(boss,'uniqueId'):node.getAttribute('data-inbox-conversation-id'),postingId:boss&&typeof boss==='object'?Reflect.get(boss,'encryptJobId'):node.getAttribute('data-job-id')};
  });
}

export async function firstBossInboxRows(page:ManagedPage,guard:EffectGuard,check:()=>Promise<void>){
  const labels=page.locator('.label-list .label-name:not(.more), .label-list .more-label li').visible();
  const find=async()=>{
    const names=await labels.evaluateAll(nodes=>nodes.map(node=>(node.matches('.label-name')?node:node.querySelector('span')??node).textContent?.trim()??''));
    const matches=names.flatMap((name,index)=>exchanged.test(name)?[index]:[]);
    if(matches.length>1)throw Error('已交换简历筛选不唯一，未开始批量同步。');
    return matches[0];
  };
  let index=await find();
  if(index===undefined){
    const more=page.locator('.label-list .label-name.more').visible();
    if(await more.count()===1){await check();if(!await guard.stillAllowed())throw Error('同步已取消。');await more.click();index=await find();}
  }
  if(index===undefined)throw Error('未找到原生已交换简历筛选，请在专用消息页展开该筛选后重试。');
  await check();if(!await guard.stillAllowed())throw Error('同步已取消。');
  await labels.nth(index).click();
  await page.locator('.user-list-content').visible().evaluateAll(nodes=>{
    // The native list is virtualized; return to its first rendered items even if the tab was already selected.
    for(const node of nodes)node.scrollTop=0;
  });
  for(let attempt=0;attempt<50;attempt++){
    await check();if(!await guard.stillAllowed())throw Error('同步已取消。');
    const list=await page.locator('body').evaluate(body=>{
      const selected=body.querySelector('.label-list li.selected');
      const label=selected?.querySelector('.label-name')?.textContent?.trim()??selected?.textContent?.trim();
      if(!label||!/^(有交换|有交换简历|已交换简历|已换简历|已交换)$/.test(label))return null;
      const host=body.querySelector('.chat-user[data-v-00ec7992]');
      if(!host)return body.querySelector('[data-inbox-loading="true"]')?null:undefined;
      const runtime:unknown=Reflect.get(host,'__vue__');
      if(!runtime||typeof runtime!=='object')throw Error('会话列表组件未就绪。');
      const options:unknown=Reflect.get(runtime,'$options'),labelState:unknown=Reflect.get(runtime,'curLabel$');
      if(!options||typeof options!=='object'||Reflect.get(options,'name')!=='boss-list')throw Error('会话列表组件版本未识别。');
      if(!labelState||typeof labelState!=='object'||Reflect.get(labelState,'name')!==label||Reflect.get(runtime,'loading$')===1||Array.isArray(Reflect.get(runtime,'loading$')))return null;
      const rows:unknown=Reflect.get(runtime,'fullList');
      if(!Array.isArray(rows))return null;
      return rows.slice(0,10).map((row:unknown)=>row&&typeof row==='object'?{key:Reflect.get(row,'uniqueId'),postingId:Reflect.get(row,'encryptJobId')}:null);
    },undefined,{},false);
    if(list!==null){
      const projected=list??(await page.locator('body').evaluate(observeRows,undefined,{},false)).slice(0,10).map(({key,postingId})=>({key,postingId}));
      const rows=z.array(rowSchema).max(10).parse(projected);
      if(!rows.length)throw Error('已交换简历列表为空，未同步任何会话。');
      if(new Set(rows.map(row=>row.key)).size!==rows.length)throw Error('会话列表标识重复，未开始同步。');
      return rows;
    }
    await page.waitForTimeout(200);
  }
  throw Error('已交换简历列表加载超时，请检查专用窗口后重试。');
}

export async function selectBossInboxRow(page:ManagedPage,row:z.infer<typeof rowSchema>){
  const rows=await page.locator('body').evaluate(observeRows,undefined,{},false);
  const matches=rows.filter(current=>current.key===row.key&&current.postingId===row.postingId);
  const [match]=matches;
  if(matches.length!==1||!match)throw Error('冻结的前十条会话已变化或不在当前列表，已停止同步。');
  await page.locator(rowsSelector).nth(match.index).click();
}
