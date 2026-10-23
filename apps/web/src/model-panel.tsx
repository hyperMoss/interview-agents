import { useEffect,useRef,useState } from 'react';
import { Alert,Button,Checkbox,ConfigProvider,Input,Popconfirm,Select,Spin } from 'antd';
import { useMutation,useQueryClient,useQuery } from '@tanstack/react-query';
import { api } from './api';
import { modelAccessSchema,modelDraftSchema } from '../../../packages/contracts/src/models';
export function ModelPanel({onClose}:{onClose:()=>void}){
  const cache=useQueryClient();
  const identity=useQuery({queryKey:['identity'],queryFn:api.identity});
  const settings=useQuery({queryKey:['model-settings'],queryFn:api.modelSettings,enabled:identity.isSuccess});
  const [baseUrl,setBaseUrl]=useState(()=>settings.data?.active?.baseUrl??'');const [apiKey,setApiKey]=useState('');const [model,setModel]=useState(()=>settings.data?.active?.model??'');
  const [remember,setRemember]=useState(false);const [models,setModels]=useState<string[]>([]);const [probe,setProbe]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState<'list'|'probe'|null>(null);const version=useRef(0);
  const [saving,setSaving]=useState(false);const edited=useRef(false);
  useEffect(()=>{if(settings.data&&!edited.current){setBaseUrl(settings.data.active?.baseUrl??'');setModel(settings.data.active?.model??'');setRemember(settings.data.active?.remember??false);}},[settings.data]);
  const clear=useMutation({mutationFn:api.clearModel,onSuccess:async()=>{setApiKey('');await cache.invalidateQueries({queryKey:['model-settings']});onClose();},onError:error=>setError(error.message)});
  useEffect(()=>()=>{version.current++;},[]);
  function invalidate(){edited.current=true;version.current++;setModels([]);setProbe('');setError('');setBusy(null);}
  async function list(){const draft=modelAccessSchema.safeParse({baseUrl,apiKey});if(!draft.success){setError('请先填写有效的 API 根地址与密钥（本地服务可留空）。');return;}
    const current=version.current;setBusy('list');setError('');try{const result=await api.modelList(draft.data);if(current===version.current){setModels(result.models);setProbe(result.models.length?'模型列表已加载，也可以手动填写。':'列表为空，请手动填写模型名。');}}catch(error){if(current===version.current)setError(error instanceof Error?error.message:'读取列表失败。');}finally{if(current===version.current)setBusy(null);}
  }
  async function test(){const draft=modelDraftSchema.safeParse({baseUrl,apiKey,model});if(!draft.success){setError('填写有效地址和模型名后再测试连接。');return;}
    const current=version.current;setBusy('probe');setError('');try{const result=await api.modelProbe(draft.data);if(current===version.current)setProbe(`${result.message} 响应 ${Math.round(result.latencyMs)} ms。`);}catch(error){if(current===version.current)setError(error instanceof Error?error.message:'连接测试失败。');}finally{if(current===version.current)setBusy(null);}
  }
  async function submit(event:React.FormEvent){event.preventDefault();const draft=modelDraftSchema.safeParse({baseUrl,apiKey,model});if(!draft.success){setError('检查 API 根地址、密钥和模型名。');return;}setSaving(true);try{await api.saveModel({...draft.data,remember});setApiKey('');await cache.invalidateQueries({queryKey:['model-settings']});onClose();}catch(error){setError(error instanceof Error?error.message:'启用连接失败。');}finally{setSaving(false);}}
  const enabled=settings.data?.enabled===true;const pending=saving||clear.isPending;
  return <section aria-labelledby="model-panel-title" aria-busy={pending||Boolean(busy)}>
    <div className="panel-heading"><div><h2 id="model-panel-title">模型设置</h2><p>新面试使用启用的连接；正在进行的面试保留原模型。</p></div><Button disabled={pending} onClick={onClose}>返回练习</Button></div>
    {settings.isPending?<div role="status"><Spin size="small" /> 正在读取连接状态…</div>:null}
    {settings.error?<Alert type="error" showIcon message={settings.error.message} action={<Button onClick={()=>void settings.refetch()}>重新读取</Button>} />:null}
    {settings.data?<div className="current-model"><strong>当前：{settings.data.active?.model??(settings.data.mode==='demo'?'规则演示':settings.data.mode==='disabled'?'未配置模型':settings.data.defaultModel||'部署方默认模型')}</strong><small>{settings.data.active?`${settings.data.active.remember?'长期连接':'临时连接'}，有效至 ${new Date(settings.data.active.expiresAt).toLocaleString('zh-CN')}`:'启用自带模型后，可以开始真实 AI 面试。'}</small></div>:null}
    {!enabled&&settings.data?<Alert type="warning" showIcon message="部署方未开放自定义接入。仍可清除已保存连接，恢复默认。" />:null}
    <form onSubmit={submit}>
      <ConfigProvider componentDisabled={!enabled||pending}>
        <div className="preset-actions"><Button onClick={()=>{invalidate();setBaseUrl('');setModel('');setApiKey('');}}>兼容接口</Button>{settings.data?.allowLocal?<Button onClick={()=>{invalidate();setBaseUrl('http://127.0.0.1:11434/v1');setModel('');setApiKey('');}}>本地模型</Button>:null}</div>
        <label htmlFor="model-base-url">API 根地址</label>
        <Input id="model-base-url" required type="url" value={baseUrl} placeholder="https://你的模型服务/v1" onChange={event=>{invalidate();setApiKey('');setBaseUrl(event.target.value);}} />
        <label htmlFor="model-api-key">API Key</label>
        <Input.Password id="model-api-key" value={apiKey} autoComplete="off" placeholder="填写服务商提供的密钥" onChange={event=>{invalidate();setApiKey(event.target.value);}} />
        <label htmlFor="model-name">模型名</label>
        <Input id="model-name" required value={model} placeholder="手动填写，或读取模型列表" onChange={event=>{edited.current=true;version.current++;setProbe('');setError('');setBusy(null);setModel(event.target.value);}} />
        {models.length?<><label htmlFor="model-candidates">已读取的模型</label><Select id="model-candidates" style={{width:'100%'}} showSearch value={models.includes(model)?model:undefined} placeholder="选择模型，或在上方手动填写" options={models.map(value=>({label:value,value}))} onChange={value=>{edited.current=true;version.current++;setProbe('');setError('');setBusy(null);setModel(value);}} /></>:null}
        <div className="preset-actions"><Button disabled={!enabled||pending||Boolean(busy)} loading={busy==='list'} onClick={()=>void list()}>{busy==='list'?'读取中…':'读取模型列表'}</Button></div>
        <Checkbox checked={remember} onChange={event=>setRemember(event.target.checked)}>保留此连接 30 天</Checkbox>
        <p className="storage-note">默认临时连接 24 小时。密钥在 Agent 数据库加密保存，不写入浏览器存储、面试记录或导出文件。恢复默认会删除当前身份保存的全部自带连接。</p>
        <p className="storage-note">请求由 Agent 服务发出。本地地址指 Agent 所在机器；更新连接时需重新填写密钥。连接测试只发送短请求，可能产生供应商费用。</p>
        <div className="panel-actions"><Button disabled={!enabled||pending||Boolean(busy)} loading={busy==='probe'} onClick={()=>void test()}>{busy==='probe'?'测试中…':'测试连接'}</Button><Button type="primary" htmlType="submit" disabled={!enabled||pending||Boolean(busy)} loading={saving}>{saving?'启用中…':'保存并启用'}</Button></div>
      </ConfigProvider>
    </form>
    {probe?<div role="status"><Alert type="success" showIcon message={probe} /></div>:null}{error?<Alert type="error" showIcon message={error} />:null}
    <div className="panel-footer"><Popconfirm title="清除当前模型连接？" description="删除保存的自带连接并恢复默认。正在使用旧连接的任务可能需要重新配置后重试。" okText="确认清除" cancelText="保留连接" onConfirm={()=>clear.mutateAsync()}><Button type="text" danger disabled={pending} loading={clear.isPending}>清除连接并恢复默认</Button></Popconfirm></div>
  </section>;
}
