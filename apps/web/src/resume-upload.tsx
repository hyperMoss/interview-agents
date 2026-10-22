import { useId, useState } from 'react';
import { Button, Input } from 'antd';
import { api } from './api';
export function ResumeUpload({onUse}:{onUse:(text:string)=>void}){
  const fieldId=useId();
  const [busy,setBusy]=useState(false),[text,setText]=useState(''),[filename,setFilename]=useState(''),[warnings,setWarnings]=useState<string[]>([]),[error,setError]=useState('');
  async function upload(file:File){setError('');if(file.size>5*1024*1024){setError('简历文件不能超过 5 MB。');return;}setBusy(true);try{const result=await api.importResume(file);setText(result.text);setFilename(result.filename);setWarnings(result.warnings);}catch(error){setError(error instanceof Error?error.message:'文件解析失败。');}finally{setBusy(false);}}
  return <div className="resume-upload"><label htmlFor={`${fieldId}-file`}>上传自己的简历<input id={`${fieldId}-file`} type="file" accept=".pdf,.docx,.txt,.md" disabled={busy} onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);event.target.value='';}}/></label><p className="storage-note">PDF、DOCX、TXT 或 Markdown，最多 5 MB。文件在本地服务解析，确认后的文本才进入面试。扫描 PDF 请先转换为文字。</p>
    {busy?<p role="status">正在提取简历文本…</p>:null}{error?<p className="error" role="alert">{error}</p>:null}
    {filename?<div className="resume-preview"><strong>{filename}</strong>{warnings.map(warning=><p key={warning} role="note">{warning}</p>)}<label htmlFor={`${fieldId}-preview`}>提取文本预览<Input.TextArea id={`${fieldId}-preview`} rows={6} value={text} maxLength={64000} onChange={event=>setText(event.target.value)}/></label><div className="panel-actions"><Button htmlType="button" className="secondary" onClick={()=>{setFilename('');setText('');setWarnings([]);}}>放弃提取结果</Button><Button htmlType="button" type="primary" className="primary" onClick={()=>{onUse(text);setFilename('');setText('');setWarnings([]);}}>使用到简历</Button></div></div>:null}
  </div>;
}
