import { useState } from 'react';
import { Button, Drawer, Menu } from 'antd';
import type { Page, Route } from './navigation';

const groups = [
  { label: '工作台', items: [{ key: 'home', label: '首页' }] },
  { label: '简历管理', items: [{ key: 'resumeStudio', label: '简历库' }, { key: 'resumeLibrary', label: '投递附件库' }] },
  { label: '求职管理', items: [{ key: 'career', label: 'BOSS 求职' }] },
  { label: '面试中心', items: [{ key: 'practice', label: '面试准备' }, { key: 'preparation', label: 'JD 备题' }, { key: 'history', label: '面试历史' }, { key: 'review', label: '面试复习清单' }] },
  { label: '学习训练', items: [{ key: 'algorithm', label: '算法练习' }, { key: 'bank', label: '题库' }] },
  { label: '系统设置', items: [{ key: 'model', label: '模型设置' }, { key: 'search', label: '联网搜索' }, { key: 'data', label: '本机数据与备份' }] },
] satisfies { label: string; items: { key: Page; label: string }[] }[];
export function moduleTitle(page: Page) {
  const group = groups.find(group => group.items.some(item => item.key === page));
  return `${group?.label ?? '工作台'} / ${group?.items.find(item => item.key === page)?.label ?? '首页'}`;
}
export function ModuleNavigation({ page, navigate }: { page: Page; navigate: (route: Route) => void }) {
  return <nav aria-label="模块导航"><Menu mode="inline" selectedKeys={[page]} items={groups.map(group => ({ type: 'group', key: group.label, label: group.label, children: group.items }))} onClick={({ key }) => {
    const item = groups.flatMap<{ key: Page; label: string }>(group => group.items).find(item => item.key === key);
    if (item) navigate({ page: item.key });
  }} /></nav>;
}
export function MobileNavigation(props: Parameters<typeof ModuleNavigation>[0]) {
  const [open, setOpen] = useState(false);
  return <><Button className="mobile-menu-toggle" aria-label="打开模块菜单" onClick={() => setOpen(true)}>☰ 菜单</Button><Drawer title="功能模块" placement="left" open={open} onClose={() => setOpen(false)} size={280}><ModuleNavigation {...props} navigate={route => { props.navigate(route); setOpen(false); }} /></Drawer></>;
}
