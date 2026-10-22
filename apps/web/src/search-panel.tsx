import { useEffect,useRef,useState } from 'react';
import { Alert,Button,Checkbox,ConfigProvider,Input,Select,Spin } from 'antd';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { searchDraftSchema,searchProviderSchema } from '../../../packages/contracts/src/search';
const endpoints={tavily:'https://api.tavily.com',firecrawl:'https://api.firecrawl.dev/v2'};
export function SearchPanel({onClose}:{onClose:()=>void}){
  const cache=useQueryClient(),version=useRef(0);
  const identity=useQuery({queryKey:['identity'],queryFn:api.identity});
  const settings=useQuery({queryKey:['search-settings'],queryFn:api.searchSettings,enabled:identity.isSuccess});
  const [provider,setProvider]=useState(()=>settings.data?.active?.provider??'tavily'),[baseUrl,setBaseUrl]=useState(()=>settings.data?.active?.baseUrl??endpoints.tavily),[key,setKey]=useState(''),[remember,setRemember]=useState(false),[query,setQuery]=useState('后端岗位公开资料'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>()=>{version.current++;},[]);
  function reset(){version.current++;setMessage('');setError('');}
  async function run(action:'save'|'probe'){
    const draft=searchDraftSchema.safeParse({provider,baseUrl,apiKey:key,remember});if(!draft.success){setError('请检查搜索接口地址与密钥。');return;}
    const current=version.current;setBusy(true);setError('');try{if(action==='save'){await api.saveSearch(draft.data);setKey('');await cache.invalidateQueries({queryKey:['search-settings']});onClose();}else{const result=await api.probeSearch(draft.data,query);if(current===version.current)setMessage(`搜索连接成功，返回 ${result.sources.length} 条来源。`);}}catch(error){if(current===version.current)setError(error instanceof Error?error.message:'搜索请求失败。');}finally{if(current===version.current)setBusy(false);}
  }
  async function clear(){setBusy(true);try{await api.clearSearch();setKey('');await cache.invalidateQueries({queryKey:['search-settings']});onClose();}catch(error){setError(error instanceof Error?error.message:'清除失败。');}finally{setBusy(false);}}
  return <section aria-labelledby="search-title" aria-busy={busy}>
    <div className="panel-heading"><div><h2 id="search-title">联网搜索设置</h2><p>连接设置后，还需要在新面试中明确启用搜索并确认查询。</p></div><Button disabled={busy} onClick={onClose}>返回练习</Button></div>
    {settings.isPending?<div role="status"><Spin size="small" /> 正在读取搜索连接状态…</div>:null}
    {settings.data?.active?<div className="current-model"><strong>当前连接 {settings.data.active.provider}</strong><small>有效至 {new Date(settings.data.active.expiresAt).toLocaleString('zh-CN')}。更新需重新填写密钥。</small></div>:null}
    {settings.isError?<Alert type="error" showIcon message={settings.error.message} />:null}
    {settings.data&&!settings.data.enabled?<Alert type="warning" showIcon message="部署方未开放搜索接入。" />:null}
    <ConfigProvider componentDisabled={busy||settings.data?.enabled!==true}>
      <label htmlFor="search-provider">搜索服务</label>
      <Select id="search-provider" style={{width:'100%'}} value={provider} options={[{value:'tavily',label:'Tavily'},{value:'firecrawl',label:'Firecrawl v2'}]} onChange={value=>{const next=searchProviderSchema.parse(value);reset();setProvider(next);setBaseUrl(endpoints[next]);setKey('');}} />
      <label htmlFor="search-base-url">搜索 API 根地址</label>
      <Input id="search-base-url" type="url" value={baseUrl} onChange={event=>{reset();setBaseUrl(event.target.value);setKey('');}} />
      <label htmlFor="search-api-key">搜索 API Key</label>
      <Input.Password id="search-api-key" autoComplete="off" value={key} onChange={event=>{reset();setKey(event.target.value);}} />
      <label htmlFor="search-query">测试查询</label>
      <Input id="search-query" value={query} maxLength={200} onChange={event=>{reset();setQuery(event.target.value);}} />
      <Checkbox checked={remember} onChange={event=>setRemember(event.target.checked)}>保留搜索连接 30 天</Checkbox>
      <p className="storage-note">默认保留 24 小时，密钥由 Agent 加密保存，不进入浏览器存储或报告。测试会调用搜索服务，可能产生费用。</p>
      <div className="panel-actions"><Button loading={busy} onClick={()=>void run('probe')}>测试搜索</Button><Button type="primary" loading={busy} onClick={()=>void run('save')}>保存搜索连接</Button></div>
    </ConfigProvider>
    {message?<div role="status"><Alert type="success" showIcon message={message} /></div>:null}{error?<Alert type="error" showIcon message={error} />:null}
    <div className="panel-footer"><Button type="text" danger disabled={busy} loading={busy} onClick={()=>void clear()}>清除搜索连接</Button><p className="storage-note">清除不会删除历史面试已经取得的来源资料。尚未取得资料的旧任务会提示连接失效。</p></div>
  </section>;
}