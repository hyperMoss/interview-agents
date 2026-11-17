import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Drawer, DrawerHeader } from '@astryxdesign/core/Drawer';
import type { InterviewHistoryPage } from '../../../packages/contracts/src/history';
import type { Page, Route } from './navigation';
import { menuPage } from './navigation';
import { historyPageLimit, useJourneyCounts, type LocalReviewState, type SourceState } from './journey-map';

type MenuGroup = { label: string; subtitle: string; items: { key: Page; label: string; hint?: string }[] };
export const menuGroups: MenuGroup[] = [
  { label: '工作台', subtitle: '从这里开始', items: [{ key: 'home', label: '首页' }] },
  { label: '简历管理', subtitle: '第一步 · 整理简历', items: [{ key: 'resumeStudio', label: '简历库' }] },
  { label: '求职管理', subtitle: '第二步 · 发现岗位与沟通', items: [{ key: 'career', label: 'BOSS 求职' }, { key: 'bossInbox', label: '已交换简历会话', hint: '可带入备题 & 面试' }] },
  { label: '面试中心', subtitle: '第三步 · 备题与练习', items: [{ key: 'practice', label: '面试准备' }, { key: 'preparation', label: 'JD 备题', hint: '支持从会话带入' }, { key: 'preparationHistory', label: '备题历史' }, { key: 'history', label: '面试历史' }, { key: 'review', label: '面试复习清单' }] },
  { label: '学习训练', subtitle: '第四步 · 持续训练', items: [{ key: 'algorithm', label: '算法练习' }, { key: 'bank', label: '题库' }] },
  { label: '系统设置', subtitle: '模型与本机数据', items: [{ key: 'model', label: '模型设置' }, { key: 'search', label: '联网搜索' }, { key: 'data', label: '本机数据与备份' }] },
];

/** Sidebar counts come from the same owner-scoped queries as the home page; a full page is a lower bound. */
export function interviewCountText(interviews: SourceState<InterviewHistoryPage>, reviews: LocalReviewState) {
  const reviewText = reviews.status === 'failed' ? '待复习 不可用' : reviews.pending ? `待复习 ${reviews.pending}` : '暂无待复习';
  if (interviews.status === 'loading') return `${reviewText} · 进行中 读取中`;
  if (interviews.status === 'failed') return `${reviewText} · 进行中 不可用`;
  const active = interviews.value.items.filter(item => !['completed', 'cancelled'].includes(item.status)).length;
  const saturated = interviews.value.nextCursor !== null && interviews.value.items.length >= historyPageLimit;
  const activeText = !saturated ? (active === 0 ? '暂无进行中' : `进行中 ${active}`) : active === 0 ? '进行中 0（本页）' : `进行中 ≥${active}`;
  return `${reviewText} · ${activeText}`;
}

export function moduleTitle(page: Page) {
  const selected = menuPage(page);
  const group = menuGroups.find(group => group.items.some(item => item.key === selected));
  return `${group?.label ?? '工作台'} / ${group?.items.find(item => item.key === selected)?.label ?? '首页'}`;
}

export function ModuleNavigation({ page, navigate }: { page: Page; navigate: (route: Route) => void }) {
  const counts = useJourneyCounts();
  const count = interviewCountText(counts.interviews, counts.reviews);
  const [focusedPage, setFocusedPage] = useState<Page | null>(null);
  // Attachments and editor are two views of one library, so both keep the 简历库 menu entry selected.
  const selectedPage = menuPage(page);
  return <nav aria-label="模块导航" className="module-navigation">
    <ul role="menu" aria-label="模块导航" className="module-menu" onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const current = items.findIndex(item => item === document.activeElement);
      if (current < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>
      {menuGroups.map(group => <li key={group.label} role="presentation" className="menu-group">
        <div className="menu-group-label" role="presentation">
          <span className="menu-group-title">{group.label}</span>
          <small className="menu-group-subtitle">{group.subtitle}</small>
          {group.label === '面试中心' ? <small className="menu-group-count">{count}</small> : null}
        </div>
        <ul role="group" aria-label={group.label} className="menu-group-items">
          {group.items.map(item => <li key={item.key} role="none">
            <Button
              role="menuitem"
              className={`menu-item${item.key === selectedPage ? ' selected' : ''}`}
              label={item.label}
              variant={item.key === selectedPage ? 'secondary' : 'ghost'}
              endContent={item.hint ? <small className="menu-item-hint" aria-hidden="true">{item.hint}</small> : undefined}
              aria-current={item.key === selectedPage ? 'page' : undefined}
              tabIndex={(focusedPage ?? selectedPage) === item.key ? 0 : -1}
              onFocus={() => setFocusedPage(item.key)}
              onClick={() => navigate({ page: item.key })}
            />
          </li>)}
        </ul>
      </li>)}
    </ul>
  </nav>;
}

export function MobileNavigation(props: Parameters<typeof ModuleNavigation>[0]) {
  const [open, setOpen] = useState(false);
  return <>
    <Button className="mobile-menu-toggle" label="打开模块菜单" onClick={() => setOpen(true)}>☰ 菜单</Button>
    <Drawer isOpen={open} onOpenChange={setOpen} side="start" width={300} label="功能模块">
      <DrawerHeader title="功能模块" onOpenChange={setOpen} />
      <div className="mobile-navigation-body"><ModuleNavigation {...props} navigate={route => { props.navigate(route); setOpen(false); }} /></div>
    </Drawer>
  </>;
}
