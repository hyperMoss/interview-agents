/** Serialized into the owned page; dependencies must stay inside this function. */
export function observeBossChat(body:HTMLElement,marker:string|null) {
  const seen=new Set<string>();
  const structure=Array.from(body.querySelectorAll('*'))
    .filter(node=>node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0&&getComputedStyle(node).visibility!=='hidden')
    .filter(node=>node.closest('.chat-container')||/chat|message|conversation|resume|job|company|boss|user/i.test(node.getAttribute('class')??'')||Array.from(node.attributes).some(attribute=>/^data-.*(id|account)/i.test(attribute.name)))
    .filter(node=>{const key=node.tagName+':'+node.getAttribute('class')+':'+node.parentElement?.getAttribute('class');if(seen.has(key))return false;seen.add(key);return true;})
    .slice(0,200).map(node=>({tag:node.tagName,className:node.getAttribute('class'),parentClass:node.parentElement?.getAttribute('class')??null,attributes:Array.from(node.attributes).map(attribute=>attribute.name),children:Array.from(node.children).slice(0,8).map(child=>({tag:child.tagName,className:child.getAttribute('class')}))}));
  const containers=Array.from(body.querySelectorAll('[data-conversation-id], .chat-conversation, .chat-box'))
    .filter(element=>element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0&&getComputedStyle(element).visibility!=='hidden')
    .filter(node=>node.querySelector('.chat-message-list, .message-list, [data-message-id], .chat-message > .im-list'));
  if(containers.length!==1)return {error:body.querySelector('.chat-conversation .chat-no-data')?'当前消息页尚未选中聊天，请在专用窗口选择一个会话。':'未找到唯一的当前聊天容器，已记录结构诊断，请展开会话后重试。',structure};
  const chat=containers[0];
  if(!chat)return {error:'会话不存在。',structure};
  const fields=['[data-company-name], .conversation-company, .job-info .company-name','[data-job-title], .conversation-job-title, .job-info .job-name','[data-jd], .job-detail .job-sec-text, .conversation-jd']
    .map(selector=>Array.from(chat.querySelectorAll(selector)).filter(element=>element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0&&getComputedStyle(element).visibility!=='hidden'))
    .map(nodes=>nodes.length===1?nodes[0]?.textContent?.trim()??'':'');
  let conversationKey:unknown=chat.getAttribute('data-conversation-id')??chat.getAttribute('data-boss-id')??new URL(body.ownerDocument.location.href).searchParams.get('bossId');
  let account:unknown=marker??body.getAttribute('data-account-id')??body.querySelector('[data-current-user-id]')?.getAttribute('data-current-user-id');
  let company=fields[0]??'',title=fields[1]??'';
  const jobLinks=Array.from(chat.querySelectorAll('a[href*="/job_detail/"]'))
    .filter(element=>element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0&&getComputedStyle(element).visibility!=='hidden')
    .map(node=>new URL(node.getAttribute('href')??'',body.ownerDocument.location.href))
    .filter(url=>url.origin===body.ownerDocument.location.origin&&!url.username&&!url.password&&!url.hash&&/^\/job_detail\/[A-Za-z0-9_-]+\.html$/.test(url.pathname));
  let postingId:unknown=chat.getAttribute('data-job-id')??(jobLinks.length===1?jobLinks[0]?.pathname.match(/\/job_detail\/([A-Za-z0-9_-]+)\.html$/)?.[1]:null);
  let jobUrl=jobLinks.length===1?jobLinks[0]:undefined;
  // Names and field mappings are verified against the public chat-new v5578 bundle.
  // Read existing reactive data only; never invoke methods or request message history.
  if(chat.hasAttribute('data-v-29cd61d6')) {
    const runtime:unknown=Reflect.get(chat,'__vue__');
    const position=chat.querySelector('.chat-position-content[data-v-d2e04850]');
    const positionRuntime:unknown=position?Reflect.get(position,'__vue__'):null;
    if(!runtime||typeof runtime!=='object'||!positionRuntime||typeof positionRuntime!=='object')return {error:'当前聊天组件数据未就绪，未读取标识。',structure};
    const options:unknown=Reflect.get(runtime,'$options'),positionOptions:unknown=Reflect.get(positionRuntime,'$options');
    if(!options||typeof options!=='object'||Reflect.get(options,'name')!=='conversation-box'||!positionOptions||typeof positionOptions!=='object'||Reflect.get(positionOptions,'name')!=='ConversationPositionInfo')return {error:'当前聊天组件版本未识别，未读取标识。',structure};
    const selected:unknown=Reflect.get(runtime,'selectedFriend$'),detail:unknown=Reflect.get(positionRuntime,'conversation$');
    if(!selected||typeof selected!=='object'||!detail||typeof detail!=='object')return {error:'当前聊天标识未加载，请保持会话打开。',structure};
    const selectedKey:unknown=Reflect.get(selected,'uniqueId'),detailKey:unknown=Reflect.get(detail,'uniqueId');
    const selectedBoss:unknown=Reflect.get(selected,'encryptBossId'),detailBoss:unknown=Reflect.get(detail,'encryptBossId');
    const selectedJob:unknown=Reflect.get(selected,'encryptJobId'),detailJob:unknown=Reflect.get(detail,'encryptJobId');
    if(typeof selectedKey!=='string'||!selectedKey||detailKey!==selectedKey||typeof detailBoss!=='string'||!detailBoss||selectedBoss!==detailBoss||selectedJob!==detailJob||Reflect.get(detail,'groupId')||Reflect.get(selected,'groupId'))return {error:'当前聊天、招聘方和岗位标识未一致确认，未保存。',structure};
    const stateCompany:unknown=Reflect.get(detail,'companyName'),stateTitle:unknown=Reflect.get(detail,'jobName');
    const visibleTitles=Array.from(chat.querySelectorAll('.chat-position-content .position-name')).filter(element=>element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0);
    const visibleCompanies=Array.from(chat.querySelectorAll('.user-info .base-info > span:not(.base-title)')).filter(element=>element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0);
    if(typeof stateCompany!=='string'||!stateCompany||typeof stateTitle!=='string'||!stateTitle||visibleTitles.length!==1||visibleTitles[0]?.textContent?.trim()!==stateTitle.trim()||visibleCompanies.filter(node=>node.textContent?.trim()===stateCompany.trim()).length!==1)return {error:'组件中的公司岗位与当前可见标题不一致，未保存。',structure};
    const store:unknown=Reflect.get(runtime,'$store');
    const state:unknown=store&&typeof store==='object'?Reflect.get(store,'state'):null;
    const user:unknown=state&&typeof state==='object'?Reflect.get(state,'userInfo'):null;
    const userId:unknown=user&&typeof user==='object'?Reflect.get(user,'userId'):null;
    const identity:unknown=user&&typeof user==='object'?Reflect.get(user,'identity'):null;
    if((identity!==0&&identity!=='0')||!(typeof userId==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(userId)||typeof userId==='number'&&Number.isSafeInteger(userId)&&userId>0))return {error:'当前页面未提供可靠的求职者账号标识，未保存。',structure};
    if(typeof detailJob!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(detailJob))return {error:'当前岗位标识未确认，未保存。',structure};
    conversationKey=selectedKey;account=marker??String(userId);postingId=detailJob;company=stateCompany.trim();title=stateTitle.trim();
    jobUrl=new URL('/job_detail/'+detailJob+'.html',body.ownerDocument.location.origin);
    const securityId:unknown=Reflect.get(detail,'securityId');
    if(typeof securityId==='string'&&securityId.length<=2000)jobUrl.searchParams.set('securityId',securityId);
  }
  if(jobUrl&&postingId!==jobUrl.pathname.match(/\/job_detail\/([A-Za-z0-9_-]+)\.html$/)?.[1])return {error:'聊天岗位标识与详情链接不一致，未保存。',structure};
  const exchangeNodes=Array.from(chat.querySelectorAll('[data-resume-exchanged="true"], .resume-exchange-status, .resume-status, .message-system, .system-message, .message-item.item-system .text, .message-item.item-myself .message-card-top-title, .message-item .message-dialog-both :is(.message-card-top-title, .message-subtitle, .message-multi > .gray)'))
    .filter((element):element is HTMLElement=>element instanceof HTMLElement&&element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0&&getComputedStyle(element).visibility!=='hidden');
  const exchange=exchangeNodes.map(node=>node.innerText.trim()).find(value=>{
    const text=value.replace(/\s+/g,'');
    if(/失败|未成功|未发送|拒绝|撤回|取消/.test(text))return false;
    if(/^附件简历请求已发送[。！!]?$/.test(text)||text.includes('您的附件简历'))return true;
    if(/请求|申请|等待/.test(text))return false;
    const confirmed=/已交换简历|交换(?:附件|在线)?简历成功|已(?:接收|收到).{0,12}简历|对方已(?:同意|接受).{0,12}简历|已发送.{0,12}简历|简历已发送/;
    const sentToRecruiter=/^(?:你|您)?(?:已(?:成功)?向(?:对方|招聘方|Boss)发送(?:了)?(?:你的|您的)?(?:附件|在线)?简历|已(?:成功)?将(?:附件|在线)?简历发送(?:给|至)(?:对方|招聘方|Boss)|向(?:对方|招聘方|Boss)发送了(?:附件|在线)?简历)[。！!]?$/i;
    return confirmed.test(text)||sentToRecruiter.test(text);
  });
  const messages=Array.from(chat.querySelectorAll('[data-message-id], .message-item')).filter(element=>element.getBoundingClientRect().width>0&&element.getBoundingClientRect().height>0&&getComputedStyle(element).visibility!=='hidden');
  if(messages.length>200)return {error:'当前消息超过 200 条，请缩小可见窗口；不会截断保存。',structure};
  return {
    structure,postingReadUrl:jobUrl?.toString()??null,
    accountKey:account,conversationKey,postingId,company,title,
    jdText:(fields[2]?.length??0)>=20?fields[2]:null,exchangeEvidence:exchange??null,
    sourceUrl:body.ownerDocument.location.origin+body.ownerDocument.location.pathname,
    postingUrl:jobUrl?jobUrl.origin+jobUrl.pathname:null,
    observedAt:new Date().toISOString(),scope:'visible_window',
    messages:messages.map(node=>{
      const content=node.querySelector('.message-text, .text')??node;
      const clone=content.cloneNode(true);
      let text='';
      if(clone instanceof Element){
        const sourceChildren=[content,...Array.from(content.querySelectorAll('*'))],clonedChildren=[clone,...Array.from(clone.querySelectorAll('*'))];
        sourceChildren.forEach((element,index)=>{if(element.matches('.message-status')||getComputedStyle(element).display==='none'||getComputedStyle(element).visibility==='hidden')clonedChildren[index]?.remove();});
        text=clone.textContent?.trim()??'';
      }
      return {sourceId:node.getAttribute('data-message-id')??node.getAttribute('data-mid'),direction:node.getAttribute('data-direction')??(node.classList.contains('is-self')||node.classList.contains('item-myself')?'self':node.classList.contains('is-recruiter')||node.classList.contains('item-friend')?'recruiter':node.classList.contains('item-system')?'system':'unknown'),text:text||'[非文本消息，未提取内容]',timeLabel:node.querySelector('time, .message-time, .item-time .time')?.textContent?.trim()??null};
    }),
  };
}
