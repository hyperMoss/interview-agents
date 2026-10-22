import { useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Empty, Input, Select, Spin, Tabs } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { bankDraftSchema, difficultySchema, roleFamilySchema, leetcodeBatchSchema, type BankDraft, type BankQuestion } from '../../../packages/contracts/src/bank';

const { TextArea } = Input;
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
        <Button disabled={busy} onClick={onClose}>返回练习</Button>
      </div>
      <div aria-live="polite" style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
        {identity.isPending ? <div role="status"><Spin size="small" /> 正在准备题库身份…</div> : null}
        {identity.isError ? <Alert type="error" showIcon message={identity.error.message} action={<Button disabled={busy || identity.isFetching} onClick={() => void identity.refetch()}>重试</Button>} /> : null}
        {busy ? <div role="status"><Spin size="small" /> 正在处理题库操作…</div> : null}
        {error ? <Alert type="error" showIcon message={error} role="alert" /> : null}
        {message ? <Alert type="success" showIcon message={message} role="status" /> : null}
      </div>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        {
          key: 'saved',
          label: '已保存题目',
          children: (
            <section className="bank-list" aria-labelledby="bank-saved-title">
              <h3 id="bank-saved-title">已保存的题目</h3>
              <label htmlFor="bank-search">查找题库</label>
              <Input id="bank-search" placeholder="按标题、标签或题面查找" value={filter} disabled={busy || !identity.isSuccess} onChange={e => setFilter(e.target.value)} />
              {list.isError ? <Alert type="error" showIcon message={list.error.message} action={<Button disabled={busy || list.isFetching} onClick={() => void list.refetch()}>重新读取题库</Button>} /> : null}
              {identity.isSuccess && list.isPending ? <div role="status" style={{ padding: 24 }}><Spin /> 正在读取题库…</div> : null}
              {list.isSuccess && questions.length === 0 ? <Empty description={filter ? '没有匹配的题目' : '题库暂无题目，可自建或导入题目'} /> : null}
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
                  {q.category === 'coding' ? <Button onClick={() => onAlgorithmPractice(q)}>算法跟打 · {q.title}</Button> : null}
                  {q.editable ? <div className="panel-actions">
                    <Button disabled={disabled} onClick={() => edit(q)}>编辑 {q.title}</Button>
                    <Button danger disabled={disabled} onClick={() => void perform(() => api.bankRemove(q.id), '题目已删除，旧面试快照保留。')}>删除 {q.title}</Button>
                  </div> : null}
                </article>
              ))}
            </section>
          ),
        },
        {
          key: 'edit',
          label: editing ? '编辑题目' : '自建题目',
          children: (
            <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
              <h3>{editing ? '编辑题目' : '自建题目'}</h3>
              <div><label htmlFor="bank-question-title">题目标题</label><Input id="bank-question-title" required minLength={2} maxLength={200} disabled={disabled} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></div>
              <div><label htmlFor="bank-question-content">题面</label><TextArea id="bank-question-content" required minLength={10} maxLength={14000} rows={4} disabled={disabled} value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 16 }}>
                <div><label htmlFor="bank-question-category">题目类别</label><Select id="bank-question-category" style={{ width: '100%' }} disabled={disabled} value={draft.category} options={Object.entries(categories).map(([value, label]) => ({ value, label }))} onChange={value => setDraft({ ...draft, category: bankDraftSchema.shape.category.parse(value) })} /></div>
                <div><label htmlFor="bank-question-difficulty">题目难度</label><Select id="bank-question-difficulty" style={{ width: '100%' }} disabled={disabled} value={draft.difficulty} options={difficultyOptions} onChange={value => setDraft({ ...draft, difficulty: difficultySchema.parse(value) })} /></div>
                <div><label htmlFor="bank-question-role">适用岗位</label><Select id="bank-question-role" style={{ width: '100%' }} disabled={disabled} value={draft.roleFamilies[0] ?? 'general'} options={roleOptions} onChange={value => setDraft({ ...draft, roleFamilies: [roleFamilySchema.parse(value)] })} /></div>
              </div>
              <div><label htmlFor="bank-question-tags">标签，以逗号分隔</label><Input id="bank-question-tags" disabled={disabled} value={tagText} maxLength={500} onChange={e => setTagText(e.target.value)} /></div>
              <div><label htmlFor="bank-question-answer">参考答案（选填）</label><TextArea id="bank-question-answer" rows={3} maxLength={8000} disabled={disabled} value={draft.expectedAnswer} onChange={e => setDraft({ ...draft, expectedAnswer: e.target.value })} /></div>
              <div className="panel-actions">
                {editing ? <Button htmlType="button" disabled={disabled} onClick={resetDraft}>取消编辑</Button> : null}
                <Button type="primary" htmlType="submit" aria-label={editing ? '保存题目' : '创建题目'} disabled={disabled} loading={busy}>{editing ? '保存题目' : '创建题目'}</Button>
              </div>
            </form>
          ),
        },
        {
          key: 'import',
          label: '导入题目',
          children: (
            <section className="bank-import" aria-labelledby="bank-import-title">
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
                <div><label htmlFor="bank-import-url">LeetCode 公开题目链接</label><Input id="bank-import-url" type="url" required disabled={disabled} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://leetcode.cn/problems/two-sum/" /></div>
                <div><Button htmlType="submit" aria-label="导入公开题目" disabled={disabled} loading={busy}>导入公开题目</Button></div>
              </form>
              <div style={{ marginTop: 16 }}>
                <label htmlFor="bank-import-file">导入 LeetCode JSON 题库</label>
                <input id="bank-import-file" type="file" accept=".json,application/json" disabled={disabled} onChange={e => { const file = e.target.files?.[0]; if (file) void importJson(file); e.target.value = ''; }} />
              </div>
              <details><summary>JSON 格式示例</summary><pre style={{ maxWidth: '100%', overflowX: 'auto' }}>{JSON.stringify({ questions: [{ slug: 'two-sum', region: 'cn', title: '题目标题', content: '从导出文件提供的完整题面。', category: 'coding', difficulty: 'easy', roleFamilies: ['general'], tags: ['数组'], expectedAnswer: '' }] }, null, 2)}</pre></details>
            </section>
          ),
        },
      ]} />
    </section>
  );
}
