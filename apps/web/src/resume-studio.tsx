import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Selector } from '@astryxdesign/core/Selector';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from './api';
import { emptyResume, parseResumeDocument, resumeThemes, type ResumeDocument, type ResumeDraft } from '../../../packages/contracts/src/resume-document';
import { resumeVersionSaveSchema } from '../../../packages/contracts/src/career';
import example from '../../../packages/resume/example.json';
import { resumeHtml } from '../../../packages/resume/src/render';
import resumeCss from '../../../packages/resume/src/resume.css?raw';
import type { Route } from './navigation';
import { resumeLibraryTab } from './navigation';
import './resume-studio.css';
import { readSession, writeSession } from './storage';
import { ResumeLibrary } from './resume-library';
import { resumeFromText, resumeText } from '../../../packages/resume/src/import';
import { ConfirmAction } from './ui/confirm-action';

function download(filename: string, body: Blob) {
  const url = URL.createObjectURL(body);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const themeLabels: Record<(typeof resumeThemes)[number], string> = { minimal: '简洁', navy: '深蓝', ats: 'ATS 黑白', teal: '松石', graphite: '石墨', editorial: '酒红', green: '绿色' };
/** The contract's theme list owns the allowed set, so resolve the reported value instead of casting it. */
function knownTheme(value: string | undefined) {
  return resumeThemes.find(theme => theme === value) ?? null;
}
const editorSchema = z.object({ label: z.string(), json: z.string(), revision: z.number().int().positive() });
/** Keeps the open copy selected when switching to 投递附件 and back; the menu entry still opens the empty editor. */
const lastDraftKey = 'resume-library-draft';
function readEditor(draft: ResumeDraft) {
  try { return editorSchema.parse(JSON.parse(sessionStorage.getItem(`resume-editor-${draft.id}`) ?? 'null')); }
  catch { return { label: draft.label, json: JSON.stringify(draft.document, null, 2), revision: draft.revision }; }
}
function errorMessage(error: unknown) {
  return error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.') || 'JSON'}：${issue.message}`).join('；') : error instanceof Error ? error.message : '操作失败，请重试。';
}
type ResumeStudioProps = { route: Route; navigate: (route: Route) => void; onPractice: (document: ResumeDocument) => void; onPreparation: (document: ResumeDocument) => void };
/** One resume library with two views: editable JSON copies and the immutable attachment versions. */
export function ResumeStudio(props: ResumeStudioProps) {
  const tab = resumeLibraryTab(props.route.page);
  function switchTab(value: string) {
    if (value === 'attachments') {
      writeSession(lastDraftKey, props.route.resumeId ?? null);
      props.navigate({ page: 'resumeLibrary' });
      return;
    }
    const last = readSession(lastDraftKey);
    props.navigate({ page: 'resumeStudio', ...(last ? { resumeId: last } : {}) });
  }
  return <section className="resume-studio" aria-labelledby="resume-studio-title">
    <div className="panel-heading"><div><h1 id="resume-studio-title">简历库</h1><p>可编辑的 JSON 简历副本，以及随投递固定下来的不可变附件版本，都在这一个入口管理。</p></div></div>
    <div className="resume-library-tabs">
      <TabList role="tablist" value={tab} onChange={switchTab} aria-label="简历库视图">
        <Tab id="resume-library-tab-editor" value="editor" label="简历编辑" panelId="resume-library-panel-editor" />
        <Tab id="resume-library-tab-attachments" value="attachments" label="投递附件" panelId="resume-library-panel-attachments" />
      </TabList>
    </div>
    <div id="resume-library-panel-editor" role="tabpanel" aria-labelledby="resume-library-tab-editor" hidden={tab !== 'editor'}>
      {tab === 'editor' ? <ResumeLibraryEditor {...props} /> : null}
    </div>
    <div id="resume-library-panel-attachments" role="tabpanel" aria-labelledby="resume-library-tab-attachments" hidden={tab !== 'attachments'}>
      <ResumeLibrary />
    </div>
  </section>;
}
function ResumeLibraryEditor({ route, navigate, onPractice, onPreparation }: ResumeStudioProps) {
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
  // Card summaries omit the document, so the confirmed handoff reads the saved copy and refuses out-of-range text instead of truncating.
  const handoff = useMutation({ mutationFn: async ({ id, mode }: { id: string; mode: 'practice' | 'preparation' }) => {
    const draft = await api.resumeDraft(id);
    const length = resumeText(draft.document).trim().length;
    if (length < 20) throw new Error(`「${draft.label}」整理后只有 ${length} 字，至少需要 20 字，未带入，已有资料保持不变。`);
    if (length > 16000) throw new Error(`「${draft.label}」有 ${length} 字，超过 16000 字上限，未带入；请先整理，不会自动截断。`);
    return { document: draft.document, mode };
  }, onError: (failure: Error) => setImportError(failure.message), onSuccess: ({ document, mode }) => { setImportError(''); if (mode === 'practice') onPractice(document); else onPreparation(document); } });
  return <>
    <div className="resume-studio-actions"><FileInput label="导入简历文件" accept=".pdf,.docx,.txt,.md" value={null} isDisabled={upload.isPending || create.isPending} onChange={files => { const file = Array.isArray(files) ? files[0] : files; if (file) upload.mutate(file); }} />{upload.isPending ? <span role="status">正在本机解析文件…</span> : <span className="context-note">PDF / DOCX / TXT / Markdown → 核对文本 → JSON 入库</span>}</div>
    {upload.error ? <Banner role="alert" status="error" title={upload.error.message} endContent={<Button label="重试解析" onClick={() => upload.variables && upload.mutate(upload.variables)} />} /> : null}
    <Dialog className="resume-import-dialog" isOpen={Boolean(source)} width={760} onOpenChange={isOpen => { if (!isOpen) setSource(null); }}>
      <DialogHeader title="核对导入内容" onOpenChange={isOpen => { if (!isOpen) setSource(null); }} />
      {source ? <><p>本机转换将完整原文保存在 JSON 中，明确标注的姓名与目标岗位会带入对应字段；其他内容放入简介，可在入库后逐段整理。</p>{source.warnings.map((warning, index) => <Banner role="alert" key={index} status="warning" title={warning} />)}<TextInput label="简历名称" value={source.label} onChange={value => setSource({ ...source, label: value.slice(0, 100) })} /><TextArea label="提取原文" value={source.text} rows={12} maxLength={64000} onChange={value => setSource({ ...source, text: value })} />{create.error ? <Banner role="alert" status="error" title={create.error.message} /> : null}
        <div className="panel-actions">
          <Button label="取消导入" onClick={() => setSource(null)} />
          <Button variant="primary" isLoading={create.isPending} isDisabled={!source.label.trim() || !source.text.trim()} label="转换并存入简历库" onClick={() => add(source.label, resumeFromText(source))} />
        </div>
      </> : null}
    </Dialog>
    <div className="resume-studio-actions"><Button variant="primary" isDisabled={create.isPending} label="新建空白简历" onClick={() => add('未命名简历', emptyResume)} /><Button isDisabled={create.isPending} label="从示例开始" onClick={() => add('示例简历', parseResumeDocument(example))} /><FileInput label="导入简历 JSON" accept=".json,application/json" value={null} isDisabled={create.isPending} onChange={files => {
      const file = Array.isArray(files) ? files[0] : files; if (!file) return;
      if (file.size > 900 * 1024) { setImportError('JSON 文件不能超过 900 KB。'); return; }
      void file.text().then(raw => add(file.name.replace(/\.json$/i, '').slice(0, 100) || '导入的简历', parseResumeDocument(JSON.parse(raw)))).catch(error => setImportError(errorMessage(error)));
    }} />{create.isPending ? <span role="status">正在创建副本…</span> : null}</div>
    {importError ? <Banner role="alert" status="error" title={importError} /> : null}
    {create.error ? <Banner role="alert" status="error" title={create.error.message} endContent={<Button label="重试创建" onClick={() => create.variables && create.mutate(create.variables)} />} /> : null}
    <div className="resume-studio-layout"><aside className="resume-copies" aria-label="简历副本列表"><h2>我的副本 <Badge label={list.data?.length ?? 0} /></h2><TextInput label="查找简历副本" isLabelHidden placeholder="按名称查找" value={search} onChange={value => setSearch(value)} hasClear />
      {list.isPending ? <Spinner label="正在读取简历副本" /> : null}
      {list.error ? <Banner role="alert" status="error" title={list.error.message} endContent={<Button label="重新读取" onClick={() => void list.refetch()} />} /> : null}
      {list.data?.filter(item => item.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(item => <div key={item.id}><Button className={`resume-copy ${item.id === route.resumeId ? 'selected' : ''}`} label={`${item.label}，修订 ${item.revision}`} onClick={() => navigate({ page: 'resumeStudio', resumeId: item.id })} aria-current={item.id === route.resumeId ? 'page' : undefined}><strong>{item.label}</strong><small>修订 {item.revision} · {new Date(item.updatedAt).toLocaleDateString('zh-CN')}</small></Button><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <ConfirmAction title={`用「${item.label}」准备面试？`} description="带入已保存的简历文本，覆盖面试准备页尚未提交的输入（含已填写的岗位与 JD）；历史面试保持原快照。" okText="确认带入" confirmVariant="primary" cancelText="取消带入" onConfirm={() => handoff.mutateAsync({ id: item.id, mode: 'practice' })}><Button size="sm" label={`带入面试：${item.label}`} isDisabled={handoff.isPending} /></ConfirmAction>
        <ConfirmAction title={`将「${item.label}」带入 JD 备题？`} description="带入已保存的简历文本与简历目标岗位，作为后续练习资料；JD 与题量仍由你在备题页填写。" okText="确认带入" confirmVariant="primary" cancelText="取消带入" onConfirm={() => handoff.mutateAsync({ id: item.id, mode: 'preparation' })}><Button size="sm" label={`带入备题：${item.label}`} isDisabled={handoff.isPending} /></ConfirmAction>
      </div></div>)}
      {handoff.isPending ? <span role="status">正在读取所选副本…</span> : null}
      {list.data && !list.data.length ? <p className="quiet">从空白或虚构示例开始，也可导入 cool-resume 的版本 JSON。</p> : null}
    </aside><div className="resume-editor-area">
      {!route.resumeId ? <EmptyState title="还没有打开任何副本" description="选择一个副本，或新建你的第一份简历。" /> : detail.isPending ? <p role="status">正在读取简历…</p> : detail.error ? <Banner role="alert" status="error" title={detail.error.message} endContent={<Button label="重试读取" onClick={() => void detail.refetch()} />} /> : detail.data ? <ResumeEditor onPractice={onPractice} key={detail.data.id} draft={detail.data} onCopy={add} copying={create.isPending} onDeleted={() => { writeSession(lastDraftKey, null); navigate({ page: 'resumeStudio' }); }} onLibrary={() => { writeSession(lastDraftKey, detail.data?.id ?? null); navigate({ page: 'resumeLibrary' }); }} /> : null}
    </div></div>
    <p className="context-note">已保存副本存放在本机服务中，按当前浏览器身份隔离。JSON 和导出文件包含你的个人资料，请自行保管。编辑不会修改已经保存的投递附件。</p>
  </>;
}
function ResumeEditor({ draft, onCopy, copying, onDeleted, onLibrary, onPractice }: { draft: ResumeDraft; onCopy: (label: string, document: ResumeDocument) => void; copying: boolean; onDeleted: () => void; onLibrary: () => void; onPractice: (document: ResumeDocument) => void }) {
  const cache = useQueryClient();
  const [editor, setEditor] = useState(() => readEditor(draft));
  const [base, setBase] = useState(draft);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(draft.document);
  const [tab, setTab] = useState<'split' | 'preview'>('split');
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
    sessionStorage.removeItem(`resume-editor-${draft.id}`); sessionStorage.removeItem(`resume-publication-${draft.id}`); if (readSession(lastDraftKey) === draft.id) writeSession(lastDraftKey, null); cache.removeQueries({ queryKey: ['resume-draft', draft.id] }); void cache.invalidateQueries({ queryKey: ['resume-drafts'] }); onDeleted();
  } });
  const exportPdf = useMutation({ mutationFn: async () => { const file = await api.resumeDraftPdf(draft.id, base.revision); download(file.filename, file.body); } });
  const publish = useMutation({ mutationFn: async () => {
    let input = pendingVersion;
    if (!input) {
      const file = await api.resumeDraftPdf(draft.id, base.revision);
      const upload = await api.resumeUpload(new File([file.body], file.filename, { type: 'application/pdf' }));
      if (upload.warnings.length) throw new Error(`PDF 提取需要人工校正：${upload.warnings.join('；')}。请下载 PDF 后在简历库的“投递附件”中上传并校正。`);
      input = { requestId: crypto.randomUUID(), stagingId: upload.stagingId, label: `${base.label.slice(0, 60)} · 修订 ${base.revision}`, text: upload.text, warningsAcknowledged: true };
      rememberPublication(input);
    }
    return api.resumeSave(input);
  }, onSuccess: () => { rememberPublication(null); void cache.invalidateQueries({ queryKey: ['resume-versions'] }); setNotice('已将生成的 PDF 保存为不可变投递版本，可在简历库的“投递附件”中核对。'); } });
  const busy = save.isPending || remove.isPending || exportPdf.isPending || publish.isPending;
  const exportDisabled = dirty || busy || Boolean(parsed.error);
  return <div className="resume-editor">
    <div className="resume-studio-actions"><ConfirmAction title="用这份简历准备面试？" description="将带入已保存的简历，并替换当前未提交的面试准备资料。历史面试不受影响。" okText="带入面试" confirmVariant="primary" cancelText="保留当前资料" onConfirm={() => onPractice(base.document)}><Button variant="primary" label="用于面试" isDisabled={dirty || busy || resumeText(base.document).length > 16000 || resumeText(base.document).length < 20} /></ConfirmAction><span className="context-note">保存后可带入面试（简历文本需 20–16000 字）。</span></div>
    <div className="resume-name-row">{/* TextInput has no maxLength prop, so the field keeps its 100 character contract limit while typing. */}
    <TextInput label="副本名称" value={editor.label} isDisabled={busy} onChange={value => setEditor({ ...editor, label: value.slice(0, 100) })} /><Badge variant={dirty ? 'orange' : 'success'} label={dirty ? '有未保存修改' : `已保存 · 修订 ${base.revision}`} /></div>
    <div className="resume-studio-actions"><Button label="保存修改" variant="primary" isLoading={save.isPending} isDisabled={busy || !dirty || !editor.label.trim() || !parsed.data} onClick={() => save.mutate()} /><Button label="另存为副本" isDisabled={busy || copying || !parsed.data || !editor.label.trim()} onClick={() => parsed.data && onCopy(`${editor.label.slice(0, 95)} 副本`, parsed.data)} /><Button label="导出 JSON" isDisabled={busy || !parsed.data} onClick={() => parsed.data && download(`${editor.label || 'resume'}.json`, new Blob([JSON.stringify(parsed.data, null, 2)], { type: 'application/json' }))} /><Button label="导出 HTML" isDisabled={busy || !parsed.data} onClick={() => download(`${editor.label || 'resume'}.html`, new Blob([html], { type: 'text/html' }))} /><Button label="导出 PDF" isLoading={exportPdf.isPending} isDisabled={exportDisabled} onClick={() => exportPdf.mutate()} /><Button label="保存为投递版本" isLoading={publish.isPending} isDisabled={exportDisabled} onClick={() => publish.mutate()} /></div>
    {dirty ? <p className="context-note">PDF 和投递版本使用已保存的修订，请先保存。切换页面后，当前标签页会保留未保存的 JSON。</p> : null}
    {notice ? <Banner role="alert" status="info" title={notice} endContent={notice.startsWith('已将') ? <Button label="查看投递附件" onClick={onLibrary} /> : undefined} /> : null}
    {[save.error, remove.error, exportPdf.error, publish.error].filter(Boolean).map((error, index) => <Banner role="alert" key={index} status="error" title={error?.message} />)}
    {pendingVersion ? <p role="status">投递版本“{pendingVersion.label}”的保存请求待确认。<Button isDisabled={busy} label="重试这个投递版本请求" onClick={() => publish.mutate()} /></p> : null}
    <div className="resume-name-row"><Selector label="简历主题" value={preview.theme ?? 'minimal'} isDisabled={!parsed.data || busy} options={resumeThemes.map(value => ({ value, label: themeLabels[value] }))} onChange={value => { const theme = knownTheme(value); if (theme && parsed.data) setEditor({ ...editor, json: JSON.stringify({ ...parsed.data, theme }, null, 2) }); }} /><ConfirmAction title="重新读取已保存内容？" description="这会替换当前未保存的修改。可以先导出 JSON 或另存副本。" okText="重新读取" confirmVariant="primary" cancelText="保留编辑" onConfirm={async () => { const next = await api.resumeDraft(draft.id); setBase(next); setEditor({ label: next.label, json: JSON.stringify(next.document, null, 2), revision: next.revision }); }}><Button isDisabled={busy} label="重新读取" /></ConfirmAction><ConfirmAction title="删除这个 JSON 简历副本？" description="仅删除当前副本及本标签页草稿，其他副本、已保存的投递附件和旧任务仍然保留。" okText="删除副本" cancelText="保留" onConfirm={() => remove.mutateAsync()}><Button variant="destructive" isDisabled={busy} label="删除副本" /></ConfirmAction></div>
    <TabList value={tab} onChange={value => setTab(value === 'preview' ? 'preview' : 'split')} aria-label="简历编辑视图">
      <Tab id="resume-tab-split" value="split" label="编辑与预览" panelId="resume-panel-split" />
      <Tab id="resume-tab-preview" value="preview" label="完整预览" panelId="resume-panel-preview" />
    </TabList>
    <div id="resume-panel-split" role="tabpanel" aria-labelledby="resume-tab-split" hidden={tab !== 'split'}>{tab === 'split' ? <div className="resume-edit-preview"><div><TextArea label="简历 JSON" aria-describedby="resume-json-help" hasSpellCheck={false} value={editor.json} isDisabled={busy} onChange={value => setEditor({ ...editor, json: value })} /><p id="resume-json-help" className="context-note">支持 cool-resume v3 / v2 JSON；可调整 order 与 style.spacing。文本支持 **加粗**、*斜体*、==高亮== 和 &lt;br&gt;。</p>{parsed.error ? <Banner role="alert" status="error" title={parsed.error} description="编辑内容已保留，预览暂时显示最后一次有效内容。" /> : null}</div><ResumePreview html={html} /></div> : null}</div>
    <div id="resume-panel-preview" role="tabpanel" aria-labelledby="resume-tab-preview" hidden={tab !== 'preview'}>{tab === 'preview' ? <ResumePreview html={html} /> : null}</div>
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
  return <div className="resume-preview"><div className="resume-preview-tools"><span>A4 预览</span><Button size="sm" label={fit ? '查看原始大小' : '适应宽度'} onClick={() => setFit(value => !value)} /></div><div className="resume-preview-scroll" ref={container}><div style={{ position: 'relative', width: fit ? '100%' : 794, height: 1123 * scale }}><iframe title="简历 A4 预览" sandbox="" srcDoc={html} style={{ position: 'absolute', top: 0, left: 0, width: 794, height: 1123, transform: `scale(${scale})`, transformOrigin: 'top left' }} /></div></div></div>;
}
