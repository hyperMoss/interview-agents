import { useEffect,useRef,useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Spinner } from '@astryxdesign/core/Spinner';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { searchDraftSchema,searchProviderSchema } from '../../../packages/contracts/src/search';
import { ConfirmAction } from './ui/confirm-action';
const endpoints={tavily:'https://api.tavily.com',firecrawl:'https://api.firecrawl.dev/v2'};
export function SearchPanel({onClose}:{onClose:()=>void}){
  const cache=useQueryClient(),version=useRef(0);
  const identity=useQuery({queryKey:['identity'],queryFn:api.identity});
  const settings=useQuery({queryKey:['search-settings'],queryFn:api.searchSettings,enabled:identity.isSuccess});
  const [provider,setProvider]=useState(()=>settings.data?.active?.provider??'tavily'),[baseUrl,setBaseUrl]=useState(()=>settings.data?.active?.baseUrl??endpoints.tavily),[key,setKey]=useState(''),[remember,setRemember]=useState(false),[query,setQuery]=useState('后端岗位公开资料'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>()=>{version.current++;},[]);
  const edited=useRef(false);
  useEffect(()=>{if(settings.data&&!edited.current){setProvider(settings.data.active?.provider??'tavily');setBaseUrl(settings.data.active?.baseUrl??endpoints.tavily);setRemember(settings.data.active?.remember??false);}},[settings.data]);
  function reset(){edited.current=true;version.current++;setMessage('');setError('');}
  async function run(action:'save'|'probe'){
    const draft=searchDraftSchema.safeParse({provider,baseUrl,apiKey:key,remember});if(!draft.success){setError('请检查搜索接口地址与密钥。');return;}
    const current=version.current;setBusy(true);setError('');try{if(action==='save'){await api.saveSearch(draft.data);setKey('');await cache.invalidateQueries({queryKey:['search-settings']});onClose();}else{const result=await api.probeSearch(draft.data,query);if(current===version.current)setMessage(`搜索连接成功，返回 ${result.sources.length} 条来源。`);}}catch(error){if(current===version.current)setError(error instanceof Error?error.message:'搜索请求失败。');}finally{if(current===version.current)setBusy(false);}
  }
  async function clear(){setBusy(true);try{await api.clearSearch();setKey('');await cache.invalidateQueries({queryKey:['search-settings']});onClose();}catch(error){setError(error instanceof Error?error.message:'清除失败。');}finally{setBusy(false);}}
  // 部署方未开放搜索接入或请求进行中时，表单控件真正接收禁用状态。
  const locked=busy||settings.data?.enabled!==true;
  return <section aria-labelledby="search-title" aria-busy={busy}>
    <div className="panel-heading"><div><h2 id="search-title">联网搜索设置</h2><p>连接设置后，还需要在新面试中明确启用搜索并确认查询。</p></div><Button label="返回练习" isDisabled={busy} onClick={onClose} /></div>
    {settings.isPending?<div role="status"><Spinner size="sm" shade="subtle" /> 正在读取搜索连接状态…</div>:null}
    {settings.data?.active?<div className="current-model"><strong>当前连接 {settings.data.active.provider}</strong><small>有效至 {new Date(settings.data.active.expiresAt).toLocaleString('zh-CN')}。更新需重新填写密钥。</small></div>:null}
    {settings.isError?<Banner role="alert" status="error" title={settings.error.message} />:null}
    {settings.data&&!settings.data.enabled?<Banner role="alert" status="warning" title="部署方未开放搜索接入。" />:null}
    <Selector label="搜索服务" isDisabled={locked} value={provider} options={[{value:'tavily',label:'Tavily'},{value:'firecrawl',label:'Firecrawl v2'}]} onChange={value=>{const next=searchProviderSchema.parse(value);reset();setProvider(next);setBaseUrl(endpoints[next]);setKey('');}} />
    <TextInput id="search-base-url" label="搜索 API 根地址" type="url" isDisabled={locked} value={baseUrl} onChange={value=>{reset();setBaseUrl(value);setKey('');}} />
    <TextInput id="search-api-key" label="搜索 API Key" type="password" isDisabled={locked} autoComplete="off" value={key} onChange={value=>{reset();setKey(value);}} />
    <TextInput id="search-query" label="测试查询" isDisabled={locked} value={query} onChange={value=>{reset();setQuery(value.slice(0,200));}} />
    <CheckboxInput label="保留搜索连接 30 天" value={remember} isDisabled={locked} onChange={checked=>{reset();setRemember(checked);}} />
    <p className="storage-note">默认保留 24 小时，密钥由 Agent 加密保存，不进入浏览器存储或报告。测试会调用搜索服务，可能产生费用。</p>
    <div className="panel-actions"><Button label="测试搜索" isDisabled={locked} isLoading={busy} onClick={()=>void run('probe')} /><Button label="保存搜索连接" variant="primary" isDisabled={locked} isLoading={busy} onClick={()=>void run('save')} /></div>
    {message?<div role="status"><Banner role="alert" status="success" title={message} /></div>:null}{error?<Banner role="alert" status="error" title={error} />:null}
    <div className="panel-footer"><ConfirmAction title="清除搜索连接？" description="已取得的历史来源保留，尚未搜索的任务可能需要重新配置。" okText="确认清除" cancelText="保留连接" disabled={busy} onConfirm={clear}><Button label="清除搜索连接" variant="destructive" isDisabled={busy} isLoading={busy} /></ConfirmAction><p className="storage-note">清除不会删除历史面试已经取得的来源资料。尚未取得资料的旧任务会提示连接失效。</p></div>
  </section>;
}
