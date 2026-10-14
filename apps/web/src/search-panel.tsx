import { useEffect,useRef,useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { searchDraftSchema,searchProviderSchema } from '../../../packages/contracts/src/search';
const endpoints={tavily:'https://api.tavily.com',firecrawl:'https://api.firecrawl.dev/v2'};
export function SearchPanel({onClose}:{onClose:()=>void}){
  const cache=useQueryClient(),dialog=useRef<HTMLDialogElement>(null),version=useRef(0);
  const identity=useQuery({queryKey:['identity'],queryFn:api.identity});
  const settings=useQuery({queryKey:['search-settings'],queryFn:api.searchSettings,enabled:identity.isSuccess});
  const [provider,setProvider]=useState(()=>settings.data?.active?.provider??'tavily'),[baseUrl,setBaseUrl]=useState(()=>settings.data?.active?.baseUrl??endpoints.tavily),[key,setKey]=useState(''),[remember,setRemember]=useState(false),[query,setQuery]=useState('后端岗位公开资料'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>{const element=dialog.current;if(element&&!element.open)element.showModal();return()=>{version.current++;element?.close();};},[]);
  function reset(){version.current++;setMessage('');setError('');}
  async function run(action:'save'|'probe'){
    const draft=searchDraftSchema.safeParse({provider,baseUrl,apiKey:key,remember});if(!draft.success){setError('请检查搜索接口地址与密钥。');return;}
    const current=version.current;setBusy(true);setError('');try{if(action==='save'){await api.saveSearch(draft.data);setKey('');await cache.invalidateQueries({queryKey:['search-settings']});onClose();}else{const result=await api.probeSearch(draft.data,query);if(current===version.current)setMessage(`搜索连接成功，返回 ${result.sources.length} 条来源。`);}}catch(error){if(current===version.current)setError(error instanceof Error?error.message:'搜索请求失败。');}finally{if(current===version.current)setBusy(false);}
  }
  async function clear(){setBusy(true);try{await api.clearSearch();setKey('');await cache.invalidateQueries({queryKey:['search-settings']});onClose();}catch(error){setError(error instanceof Error?error.message:'清除失败。');}finally{setBusy(false);}}
  return createPortal(<dialog ref={dialog} className="model-dialog" aria-labelledby="search-title" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}><div className="panel-heading"><div><h2 id="search-title">联网搜索设置</h2><p>连接设置后，还需要在新面试中明确启用搜索并确认查询。</p></div><button className="icon-button" aria-label="关闭搜索设置" disabled={busy} onClick={onClose}>×</button></div>
    {settings.data?.active?<div className="current-model"><strong>当前连接 {settings.data.active.provider}</strong><small>有效至 {new Date(settings.data.active.expiresAt).toLocaleString('zh-CN')}。更新需重新填写密钥。</small></div>:null}
    {settings.isError?<p className="error" role="alert">{settings.error.message}</p>:null}
    {settings.data&&!settings.data.enabled?<p className="error">部署方未开放搜索接入。</p>:null}
    <fieldset disabled={busy||settings.data?.enabled!==true}><label>搜索服务<select value={provider} onChange={event=>{const value=searchProviderSchema.parse(event.target.value);reset();setProvider(value);setBaseUrl(endpoints[value]);setKey('');}}><option value="tavily">Tavily</option><option value="firecrawl">Firecrawl v2</option></select></label><label>搜索 API 根地址<input type="url" value={baseUrl} onChange={event=>{reset();setBaseUrl(event.target.value);setKey('');}}/></label><label>搜索 API Key<input type="password" autoComplete="off" value={key} onChange={event=>{reset();setKey(event.target.value);}}/></label><label>测试查询<input value={query} maxLength={200} onChange={event=>{reset();setQuery(event.target.value);}}/></label><label className="checkbox-label"><input type="checkbox" checked={remember} onChange={event=>setRemember(event.target.checked)}/>保留搜索连接 30 天</label><p className="storage-note">默认保留 24 小时，密钥由 Agent 加密保存，不进入浏览器存储或报告。测试会调用搜索服务，可能产生费用。</p><div className="panel-actions"><button className="secondary" onClick={()=>void run('probe')}>测试搜索</button><button className="primary" onClick={()=>void run('save')}>保存搜索连接</button></div></fieldset>
    {message?<p role="status" className="probe-result">{message}</p>:null}{error?<p role="alert" className="error">{error}</p>:null}<div className="panel-footer"><button className="text-button danger" disabled={busy} onClick={()=>void clear()}>清除搜索连接</button><p className="storage-note">清除不会删除历史面试已经取得的来源资料。尚未取得资料的旧任务会提示连接失效。</p></div></dialog>,document.body);
}
