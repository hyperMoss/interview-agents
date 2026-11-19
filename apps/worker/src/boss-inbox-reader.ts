import {createHash} from 'node:crypto';
import {z} from 'zod';
import {bossConversationSchema} from '../../../packages/contracts/src/boss-inbox';
import type {ManagedLocator} from './boss-browser';
import {observeBossChat} from './boss-inbox-dom';
const conversationIdentitySchema=bossConversationSchema.pick({accountKey:true,conversationKey:true,postingId:true,company:true,title:true});
type ConversationPage={url:()=>string;locator:(selector:string)=>Pick<ManagedLocator,'evaluate'>};
const structureSchema=z.object({pagePath:z.string(),elements:z.array(z.object({tag:z.string(),className:z.string().nullable(),parentClass:z.string().nullable(),attributes:z.array(z.string()),children:z.array(z.object({tag:z.string(),className:z.string().nullable()}))})).max(200)});
export class BossConversationReadError extends Error {
  constructor(message:string,readonly structure:z.infer<typeof structureSchema>){super(message);}
}

export class BossConversationMissingExchange extends BossConversationReadError {
  constructor(
    structure:BossConversationReadError['structure'],
    readonly identity:{accountKey:string;conversationKey:string;postingId:string},
  ) {
    super('当前可见记录中没有明确的简历交换提示，未同步。',structure);
  }
}

/** Reads one existing selection; transient detail-link parameters never enter the stored snapshot. */
export async function readCurrentBossConversation(page:ConversationPage,origin:string,accountMarker:string|null){
  const before=new URL(page.url());
  if(before.origin!==new URL(origin).origin||!/^\/web\/geek\/chat\/?$/.test(before.pathname))throw new Error('请在专用 BOSS 窗口打开消息页，并选中已交换简历的会话。');
  // Component data belongs to the existing page world; Patchright's default isolated world has only DOM.
  const raw=await page.locator('body').evaluate(observeBossChat,accountMarker,{},false);
  if(page.url()!==before.toString())throw new Error('读取时会话页面变化，未接纳同步结果。');
  const {structure,...observed}=raw;
  const diagnostic=structureSchema.parse({pagePath:before.pathname,elements:structure});
  if('error' in observed)throw new BossConversationReadError(observed.error??'会话读取失败。',diagnostic);
  const {postingReadUrl,...snapshot}=observed;
  const accountKey=accountMarker??(typeof snapshot.accountKey==='string'?createHash('sha256').update(`boss-account:${snapshot.accountKey}`).digest('hex').slice(0,16):null);
  if(snapshot.exchangeEvidence===null){
    const identity=conversationIdentitySchema.safeParse({accountKey,conversationKey:snapshot.conversationKey,postingId:snapshot.postingId,company:snapshot.company,title:snapshot.title});
    if(identity.success){
      const {accountKey,conversationKey,postingId}=identity.data;
      throw new BossConversationMissingExchange(diagnostic,{accountKey,conversationKey,postingId});
    }
  }
  const result=bossConversationSchema.safeParse({...snapshot,accountKey});
  if(!result.success)throw new BossConversationReadError('当前会话缺少可靠账号、会话、岗位、公司或消息标识，暂不能同步。请展开岗位资料和消息，保持页面不变后重试。',diagnostic);
  return {snapshot:result.data,postingReadUrl};
}
