import { useRef, useState, type FormEvent } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Selector } from '@astryxdesign/core/Selector';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { bankDraftSchema, difficultySchema, roleFamilySchema, leetcodeBatchSchema, type BankDraft, type BankQuestion } from '../../../packages/contracts/src/bank';

const emptyDraft: BankDraft = { title: '', content: '', category: 'technical', difficulty: 'medium', roleFamilies: ['general'], tags: [], expectedAnswer: '' };
const categories = { intro: '开场', technical: '技术问答', behavioral: '综合素质', coding: '编程', reverse: '反问' };
const difficultyOptions = [{ value: 'easy', label: '基础' }, { value: 'medium', label: '中等' }, { value: 'hard', label: '深入' }];
const roleOptions = [{ value: 'general', label: '通用' }, { value: 'frontend', label: '前端' }, { value: 'backend', label: '后端' }, { value: 'fullstack', label: '全栈' }, { value: 'data', label: '数据' }, { value: 'embedded', label: '嵌入式' }, { value: 'qa', label: '测试' }];

export function BankPanel({ onClose, onAlgorithmPractice }: { onClose: () => void; onAlgorithmPractice: (question: BankQuestion) => void }) {
  const cache = useQueryClient();
  const identity = useQuery({ queryKey: ['identity'], queryFn: api.identity });
  const list = useQuery({ queryKey: ['question-bank'], queryFn: api.bankList, enabled: identity.isSuccess });
  const [draft, setDraft] = useState<BankDraft>(emptyDraft);
  const [tagText, setTagText] = useState('');
  const [editing, setEditing] = useState<BankQuestion | null>(null);
  const [filter, setFilter] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState('saved');
  const command = useRef<{ body: string; id: string } | null>(null);
  const disabled = busy || !identity.isSuccess;
  const questions = list.data?.filter(q => `${q.title} ${q.content} ${q.tags.join(' ')}`.toLowerCase().includes(filter.toLowerCase())) ?? [];

  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await action();
      await Promise.all([cache.invalidateQueries({ queryKey: ['question-bank'] }),cache.invalidateQueries({ queryKey: ['plan-preview'] })]);
      setMessage(typeof result === 'string' ? result : success);
    } catch (error) {
      setError(error instanceof Error ? error.message : '题库操作失败。');
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    const parsed = bankDraftSchema.safeParse({ ...draft, tags: tagText.split(/[,，]/).map(value => value.trim()).filter(Boolean) });
    if (!parsed.success) {
      setMessage('');
      setError('标题至少 2 字，题面至少 10 字。检查题面、标签与参考答案的长度。');
      return;
    }
    const body = JSON.stringify(parsed.data);
    if (command.current?.body !== body) command.current = { body, id: crypto.randomUUID() };
    const id = command.current.id;
    await perform(async () => {
      if (editing) await api.bankUpdate(editing.id, editing.revision, parsed.data);
      else await api.bankCreate(id, parsed.data);
      resetDraft();
    }, editing ? '题目已更新。' : '题目已创建。');
  }

  async function importJson(file: File) {
    if (disabled) return;
    if (file.size > 5 * 1024 * 1024) {
      setMessage('');
      setError('JSON 题库最多 5 MB，每次最多 100 题。');
      return;
    }
    await perform(async () => {
      const body = leetcodeBatchSchema.parse(JSON.parse(await file.text()));
      const result = await api.importBankJson(body);
      return `导入 ${result.imported} 题，跳过 ${result.skipped} 道已有题。`;
    }, '题库导入已完成。');
  }

  function resetDraft() {
    setEditing(null);
    setDraft(emptyDraft);
    setTagText('');
    command.current = null;
  }

  function edit(q: BankQuestion) {
    setEditing(q);
    setDraft({ title: q.title, content: q.content, category: q.category, difficulty: q.difficulty, roleFamilies: q.roleFamilies, tags: q.tags, expectedAnswer: q.expectedAnswer, ...(q.jdRequirement ? { jdRequirement: q.jdRequirement } : {}) });
    setTagText(q.tags.join(','));
    setError('');
    setActiveTab('edit');
  }

  return (
    <section className="bank-panel" aria-labelledby="bank-title" style={{ minWidth: 0 }}>
      <div className="panel-heading">
        <div>
          <h2 id="bank-title">题库管理</h2>
          <p>题库最多 500 题，包含内置题。自建题目只属于当前浏览器身份。编辑或删除不会改变旧面试快照。</p>
        </div>
        <Button label="返回练习" isDisabled={busy} onClick={onClose} />
      </div>
      <div aria-live="polite" style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
        {identity.isPending ? <div role="status"><Spinner size="sm" /> 正在准备题库身份…</div> : null}
        {identity.isError ? <Banner role="alert" status="error" title={identity.error.message} endContent={<Button label="重试" isDisabled={busy || identity.isFetching} onClick={() => void identity.refetch()} />} /> : null}
        {busy ? <div role="status"><Spinner size="sm" /> 正在处理题库操作…</div> : null}
        {error ? <Banner status="error" title={error} role="alert" /> : null}
        {message ? <Banner status="success" title={message} role="status" /> : null}
      </div>
      <TabList role="tablist" value={activeTab} onChange={setActiveTab} hasDivider aria-label="题库管理">
        <Tab value="saved" label="已保存题目" panelId="bank-saved-panel" />
        <Tab value="edit" label={editing ? '编辑题目' : '自建题目'} panelId="bank-edit-panel" />
        <Tab value="import" label="导入题目" panelId="bank-import-panel" />
      </TabList>
      {activeTab === 'saved' ? (
        <section id="bank-saved-panel" role="tabpanel" aria-label="已保存题目" className="bank-list" aria-labelledby="bank-saved-title">
          <h3 id="bank-saved-title">已保存的题目</h3>
          <TextInput id="bank-search" label="查找题库" placeholder="按标题、标签或题面查找" value={filter} isDisabled={busy || !identity.isSuccess} onChange={value => setFilter(value)} />
          {list.isError ? <Banner role="alert" status="error" title={list.error.message} endContent={<Button label="重新读取题库" isDisabled={busy || list.isFetching} onClick={() => void list.refetch()} />} /> : null}
          {identity.isSuccess && list.isPending ? <div role="status" style={{ padding: 24 }}><Spinner /> 正在读取题库…</div> : null}
          {list.isSuccess && questions.length === 0 ? <EmptyState title={filter ? '没有匹配的题目' : '题库暂无题目，可自建或导入题目'} /> : null}
          {questions.map(q => (
            <article className="bank-card" key={q.id}>
              <div><strong>{q.title}</strong><span>{categories[q.category]} · {q.difficulty} · {q.source === 'builtin' ? '内置' : q.source === 'leetcode' ? 'LeetCode' : '自建'}</span></div>
              <details>
                <summary>查看题面</summary>
                <p className="answer-text">{q.content}</p>
                {q.jdRequirement ? <><h4>JD 依据 · {q.jdRequirement.priority === 'required' ? '必备项' : '加分项'}</h4><p>{q.jdRequirement.competency}</p><blockquote>{q.jdRequirement.quote}</blockquote></> : null}
                {q.expectedAnswer ? <><h4>参考答案</h4><p className="answer-text">{q.expectedAnswer}</p></> : null}
                {q.sourceUrl ? <a href={q.sourceUrl} target="_blank" rel="noreferrer">查看原始来源</a> : null}
              </details>
              {q.category === 'coding' ? <Button label={`算法跟打 · ${q.title}`} onClick={() => onAlgorithmPractice(q)} /> : null}
              {q.editable ? <div className="panel-actions">
                <Button label={`编辑 ${q.title}`} isDisabled={disabled} onClick={() => edit(q)} />
                <Button variant="destructive" label={`删除 ${q.title}`} isDisabled={disabled} onClick={() => void perform(() => api.bankRemove(q.id), '题目已删除，旧面试快照保留。')} />
              </div> : null}
            </article>
          ))}
        </section>
      ) : null}
      {activeTab === 'edit' ? (
        <div id="bank-edit-panel" role="tabpanel" aria-label={editing ? '编辑题目' : '自建题目'}>
          <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
            <h3>{editing ? '编辑题目' : '自建题目'}</h3>
            <TextInput id="bank-question-title" label="题目标题" aria-label="题目标题" isRequired isDisabled={disabled} value={draft.title} onChange={value => setDraft({ ...draft, title: value.slice(0, 200) })} />
            <TextArea id="bank-question-content" label="题面" aria-label="题面" isRequired maxLength={14000} rows={4} isDisabled={disabled} value={draft.content} onChange={value => setDraft({ ...draft, content: value })} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 16 }}>
              <Selector id="bank-question-category" label="题目类别" width="100%" isDisabled={disabled} value={draft.category} options={Object.entries(categories).map(([value, label]) => ({ value, label }))} onChange={value => setDraft({ ...draft, category: bankDraftSchema.shape.category.parse(value) })} />
              <Selector id="bank-question-difficulty" label="题目难度" width="100%" isDisabled={disabled} value={draft.difficulty} options={difficultyOptions} onChange={value => setDraft({ ...draft, difficulty: difficultySchema.parse(value) })} />
              <Selector id="bank-question-role" label="适用岗位" width="100%" isDisabled={disabled} value={draft.roleFamilies[0] ?? 'general'} options={roleOptions} onChange={value => setDraft({ ...draft, roleFamilies: [roleFamilySchema.parse(value)] })} />
            </div>
            <TextInput id="bank-question-tags" label="标签，以逗号分隔" isDisabled={disabled} value={tagText} onChange={value => setTagText(value.slice(0, 500))} />
            <TextArea id="bank-question-answer" label="参考答案（选填）" rows={3} maxLength={8000} isDisabled={disabled} value={draft.expectedAnswer} onChange={value => setDraft({ ...draft, expectedAnswer: value })} />
            <div className="panel-actions">
              {editing ? <Button type="button" label="取消编辑" isDisabled={disabled} onClick={resetDraft} /> : null}
              <Button variant="primary" type="submit" label={editing ? '保存题目' : '创建题目'} isDisabled={disabled} isLoading={busy} />
            </div>
          </form>
        </div>
      ) : null}
      {activeTab === 'import' ? (
        <section id="bank-import-panel" role="tabpanel" aria-label="导入题目" className="bank-import" aria-labelledby="bank-import-title">
          <h3 id="bank-import-title">从 LeetCode 导入</h3>
          <p>填写公开题目链接，或导入 JSON 题库。每次 JSON 最多 100 题，相同地区和题目名不会重复创建。</p>
          <form onSubmit={event => {
            event.preventDefault();
            if (disabled) return;
            void perform(async () => {
              const result = await api.importLeetCode(url);
              return `导入 ${result.imported} 题，跳过 ${result.skipped} 道已有题。`;
            }, '公开题目导入已完成。');
          }} style={{ display: 'grid', gap: 12 }}>
            <TextInput id="bank-import-url" label="LeetCode 公开题目链接" aria-label="LeetCode 公开题目链接" type="url" isRequired isDisabled={disabled} value={url} onChange={setUrl} placeholder="https://leetcode.cn/problems/two-sum/" />
            <div><Button type="submit" label="导入公开题目" isDisabled={disabled} isLoading={busy} /></div>
          </form>
          <div style={{ marginTop: 16 }}>
            <label htmlFor="bank-import-file">导入 LeetCode JSON 题库</label>
            <input id="bank-import-file" type="file" accept=".json,application/json" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; if (file) void importJson(file); event.target.value = ''; }} />
          </div>
          <details><summary>JSON 格式示例</summary><pre style={{ maxWidth: '100%', overflowX: 'auto' }}>{JSON.stringify({ questions: [{ slug: 'two-sum', region: 'cn', title: '题目标题', content: '从导出文件提供的完整题面。', category: 'coding', difficulty: 'easy', roleFamilies: ['general'], tags: ['数组'], expectedAnswer: '' }] }, null, 2)}</pre></details>
        </section>
      ) : null}
    </section>
  );
}
