import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { Session } from '../../../packages/contracts/src/index';
import { readSession, writeSession } from './storage';

export const statusLabels: Record<Session['status'], string> = {
  preparing: '正在准备', awaiting_answer: '进行中', evaluating: '正在评估',
  completed: '已完成', failed: '生成失败', cancelled: '已取消',
};
export type Page = 'home' | 'practice' | 'preparation' | 'algorithm' | 'bank' | 'model' | 'search' | 'data' | 'review';
export type Route = { page: Page; sessionId?: string; view?: 'hot100' | 'patterns'; questionId?: number; patternId?: string };
const paths: Record<Page, string> = {
  home: 'home', practice: 'interviews', preparation: 'preparation', algorithm: 'algorithms',
  bank: 'bank', model: 'settings/models', search: 'settings/search', data: 'settings/data', review: 'review',
};
export function parseRoute(hash: string): Route | null {
  const parts = hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'algorithms') {
    const view = parts[1] === 'patterns' ? 'patterns' : 'hot100';
    const id = z.coerce.number().int().positive().safeParse(parts[2]);
    return { page: 'algorithm', view, ...(id.success ? { questionId: id.data } : {}), ...(parts[3] && /^[a-z0-9-]{1,80}$/.test(parts[3]) ? { patternId: parts[3] } : {}) };
  }
  if (parts[0] === 'interviews') {
    const id = z.uuid().safeParse(parts[1]);
    return { page: 'practice', ...(id.success ? { sessionId: id.data } : {}) };
  }
  const path = parts.join('/');
  for (const [page, candidate] of Object.entries(paths)) if (candidate === path) return { page: z.enum(['home', 'practice', 'preparation', 'algorithm', 'bank', 'model', 'search', 'data', 'review']).parse(page) };
  return null;
}
export function routeHash(route: Route) {
  if (route.page === 'algorithm') return `#/algorithms/${route.view ?? 'hot100'}${route.questionId ? `/${route.questionId}` : route.patternId ? '/0' : ''}${route.patternId ? `/${route.patternId}` : ''}`;
  return `#/${paths[route.page]}${route.page === 'practice' ? `/${route.sessionId ?? 'new'}` : ''}`;
}
export function useWorkspaceRoute() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash) ?? parseRoute(readSession('workspace-route') ?? '') ?? { page: 'home' });
  useEffect(() => {
    const change = () => setRoute(parseRoute(window.location.hash) ?? { page: 'home' });
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    const hash = routeHash(route);
    writeSession('workspace-route', hash);
    if (!window.location.hash) window.history.replaceState(null, '', hash);
  }, [route]);
  function navigate(next: Route) {
    setRoute(next);
    if (window.location.hash !== routeHash(next)) window.location.hash = routeHash(next);
    window.scrollTo({ top: 0 });
  }
  return { route, navigate };
}
