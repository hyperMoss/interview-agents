import { useId, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { TextArea } from '@astryxdesign/core/TextArea';

export function MarkdownShare({ content, isDisabled = false }: { content: string; isDisabled?: boolean }) {
  const id = useId();
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'manual'>('idle');
  async function copy() {
    setState('copying');
    try {
      await navigator.clipboard.writeText(content);
      setState('copied');
    } catch {
      setState('manual');
    }
  }
  return <div className="markdown-share">
    <Button label="复制 Markdown" isLoading={state === 'copying'} isDisabled={isDisabled || state === 'copying'} onClick={() => void copy()} />
    {state === 'copied' ? <p role="status">已复制 Markdown，可粘贴分享。</p> : null}
    {state === 'manual' ? <div className="markdown-share-fallback">
      <p role="alert">无法写入剪贴板，请在下方手动全选复制 Markdown。</p>
      <TextArea id={id} label="Markdown 分享内容" aria-label="Markdown 分享内容" value={content} isReadOnly rows={10} />
    </div> : null}
  </div>;
}
