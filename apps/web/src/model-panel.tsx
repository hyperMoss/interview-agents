import { useEffect,useRef,useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation,useQueryClient,useQuery } from '@tanstack/react-query';
import { api } from './api';
import { modelAccessSchema,modelDraftSchema } from '../../../packages/contracts/src/models';
export function ModelPanel({onClose}:{onClose:()=>void}){
  const cache=useQueryClient();const dialog=useRef<HTMLDialogElement>(null);
  const identity=useQuery({queryKey:['identity'],queryFn:api.identity});
  const settings=useQuery({queryKey:['model-settings'],queryFn:api.modelSettings,enabled:identity.isSuccess});
  const [baseUrl,setBaseUrl]=useState(()=>settings.data?.active?.baseUrl??'');const [apiKey,setApiKey]=useState('');const [model,setModel]=useState(()=>settings.data?.active?.model??'');
  const [remember,setRemember]=useState(false);const [models,setModels]=useState<string[]>([]);const [probe,setProbe]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState<'list'|'probe'|null>(null);const version=useRef(0);
  const [saving,setSaving]=useState(false);
  const clear=useMutation({mutationFn:api.clearModel,onSuccess:async()=>{setApiKey('');await cache.invalidateQueries({queryKey:['model-settings']});onClose();},onError:error=>setError(error.message)});
  useEffect(()=>{const element=dialog.current;if(element&&!element.open)element.showModal();return()=>{version.current++;element?.close();};},[]);
  function invalidate(){version.current++;setModels([]);setProbe('');setError('');setBusy(null);}
  async function list(){const draft=modelAccessSchema.safeParse({baseUrl,apiKey});if(!draft.success){setError('请先填写有效的 API 根地址与密钥（本地服务可留空）。');return;}
    const current=version.current;setBusy('list');setError('');try{const result=await api.modelList(draft.data);if(current===version.current){setModels(result.models);setProbe(result.models.length?'模型列表已加载，也可以手动填写。':'列表为空，请手动填写模型名。');}}catch(error){if(current===version.current)setError(error instanceof Error?error.message:'读取列表失败。');}finally{if(current===version.current)setBusy(null);}
  }
  async function test(){const draft=modelDraftSchema.safeParse({baseUrl,apiKey,model});if(!draft.success){setError('填写有效地址和模型名后再测试连接。');return;}
    const current=version.current;setBusy('probe');setError('');try{const result=await api.modelProbe(draft.data);if(current===version.current)setProbe(`${result.message} 响应 ${Math.round(result.latencyMs)} ms。`);}catch(error){if(current===version.current)setError(error instanceof Error?error.message:'连接测试失败。');}finally{if(current===version.current)setBusy(null);}
  }
  async function submit(event:React.FormEvent){event.preventDefault();const draft=modelDraftSchema.safeParse({baseUrl,apiKey,model});if(!draft.success){setError('检查 API 根地址、密钥和模型名。');return;}setSaving(true);try{await api.saveModel({...draft.data,remember});setApiKey('');await cache.invalidateQueries({queryKey:['model-settings']});onClose();}catch(error){setError(error instanceof Error?error.message:'启用连接失败。');}finally{setSaving(false);}}
  const enabled=settings.data?.enabled===true;const pending=saving||clear.isPending;
  return createPortal(<dialog className="model-dialog" ref={dialog} aria-labelledby="model-panel-title" onCancel={event=>{event.preventDefault();if(!pending)onClose();}}>
    <div className="panel-heading"><div><h2 id="model-panel-title">模型设置</h2><p>新面试使用启用的连接；正在进行的面试保留原模型。</p></div><button className="icon-button" disabled={pending} aria-label="关闭模型设置" onClick={onClose}>×</button></div>
    {settings.isPending?<p role="status">正在读取连接状态…</p>:null}
    {settings.error?<p className="error" role="alert">{settings.error.message}<button onClick={()=>void settings.refetch()}>重新读取</button></p>:null}
    {settings.data?<div className="current-model"><strong>当前：{settings.data.active?.model??(settings.data.mode==='demo'?'规则演示':settings.data.mode==='disabled'?'未配置模型':settings.data.defaultModel||'部署方默认模型')}</strong><small>{settings.data.active?`${settings.data.active.remember?'长期连接':'临时连接'}，有效至 ${new Date(settings.data.active.expiresAt).toLocaleString('zh-CN')}`:'启用自带模型后，可以开始真实 AI 面试。'}</small></div>:null}
    {!enabled&&settings.data?<p className="error" role="note">部署方未开放自定义接入。仍可清除已保存连接，恢复默认。</p>:null}
    <form onSubmit={submit}>
      <fieldset disabled={!enabled||pending}>
        <div className="preset-actions"><button type="button" className="secondary" onClick={()=>{invalidate();setBaseUrl('');setModel('');setApiKey('');}}>兼容接口</button>{settings.data?.allowLocal?<button type="button" className="secondary" onClick={()=>{invalidate();setBaseUrl('http://127.0.0.1:11434/v1');setModel('');setApiKey('');}}>本地模型</button>:null}</div>
        <label>API 根地址<input required type="url" value={baseUrl} placeholder="https://你的模型服务/v1" onChange={event=>{invalidate();setApiKey('');setBaseUrl(event.target.value);}} /></label>
        <label>API Key<input type="password" value={apiKey} autoComplete="off" placeholder="经业务 API 转交 Agent 与所选模型接口" onChange={event=>{invalidate();setApiKey(event.target.value);}} /></label>
        <div className="model-name-row"><label>模型名<input required value={model} list="model-candidates" placeholder="手动填写，或读取模型列表" onChange={event=>{version.current++;setProbe('');setError('');setBusy(null);setModel(event.target.value);}}/><datalist id="model-candidates">{models.map(id=><option key={id} value={id}/>)}</datalist></label><button type="button" className="secondary" disabled={Boolean(busy)} onClick={()=>void list()}>{busy==='list'?'读取中…':'读取模型列表'}</button></div>
        <label className="checkbox-label"><input type="checkbox" checked={remember} onChange={event=>setRemember(event.target.checked)}/>保留此连接 30 天</label>
        <p className="storage-note">默认临时连接 24 小时。密钥在 Agent 数据库加密保存，不写入浏览器存储、面试记录或导出文件。恢复默认会删除当前身份保存的全部自带连接。</p>
        <p className="storage-note">请求由 Agent 服务发出。本地地址指 Agent 所在机器；更新连接时需重新填写密钥。连接测试只发送短请求，可能产生供应商费用。</p>
        <div className="panel-actions"><button type="button" className="secondary" disabled={Boolean(busy)} onClick={()=>void test()}>{busy==='probe'?'测试中…':'测试连接'}</button><button type="submit" className="primary" disabled={Boolean(busy)}>{saving?'启用中…':'保存并启用'}</button></div>
      </fieldset>
    </form>
    {probe?<p className="probe-result" role="status">{probe}</p>:null}{error?<p className="error" role="alert">{error}</p>:null}
    <div className="panel-footer"><button className="text-button danger" disabled={pending} onClick={()=>clear.mutate()}>清除连接并恢复默认</button></div>
  </dialog>,document.body);
}
