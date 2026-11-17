import { useState, useSyncExternalStore } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { FileInput } from '@astryxdesign/core/FileInput';
import { Selector } from '@astryxdesign/core/Selector';
import { workspaceCategories, workspaceCategoryLabels, type WorkspaceCategory } from '../../../packages/contracts/src/workspace';
import {
  clearWorkspaceCategory, createWorkspaceBackup, flushWorkspace, getWorkspaceSnapshot, previewWorkspaceImport,
  resolveWorkspaceConflict, restoreWorkspaceBackup, retryWorkspaceSaves, subscribeWorkspace, type WorkspaceImportPreview,
} from './workspace-store';
import { ConfirmAction } from './ui/confirm-action';
import './workspace.css';

function downloadBackup(includeSensitive: boolean) {
  const backup = createWorkspaceBackup(includeSensitive);
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url;
  link.download = `interview-workspace-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
}
function recordLabel(key: string) {
  if (key.startsWith('answer-')) return '未提交答案';
  const labels: Record<string, string> = {
    'interview-intake': '新建面试资料', 'interview-selected': '上次面试位置', 'jd-preparation-v1': 'JD 与备题单',
    'algorithm-practice-v1': '套路跟打草稿', 'hot100-practice-v1': 'Hot 100 作答与进度', 'algorithm-view': '算法页面偏好',
    'job-profiles-v1': '岗位资料档案', 'review-list-v1': '面试复习清单', 'workspace-route': '上次页面位置',
  };
  return labels[key] ?? '本机记录';
}
/** Selector reports a plain string; the category list owns the allowed set, so resolve instead of casting. */
function knownCategory(value: string): WorkspaceCategory | null {
  return workspaceCategories.find(category => category === value) ?? null;
}
export function WorkspaceSaveStatus({ onOpenData }: { onOpenData: () => void }) {
  const snapshot = useSyncExternalStore(subscribeWorkspace, getWorkspaceSnapshot);
  const messages = { saving: '正在保存到本机…', saved: '已保存到本机', error: '本机保存失败', conflict: '其他页面有不同修改' };
  const variant = snapshot.state === 'saved' ? 'success' : snapshot.state === 'saving' ? 'info' : 'warning';
  return <div className="workspace-save-status" aria-live="polite">
    <Badge variant={variant} label={messages[snapshot.state]} />
    {snapshot.state === 'error' || snapshot.state === 'conflict' ? <Button size="sm" label="查看与备份" onClick={onOpenData} /> : null}
    {snapshot.warnings.length && snapshot.state === 'saved' ? <Button size="sm" label="查看草稿恢复提示" onClick={onOpenData} /> : null}
  </div>;
}
export function DataPanel() {
  const snapshot = useSyncExternalStore(subscribeWorkspace, getWorkspaceSnapshot);
  const [sensitive, setSensitive] = useState(false);
  const [preview, setPreview] = useState<WorkspaceImportPreview | null>(null);
  const [overwrites, setOverwrites] = useState<string[]>([]);
  const [category, setCategory] = useState<WorkspaceCategory>('algorithm');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function action(operation: () => Promise<void>) {
    setBusy(true); setError('');
    try { await operation(); } catch (failure) { setError(failure instanceof Error ? failure.message : '操作失败，原数据已保留。'); }
    finally { setBusy(false); }
  }
  async function readFile(file: File) {
    setPreview(null); setOverwrites([]); setNotice('');
    await action(async () => {
      if (file.size > 12_000_000) throw new Error('备份文件不能超过 12 MB。');
      await flushWorkspace();
      try { setPreview(previewWorkspaceImport(await file.text())); }
      catch { throw new Error('无法读取此备份。请使用本应用导出的完整 JSON；未知类型、重复记录和损坏内容均不会导入。'); }
    });
  }
  const categoryCount = snapshot.records.filter(record => record.category === category).length;
  return <section className="workspace-data-panel" aria-labelledby="workspace-data-title">
    <div className="intro"><h1 id="workspace-data-title">本机数据与备份</h1><p>草稿与算法作答保存在此浏览器，关闭后仍可继续。浏览器清理、无痕窗口退出或更换设备前，请先下载备份。</p></div>
    {snapshot.errors.map((message, index) => <Banner role="alert" key={`${message}-${index}`} status="error" title={message} />)}
    {snapshot.warnings.length ? <Banner role="alert" status="warning" title={[...new Set(snapshot.warnings)].join(' ')} /> : null}
    {snapshot.state === 'error' ? <div className="panel-actions"><Button isLoading={busy} label="重试本机保存" onClick={() => void action(async () => { await retryWorkspaceSaves(); if (getWorkspaceSnapshot().state === 'saved') setNotice('本机保存已恢复。'); })} /><Button label="下载含个人资料的应急备份" onClick={() => { setSensitive(true); downloadBackup(true); }} /></div> : null}
    {snapshot.conflicts.length ? <section aria-label="待处理的多页面冲突"><h2>先核对其他页面的修改</h2><p>双方内容均已保留。选择后请刷新页面以载入所选版本；刷新前可先下载备份。</p>
      {snapshot.conflicts.map(conflict => <article className="panel" key={conflict.key}><h3>{recordLabel(conflict.key)}</h3>
        <Collapsible trigger="查看两个版本的内容"><div><h4>当前页面内容</h4><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 260, overflowY: 'auto' }}>{conflict.localValue ?? '已清空'}</pre><h4>本机已保存内容</h4><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 260, overflowY: 'auto' }}>{conflict.remoteValue ?? '已清空'}</pre></div></Collapsible>
        <div className="panel-actions"><Button isDisabled={busy} label="采用本机版本" onClick={() => void action(async () => { await resolveWorkspaceConflict(conflict.key, 'reload'); setNotice('已采用本机保存的版本。请刷新页面载入。'); })} /><Button isDisabled={busy} label="保留当前页面版本" onClick={() => void action(async () => { await resolveWorkspaceConflict(conflict.key, 'local'); setNotice('已保留当前页面版本。请刷新页面载入。'); })} /></div>
      </article>)}
    </section> : null}
    <section className="panel" aria-labelledby="workspace-export-title"><h2 id="workspace-export-title">下载备份</h2><p>默认备份算法代码、笔记、跟打草稿、进度与页面偏好。不包含模型密钥、搜索密钥或身份 Cookie。</p>
      <CheckboxInput label="同时包含简历、JD、未提交答案、岗位档案和面试复习清单" value={sensitive} onChange={checked => setSensitive(checked)} />
      {sensitive ? <p role="note">备份将包含个人求职资料，请自行妥善保管。服务端完整面试与报告请在历史中单独导出。</p> : null}
      <div className="panel-actions"><Button label="下载 JSON 备份" onClick={() => { try { downloadBackup(sensitive); setNotice('备份已下载。'); setError(''); } catch { setError('备份生成失败。请复制当前作答后重试。'); } }} /></div>
    </section>
    <section className="panel" aria-labelledby="workspace-import-title"><h2 id="workspace-import-title">恢复备份</h2><p>先预览，再确认。遇到相同记录时默认保留本机内容；勾选的记录才会被备份覆盖。恢复只影响本机，不会创建或修改服务端面试。</p>
      <FileInput label="选择备份 JSON" accept="application/json,.json" value={null} isDisabled={busy} onChange={files => { const file = Array.isArray(files) ? files[0] : files; if (file) void readFile(file); }} />
      {preview ? <div aria-label="备份恢复预览"><p>共 {preview.records.length} 项，{preview.records.filter(record => record.conflict).length} 项与本机不同。{preview.bundle.includesSensitive ? '此文件包含个人资料。' : ''}</p>
        {preview.records.map(record => <div key={record.key}><CheckboxInput isDisabled={!record.conflict || busy} value={record.conflict ? overwrites.includes(record.key) : !record.same} label={`${workspaceCategoryLabels[record.category]} · ${recordLabel(record.key)} · ${record.same ? '内容相同，保留本机' : record.conflict ? '默认保留本机，勾选则覆盖' : '新增，将恢复'}`} onChange={checked => setOverwrites(current => checked ? [...current, record.key] : current.filter(key => key !== record.key))} /></div>)}
        <div className="panel-actions"><Button variant="primary" isLoading={busy} label="确认恢复数据" onClick={() => void action(async () => { const count = await restoreWorkspaceBackup(preview, overwrites); setPreview(null); setNotice(`已恢复 ${count} 项本机数据。请刷新页面载入恢复内容。`); })} /><Button isDisabled={busy} label="取消恢复" onClick={() => { setPreview(null); setOverwrites([]); }} /></div>
      </div> : null}
    </section>
    <section className="panel" aria-labelledby="workspace-clear-title"><h2 id="workspace-clear-title">按类别清理本机数据</h2><p>此操作只删除所选类别的浏览器草稿。服务端面试、题库、模型和搜索连接不受影响。</p>
      <Selector label="清理类别" value={category} onChange={value => { const next = knownCategory(value); if (next) setCategory(next); }} options={workspaceCategories.map(value => ({ value, label: workspaceCategoryLabels[value] }))} />
      <p>当前类别有 {categoryCount} 项本机记录。{category === 'algorithm' ? '这会清空算法代码、笔记、跟打与复习进度。' : ''}</p>
      <ConfirmAction title={`清理${workspaceCategoryLabels[category]}`} description={<p>将清空 {categoryCount} 项本机记录。清理后无法撤销，建议先下载备份。服务端面试与连接保持原样。</p>} okText="确认清理本机数据" cancelText="保留数据" onConfirm={async () => { await clearWorkspaceCategory(category); setError(''); setNotice('所选类别已清理。请刷新页面载入。'); }}>
        <Button variant="destructive" isDisabled={!categoryCount} label="清理此类别" />
      </ConfirmAction>
    </section>
    {notice ? <Banner role="alert" status="success" title={notice} /> : null}{error ? <Banner role="alert" status="error" title={error} /> : null}
  </section>;
}
