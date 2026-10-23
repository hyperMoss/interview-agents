import { useRef } from 'react';
const items = [
  { key: 'home', label: '首页' }, { key: 'practice', label: '面试准备' },
  { key: 'preparation', label: 'JD 备题' }, { key: 'algorithm', label: '算法练习' },
  { key: 'bank', label: '题库' }, { key: 'settings', label: '设置' },
];
export function PrimaryNavigation({ active, disabled, onChange }: { active: string; disabled: boolean; onChange: (page: string) => void }) {
  const tabs = useRef<HTMLDivElement>(null);
  return <nav aria-label="主功能导航" className="workspace-navigation"><div ref={tabs} className="primary-tabs" role="tablist" aria-label="功能页面" onKeyDown={event => {
    if (disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(tabs.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const current = buttons.findIndex(button => button === document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next]?.focus(); buttons[next]?.click();
  }}>{items.map(item => <button type="button" role="tab" id={`primary-${item.key}`} aria-controls="workspace-panel" aria-selected={active === item.key} tabIndex={active === item.key ? 0 : -1} disabled={disabled} className={active === item.key ? 'selected' : ''} key={item.key} onClick={() => onChange(item.key)}>{item.label}</button>)}</div></nav>;
}
