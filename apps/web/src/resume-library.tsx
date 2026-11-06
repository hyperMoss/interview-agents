import { useId, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Empty, Input, Popconfirm } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { shortHash } from './career-view';
import './career.css';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 64000;

function kilobytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Opens the exact original bytes in a new tab; the API sends them with an attachment disposition. */
export async function openResumeOriginal(id: string) {
  const tab = window.open('', '_blank');
  const file = await api.resumeOriginal(id).catch(error => { tab?.close(); throw error; });
  if (!tab) return saveBlob(file.body, file.filename);
  const url = URL.createObjectURL(file.body);
  tab.location.href = url;
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function saveBlob(body: Blob, filename: string) {
  const url = URL.createObjectURL(body);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function downloadOriginal(id: string, filename: string) {
  const file = await api.resumeOriginal(id);
  saveBlob(file.body, filename);
}

export function ResumeLibrary() {
  const cache = useQueryClient();
  const field = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const versions = useQuery({ queryKey: ['resume-versions'], queryFn: api.resumeVersions });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [staged, setStaged] = useState<{ stagingId: string; filename: string; text: string; warnings: string[]; byteSize: number; attachmentSha256: string } | null>(null);
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saveRequest, setSaveRequest] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ['resume-version', selectedId], queryFn: () => api.resumeVersion(selectedId ?? ''), enabled: Boolean(selectedId) });

  const upload = useMutation({
    mutationFn: api.resumeUpload,
    onSuccess: result => {
      setStaged(result);
      setText(result.text);
      setAcknowledged(false);
      setSaveRequest(crypto.randomUUID());
      const base = result.filename.replace(/\.[^.]+$/, '').slice(0, 80);
      setLabel(base || '简历版本');
      setError('');
      setSelectedId(null);
    },
    onError: (failure: Error) => setError(failure.message),
  });
  const save = useMutation({
    mutationFn: (requestId: string) => {
      if (!staged) throw new Error('请先上传原始文件。');
      return api.resumeSave({ requestId, stagingId: staged.stagingId, label, text, warningsAcknowledged: acknowledged });
    },
    onSuccess: version => {
      setStaged(null);
      setPicked(null);
      setSaveRequest(null);
      setSelectedId(version.id);
      setNotice(`已保存不可变版本「${version.label}」。原始文件与提取文本的摘要已固定。`);
      void cache.invalidateQueries({ queryKey: ['resume-versions'] });
      void cache.invalidateQueries({ queryKey: ['resume-version', version.id] });
    },
    onError: (failure: Error) => setError(failure.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.resumeDelete(id, { requestId: crypto.randomUUID(), confirmed: true }),
    onSuccess: result => {
      setSelectedId(null);
      setNotice(result.cancelledTaskIds.length
        ? `已删除该版本，并取消了 ${result.cancelledTaskIds.length} 个引用它的求职任务。${result.pendingCleanup ? '私有文件清理仍在后台排队。' : ''}`
        : `已删除该版本。${result.pendingCleanup ? '私有文件清理仍在后台排队。' : ''}`);
      void cache.invalidateQueries({ queryKey: ['resume-versions'] });
      void cache.invalidateQueries({ queryKey: ['career-tasks'] });
      void cache.invalidateQueries({ queryKey: ['career-session'] });
    },
    onError: (failure: Error) => setError(failure.message),
  });

  function pick(file: File | undefined) {
    setError('');
    setNotice('');
    if (!file) return;
    if (file.size > MAX_BYTES) { setError('简历文件不能超过 5 MB。'); return; }
    setPicked(file);
    upload.mutate(file);
  }
  /** Same content must reuse the accepted id; any edit needs a fresh request id because the payload hash changes. */
  function requestForSave() {
    const id = saveRequest ?? crypto.randomUUID();
    if (!saveRequest) setSaveRequest(id);
    return id;
  }
  function edit(patch: { label?: string; text?: string; acknowledged?: boolean }) {
    if (patch.label !== undefined) setLabel(patch.label);
    if (patch.text !== undefined) setText(patch.text);
    if (patch.acknowledged !== undefined) setAcknowledged(patch.acknowledged);
    setSaveRequest(crypto.randomUUID());
  }
  function abandon() {
    setStaged(null);
    setPicked(null);
    setText('');
    setLabel('');
    setAcknowledged(false);
    setSaveRequest(null);
    setError('');
    if (fileInput.current) fileInput.current.value = '';
  }
  const busy = upload.isPending || save.isPending || remove.isPending;
  const textProblem = text.trim().length < 20 ? '提取文本至少需要 20 个字符。' : text.length > MAX_TEXT ? `提取文本超过 ${MAX_TEXT} 个字符上限。` : '';
  const canSave = Boolean(staged) && !busy && !textProblem && (staged?.warnings.length ? acknowledged : true) && label.trim().length > 0;

  return <section className="career" aria-labelledby="resume-library-title">
    <div className="intro"><h1 id="resume-library-title">投递附件库</h1><p>保存用于投递的原始文件与不可变版本。JSON 简历及可编辑副本在“简历库”管理；这里的附件不会随副本编辑而改变。</p></div>

    <div className="career-card">
      <div className="form-heading"><h2>上传新版本</h2><span className="career-muted">PDF、DOCX、TXT 或 Markdown，最多 5 MB</span></div>
      <label htmlFor={`${field}-file`}>选择简历原始文件（只在本机解析，不会上传到 BOSS）</label>
      <input id={`${field}-file`} ref={fileInput} type="file" accept=".pdf,.docx,.txt,.md" disabled={busy} onChange={event => { pick(event.target.files?.[0]); }} />
      {upload.isPending ? <p role="status">正在本机提取简历文本…</p> : null}
      {staged ? <div className="resume-pair">
        <div className="resume-pair-head"><strong>{staged.filename}</strong><span>{kilobytes(staged.byteSize)} · 原始摘要 {shortHash(staged.attachmentSha256)}</span></div>
        <div className="panel-actions">
          {picked ? <Button onClick={() => { const url = URL.createObjectURL(picked); window.open(url, '_blank'); window.setTimeout(() => URL.revokeObjectURL(url), 60000); }}>在本页预览所选原始文件</Button> : null}
          <span className="career-muted">这个原始文件会作为外发附件；修正只改提取文本。</span>
        </div>
        {staged.warnings.length ? <div className="career-warnings" role="note"><strong>解析告警</strong>{staged.warnings.map(warning => <p key={warning}>{warning}</p>)}<Checkbox checked={acknowledged} onChange={event => edit({ acknowledged: event.target.checked })}>我已阅读并确认上述告警，仍要保存这个版本</Checkbox></div> : null}
        <label htmlFor={`${field}-label`}>版本名称（仅用于你自己区分版本）<Input id={`${field}-label`} maxLength={80} value={label} onChange={event => edit({ label: event.target.value })} /></label>
        <label htmlFor={`${field}-text`}>修正后的提取文本（会用于匹配与外发内容核对）<Input.TextArea id={`${field}-text`} rows={12} maxLength={MAX_TEXT} value={text} onChange={event => edit({ text: event.target.value })} /></label>
        <p className="storage-note">已输入 {text.length} / {MAX_TEXT} 个字符。保存后不能改写这个版本；需要改动请重新上传并保存新版本。</p>
        <div className="panel-actions"><Button onClick={abandon} disabled={busy}>放弃这次上传</Button><Button type="primary" loading={save.isPending} disabled={!canSave} onClick={() => save.mutate(requestForSave())}>{save.isPending ? '正在保存版本…' : '保存为不可变版本'}</Button></div>
        {textProblem ? <p role="alert" className="error">{textProblem}</p> : null}
      </div> : null}
    </div>

    {error ? <Alert type="error" showIcon message={error} action={<Button onClick={() => setError('')}>关闭提示</Button>} /> : null}
    {notice ? <p role="status">{notice}</p> : null}

    <div className="career-library">
      <div className="form-heading"><h2>已保存版本</h2><Button onClick={() => void versions.refetch()} disabled={versions.isFetching}>重新读取</Button></div>
      {versions.isPending ? <p role="status">正在读取简历版本…</p> : null}
      {versions.isError ? <Alert type="error" showIcon message={`简历库读取失败：${versions.error.message}`} action={<Button onClick={() => void versions.refetch()}>重试</Button>} /> : null}
      {versions.data && !versions.data.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有保存的简历版本。上传原始文件后会生成第一个版本。" /> : null}
      {versions.data?.length ? <ul className="career-library-list" aria-label="简历版本列表">
        {versions.data.map(version => <li key={version.id}>
          <button type="button" className={`career-library-item ${selectedId === version.id ? 'selected' : ''}`} aria-expanded={selectedId === version.id} onClick={() => setSelectedId(selectedId === version.id ? null : version.id)}>
            <strong>{version.label}</strong>
            <span>{version.originalName} · {kilobytes(version.byteSize)} · {new Date(version.createdAt).toLocaleString('zh-CN')}</span>
            <small>原始 {shortHash(version.attachmentSha256)} · 文本 {shortHash(version.textSha256)}{version.warnings.length ? ` · ${version.warnings.length} 条解析告警` : ''}</small>
          </button>
          {selectedId === version.id ? <div className="career-library-detail" aria-label={`版本 ${version.label} 详情`}>
            {detail.isPending ? <p role="status">正在读取版本文本…</p> : null}
            {detail.isError ? <Alert type="error" showIcon message={`版本读取失败：${detail.error.message}`} /> : null}
            {detail.data ? <>
              <div className="panel-actions">
                <Button onClick={() => void openResumeOriginal(version.id).catch((failure: Error) => setError(failure.message))}>在新标签预览原始文件</Button>
                <Button onClick={() => void downloadOriginal(version.id, version.originalName).catch((failure: Error) => setError(failure.message))}>下载原始文件</Button>
              </div>
              {detail.data.warnings.length ? <div className="career-warnings" role="note"><strong>保存时的解析告警</strong>{detail.data.warnings.map(warning => <p key={warning}>{warning}</p>)}</div> : null}
              <label htmlFor={`${field}-view-${version.id}`}>该版本的提取文本（只读，快照摘要 {shortHash(detail.data.textSha256)}）<Input.TextArea id={`${field}-view-${version.id}`} rows={12} readOnly value={detail.data.text} /></label>
              <Popconfirm
                title="删除这个简历版本？"
                description={<>会先取消并撤销引用它的求职任务与未开始的外发，删除派生备题、由这些备题保存到题库的题目，以及用它们开展的整个严格面试（含全部作答历史），并删除私有原始文件。已经发出的沟通或附件无法撤回。独立保存的 JD-only 备题、其他版本与其他面试不受影响。</>}
                okText="确认删除版本" cancelText="保留版本"
                onConfirm={() => remove.mutateAsync(version.id)}
              ><Button danger type="text" disabled={remove.isPending}>删除这个版本及派生数据</Button></Popconfirm>
            </> : null}
          </div> : null}
        </li>)}
      </ul> : null}
    </div>
    <p className="context-note">简历原文、原始文件与摘要保存在本机私有目录；它们不会进入备份、导出题单或任何公开经验库。</p>
  </section>;
}
