import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Modal, Popconfirm, Select, Spin, Tabs, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './api';
import { emptyResume, parseResumeDocument, resumeThemes, type ResumeDocument, type ResumeDraft } from '../../../packages/contracts/src/resume-document';
import { resumeVersionSaveSchema } from '../../../packages/contracts/src/career';
import example from '../../../packages/resume/example.json';
import { resumeHtml } from '../../../packages/resume/src/render';
import resumeCss from '../../../packages/resume/src/resume.css?raw';
import type { Route } from './navigation';
import './resume-studio.css';
import { resumeFromText, resumeText } from '../../../packages/resume/src/import';

function download(filename: string, body: Blob) {
  const url = URL.createObjectURL(body);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const editorSchema = z.object({ label: z.string(), json: z.string(), revision: z.number().int().positive() });
function readEditor(draft: ResumeDraft) {
  try { return editorSchema.parse(JSON.parse(sessionStorage.getItem(`resume-editor-${draft.id}`) ?? 'null')); }
  catch { return { label: draft.label, json: JSON.stringify(draft.document, null, 2), revision: draft.revision }; }
}
function errorMessage(error: unknown) {
  return error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.') || 'JSON'}：${issue.message}`).join('；') : error instanceof Error ? error.message : '操作失败，请重试。';
}
export function ResumeStudio({ route, navigate, onPractice }: { route: Route; navigate: (route: Route) => void; onPractice: (document: ResumeDocument) => void }) {
  const cache = useQueryClient();
  const [search, setSearch] = useState('');
  const [importError, setImportError] = useState('');
  const [source, setSource] = useState<{ filename: string; text: string; warnings: string[]; label: string } | null>(null);
  const upload = useMutation({ mutationFn: api.importResume, onSuccess: (result, file) => { setImportError(''); setSource({ ...result, filename: file.name, label: file.name.replace(/\.[^.]+$/, '').slice(0, 100) }); } });
  const list = useQuery({ queryKey: ['resume-drafts'], queryFn: api.resumeDrafts });
  const detail = useQuery({ queryKey: ['resume-draft', route.resumeId], queryFn: () => api.resumeDraft(route.resumeId ?? ''), enabled: Boolean(route.resumeId), refetchOnWindowFocus: false });
  const create = useMutation({ mutationFn: api.createResumeDraft, onSuccess: draft => {
    setSource(null);
    cache.setQueryData(['resume-draft', draft.id], draft); void cache.invalidateQueries({ queryKey: ['resume-drafts'] });
    navigate({ page: 'resumeStudio', resumeId: draft.id });
  } });
  function add(label: string, document: ResumeDocument) { setImportError(''); create.mutate({ id: crypto.randomUUID(), label, document }); }
  return <section className="resume-studio" aria-labelledby="resume-studio-title">
    <div className="panel-heading"><div><h1 id="resume-studio-title">简历库</h1><p>导入已有简历，整理为 JSON；为不同岗位保存副本，再用于面试或导出投递附件。</p></div><Button onClick={() => navigate({ page: 'resumeLibrary' })}>查看投递附件库</Button></div>
    <div className="resume-studio-actions"><label className="resume-import-label">导入简历文件<input type="file" accept=".pdf,.docx,.txt,.md" aria-label="导入简历文件" disabled={upload.isPending || create.isPending} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) upload.mutate(file); }} /></label>{upload.isPending ? <span role="status">正在本机解析文件…</span> : <span className="context-note">PDF / DOCX / TXT / Markdown → 核对文本 → JSON 入库</span>}</div>
    {upload.error ? <Alert type="error" message={upload.error.message} action={<Button onClick={() => upload.variables && upload.mutate(upload.variables)}>重试解析</Button>} /> : null}
    <Modal className="resume-import-dialog" title="核对导入内容" open={Boolean(source)} onCancel={() => setSource(null)} okText="转换并存入简历库" confirmLoading={create.isPending} okButtonProps={{ disabled: !source?.label.trim() || !source?.text.trim() }} onOk={() => { if (source) add(source.label, resumeFromText(source)); }} width={760}>
      {source ? <><p>本机转换将完整原文保存在 JSON 中，明确标注的姓名与目标岗位会带入对应字段；其他内容放入简介，可在入库后逐段整理。</p>{source.warnings.map((warning, index) => <Alert key={index} type="warning" message={warning} />)}<label>简历名称<Input aria-label="导入简历名称" maxLength={100} value={source.label} onChange={event => setSource({ ...source, label: event.target.value })} /></label><label>提取原文<Input.TextArea aria-label="提取原文" value={source.text} rows={12} maxLength={64000} onChange={event => setSource({ ...source, text: event.target.value })} /></label>{create.error ? <Alert type="error" message={create.error.message} /> : null}</> : null}
    </Modal>
    <div className="resume-studio-actions"><Button type="primary" disabled={create.isPending} onClick={() => add('未命名简历', emptyResume)}>新建空白简历</Button><Button disabled={create.isPending} onClick={() => add('示例简历', parseResumeDocument(example))}>从示例开始</Button><label className="resume-import-label">导入 JSON<input type="file" accept=".json,application/json" disabled={create.isPending} aria-label="导入简历 JSON" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      if (file.size > 900 * 1024) { setImportError('JSON 文件不能超过 900 KB。'); return; }
      void file.text().then(raw => add(file.name.replace(/\.json$/i, '').slice(0, 100) || '导入的简历', parseResumeDocument(JSON.parse(raw)))).catch(error => setImportError(errorMessage(error)));
    }} /></label>{create.isPending ? <span role="status">正在创建副本…</span> : null}</div>
    {importError ? <Alert type="error" showIcon message={importError} /> : null}
    {create.error ? <Alert type="error" message={create.error.message} action={<Button onClick={() => create.variables && create.mutate(create.variables)}>重试创建</Button>} /> : null}
    <div className="resume-studio-layout"><aside className="resume-copies" aria-label="简历副本列表"><h2>我的副本 <Tag>{list.data?.length ?? 0}</Tag></h2><Input aria-label="查找简历副本" placeholder="按名称查找" value={search} onChange={event => setSearch(event.target.value)} allowClear />
      {list.isPending ? <Spin tip="正在读取简历副本" /> : null}
      {list.error ? <Alert type="error" message={list.error.message} action={<Button onClick={() => void list.refetch()}>重新读取</Button>} /> : null}
      {list.data?.filter(item => item.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(item => <Button className={`resume-copy ${item.id === route.resumeId ? 'selected' : ''}`} key={item.id} onClick={() => navigate({ page: 'resumeStudio', resumeId: item.id })} aria-current={item.id === route.resumeId ? 'page' : undefined}><strong>{item.label}</strong><small>修订 {item.revision} · {new Date(item.updatedAt).toLocaleDateString('zh-CN')}</small></Button>)}
      {list.data && !list.data.length ? <p className="quiet">从空白或虚构示例开始，也可导入 cool-resume 的版本 JSON。</p> : null}
    </aside><div className="resume-editor-area">
      {!route.resumeId ? <Empty description="选择一个副本，或新建你的第一份简历。" /> : detail.isPending ? <p role="status">正在读取简历…</p> : detail.error ? <Alert type="error" message={detail.error.message} action={<Button onClick={() => void detail.refetch()}>重试读取</Button>} /> : detail.data ? <ResumeEditor onPractice={onPractice} key={detail.data.id} draft={detail.data} onCopy={add} copying={create.isPending} onDeleted={() => navigate({ page: 'resumeStudio' })} onLibrary={() => navigate({ page: 'resumeLibrary' })} /> : null}
    </div></div>
    <p className="context-note">已保存副本存放在本机服务中，按当前浏览器身份隔离。JSON 和导出文件包含你的个人资料，请自行保管。编辑不会修改已经保存的投递附件。</p>
  </section>;
}
function ResumeEditor({ draft, onCopy, copying, onDeleted, onLibrary, onPractice }: { draft: ResumeDraft; onCopy: (label: string, document: ResumeDocument) => void; copying: boolean; onDeleted: () => void; onLibrary: () => void; onPractice: (document: ResumeDocument) => void }) {
  const cache = useQueryClient();
  const [editor, setEditor] = useState(() => readEditor(draft));
  const [base, setBase] = useState(draft);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(draft.document);
  const [pendingVersion, setPendingVersion] = useState<z.infer<typeof resumeVersionSaveSchema> | null>(() => {
    try { return resumeVersionSaveSchema.parse(JSON.parse(sessionStorage.getItem(`resume-publication-${draft.id}`) ?? 'null')); } catch { return null; }
  });
  function rememberPublication(input: z.infer<typeof resumeVersionSaveSchema> | null) {
    setPendingVersion(input);
    try {
      if (input) sessionStorage.setItem(`resume-publication-${draft.id}`, JSON.stringify(input));
      else sessionStorage.removeItem(`resume-publication-${draft.id}`);
    } catch { setNotice('当前标签页无法暂存投递版本请求。请在本页确认保存结果后再离开。'); }
  }
  const parsed = useMemo(() => {
    try { return { data: parseResumeDocument(JSON.parse(editor.json)), error: '' }; }
    catch (error) { return { data: null, error: errorMessage(error) }; }
  }, [editor.json]);
  useEffect(() => { if (parsed.data) setPreview(parsed.data); }, [parsed.data]);
  useEffect(() => {
    try { sessionStorage.setItem(`resume-editor-${draft.id}`, JSON.stringify(editor)); }
    catch { setNotice('当前标签页无法暂存编辑，请及时保存或导出 JSON。'); }
  }, [draft.id, editor]);
  const dirty = editor.label !== base.label || editor.json !== JSON.stringify(base.document, null, 2) || editor.revision !== base.revision;
  const html = useMemo(() => resumeHtml(preview, resumeCss), [preview]);
  const save = useMutation({ mutationFn: async () => {
    if (!parsed.data) throw new Error(parsed.error);
    return api.updateResumeDraft(draft.id, { label: editor.label, document: parsed.data, revision: editor.revision });
  }, onSuccess: next => {
    setBase(next); setEditor({ label: next.label, json: JSON.stringify(next.document, null, 2), revision: next.revision });
    cache.setQueryData(['resume-draft', next.id], next); void cache.invalidateQueries({ queryKey: ['resume-drafts'] }); setNotice('简历副本已保存。');
  } });
  const remove = useMutation({ mutationFn: () => api.deleteResumeDraft(draft.id, base.revision), onSuccess: () => {
    sessionStorage.removeItem(`resume-editor-${draft.id}`); sessionStorage.removeItem(`resume-publication-${draft.id}`); cache.removeQueries({ queryKey: ['resume-draft', draft.id] }); void cache.invalidateQueries({ queryKey: ['resume-drafts'] }); onDeleted();
  } });
  const exportPdf = useMutation({ mutationFn: async () => { const file = await api.resumeDraftPdf(draft.id, base.revision); download(file.filename, file.body); } });
  const publish = useMutation({ mutationFn: async () => {
    let input = pendingVersion;
    if (!input) {
      const file = await api.resumeDraftPdf(draft.id, base.revision);
      const upload = await api.resumeUpload(new File([file.body], file.filename, { type: 'application/pdf' }));
      if (upload.warnings.length) throw new Error(`PDF 提取需要人工校正：${upload.warnings.join('；')}。请下载 PDF 后在投递附件库中上传并校正。`);
      input = { requestId: crypto.randomUUID(), stagingId: upload.stagingId, label: `${base.label.slice(0, 60)} · 修订 ${base.revision}`, text: upload.text, warningsAcknowledged: true };
      rememberPublication(input);
    }
    return api.resumeSave(input);
  }, onSuccess: () => { rememberPublication(null); void cache.invalidateQueries({ queryKey: ['resume-versions'] }); setNotice('已将生成的 PDF 保存为不可变投递版本，可前往投递附件库核对。'); } });
  const busy = save.isPending || remove.isPending || exportPdf.isPending || publish.isPending;
  const exportDisabled = dirty || busy || Boolean(parsed.error);
  return <div className="resume-editor">
    <div className="resume-studio-actions"><Popconfirm title="用这份简历准备面试？" description="将带入已保存的简历，并替换当前未提交的面试准备资料。历史面试不受影响。" okText="带入面试" cancelText="保留当前资料" onConfirm={() => onPractice(base.document)}><Button type="primary" disabled={dirty || busy || resumeText(base.document).length > 16000 || resumeText(base.document).length < 20}>用于面试</Button></Popconfirm><span className="context-note">保存后可带入面试（简历文本需 20–16000 字）。</span></div>
    <div className="resume-name-row"><label htmlFor="resume-copy-label"><span>副本名称</span><Input id="resume-copy-label" value={editor.label} maxLength={100} disabled={busy} onChange={event => setEditor({ ...editor, label: event.target.value })} /></label><Tag color={dirty ? 'orange' : 'green'}>{dirty ? '有未保存修改' : `已保存 · 修订 ${base.revision}`}</Tag></div>
    <div className="resume-studio-actions"><Button aria-label="保存修改" type="primary" loading={save.isPending} disabled={busy || !dirty || !editor.label.trim() || !parsed.data} onClick={() => save.mutate()}>保存修改</Button><Button disabled={busy || copying || !parsed.data || !editor.label.trim()} onClick={() => parsed.data && onCopy(`${editor.label.slice(0, 95)} 副本`, parsed.data)}>另存为副本</Button><Button disabled={busy || !parsed.data} onClick={() => parsed.data && download(`${editor.label || 'resume'}.json`, new Blob([JSON.stringify(parsed.data, null, 2)], { type: 'application/json' }))}>导出 JSON</Button><Button disabled={busy || !parsed.data} onClick={() => download(`${editor.label || 'resume'}.html`, new Blob([html], { type: 'text/html' }))}>导出 HTML</Button><Button aria-label="导出 PDF" loading={exportPdf.isPending} disabled={exportDisabled} onClick={() => exportPdf.mutate()}>导出 PDF</Button><Button aria-label="保存为投递版本" loading={publish.isPending} disabled={exportDisabled} onClick={() => publish.mutate()}>保存为投递版本</Button></div>
    {dirty ? <p className="context-note">PDF 和投递版本使用已保存的修订，请先保存。切换页面后，当前标签页会保留未保存的 JSON。</p> : null}
    {notice ? <Alert type="info" message={notice} action={notice.startsWith('已将') ? <Button onClick={onLibrary}>查看附件库</Button> : undefined} /> : null}
    {[save.error, remove.error, exportPdf.error, publish.error].filter(Boolean).map((error, index) => <Alert key={index} type="error" message={error?.message} />)}
    {pendingVersion ? <p role="status">投递版本“{pendingVersion.label}”的保存请求待确认。<Button disabled={busy} onClick={() => publish.mutate()}>重试这个投递版本请求</Button></p> : null}
    <div className="resume-name-row"><label><span>简历主题</span><Select aria-label="简历主题" value={preview.theme ?? 'minimal'} disabled={!parsed.data || busy} options={resumeThemes.map(value => ({ value, label: ({ minimal: '简洁', navy: '深蓝', ats: 'ATS 黑白', teal: '松石', graphite: '石墨', editorial: '酒红', green: '绿色' })[value] }))} onChange={theme => parsed.data && setEditor({ ...editor, json: JSON.stringify({ ...parsed.data, theme }, null, 2) })} /></label><Popconfirm title="重新读取已保存内容？" description="这会替换当前未保存的修改。可以先导出 JSON 或另存副本。" okText="重新读取" cancelText="保留编辑" onConfirm={async () => { const next = await api.resumeDraft(draft.id); setBase(next); setEditor({ label: next.label, json: JSON.stringify(next.document, null, 2), revision: next.revision }); }}><Button disabled={busy}>重新读取</Button></Popconfirm><Popconfirm title="删除这个 JSON 简历副本？" description="仅删除当前副本及本标签页草稿，其他副本、已保存的投递附件和旧任务仍然保留。" okText="删除副本" cancelText="保留" onConfirm={() => remove.mutateAsync()}><Button danger disabled={busy}>删除副本</Button></Popconfirm></div>
    <Tabs defaultActiveKey="split" items={[{ key: 'split', label: '编辑与预览', children: <div className="resume-edit-preview"><div><label htmlFor="resume-json">简历 JSON</label><Input.TextArea id="resume-json" aria-describedby="resume-json-help" spellCheck={false} value={editor.json} disabled={busy} onChange={event => setEditor({ ...editor, json: event.target.value })} /><p id="resume-json-help" className="context-note">支持 cool-resume v3 / v2 JSON；可调整 order 与 style.spacing。文本支持 **加粗**、*斜体*、==高亮== 和 &lt;br&gt;。</p>{parsed.error ? <Alert type="error" message={parsed.error} description="编辑内容已保留，预览暂时显示最后一次有效内容。" /> : null}</div><ResumePreview html={html} /></div> }, { key: 'preview', label: '完整预览', children: <ResumePreview html={html} /> }]} />
  </div>;
}
function ResumePreview({ html }: { html: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(794);
  const [fit, setFit] = useState(true);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => { const entry = entries[0]; if (entry) setWidth(entry.contentRect.width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = fit ? Math.min(1, width / 794) : 1;
  return <div className="resume-preview"><div className="resume-preview-tools"><span>A4 预览</span><Button size="small" onClick={() => setFit(value => !value)}>{fit ? '查看原始大小' : '适应宽度'}</Button></div><div className="resume-preview-scroll" ref={container}><div style={{ position: 'relative', width: fit ? '100%' : 794, height: 1123 * scale }}><iframe title="简历 A4 预览" sandbox="" srcDoc={html} style={{ position: 'absolute', top: 0, left: 0, width: 794, height: 1123, transform: `scale(${scale})`, transformOrigin: 'top left' }} /></div></div></div>;
}
