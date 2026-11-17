import { useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { FileInput } from '@astryxdesign/core/FileInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { api } from './api';
export function ResumeUpload({onUse}:{onUse:(text:string)=>void}){
  const [busy,setBusy]=useState(false),[text,setText]=useState(''),[filename,setFilename]=useState(''),[warnings,setWarnings]=useState<string[]>([]),[error,setError]=useState('');
  async function upload(file:File){setError('');if(file.size>5*1024*1024){setError('简历文件不能超过 5 MB。');return;}setBusy(true);try{const result=await api.importResume(file);setText(result.text);setFilename(result.filename);setWarnings(result.warnings);}catch(error){setError(error instanceof Error?error.message:'文件解析失败。');}finally{setBusy(false);}}
  return <div className="resume-upload"><FileInput label="上传自己的简历" accept=".pdf,.docx,.txt,.md" value={null} isDisabled={busy} onChange={files=>{const file=Array.isArray(files)?files[0]:files;if(file)void upload(file);}} /><p className="storage-note">PDF、DOCX、TXT 或 Markdown，最多 5 MB。文件在本地服务解析，确认后的文本才进入面试。扫描 PDF 请先转换为文字。</p>
    {busy?<p role="status">正在提取简历文本…</p>:null}{error?<Banner role="alert" status="error" title={error} />:null}
    {filename?<div className="resume-preview"><strong>{filename}</strong>{warnings.map(warning=><p key={warning} role="note">{warning}</p>)}<TextArea label="提取文本预览" rows={6} value={text} maxLength={64000} onChange={value=>setText(value)} /><div className="panel-actions"><Button label="放弃提取结果" onClick={()=>{setFilename('');setText('');setWarnings([]);}} /><Button variant="primary" label="使用到简历" onClick={()=>{onUse(text);setFilename('');setText('');setWarnings([]);}} /></div></div>:null}
  </div>;
}
