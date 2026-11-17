import { describe, expect, it } from 'vitest';
import {
  legacyResumeLibraryPath, menuPage, parseRoute, resumeAttachmentsPath, resumeLibraryTab, routeHash,
} from '../apps/web/src/navigation';
import { menuGroups, moduleTitle } from '../apps/web/src/module-navigation';

const draftId = '2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d';

describe('unified resume library routes', () => {
  it('keeps the JSON editor deep link and its refresh round trip', () => {
    const route = { page: 'resumeStudio', resumeId: draftId } as const;
    expect(routeHash(route)).toBe(`#/resumes/${draftId}`);
    expect(parseRoute(`#/resumes/${draftId}`)).toEqual(route);
    expect(parseRoute('#/resumes')).toEqual({ page: 'resumeStudio' });
  });

  it('routes the attachments view through one canonical URL', () => {
    expect(resumeAttachmentsPath).toBe('#/resumes/attachments');
    expect(parseRoute(resumeAttachmentsPath)).toEqual({ page: 'resumeLibrary' });
    expect(routeHash({ page: 'resumeLibrary' })).toBe(resumeAttachmentsPath);
    expect(parseRoute(routeHash({ page: 'resumeLibrary' }))).toEqual({ page: 'resumeLibrary' });
  });

  it('opens the attachments view for the legacy library link and normalizes it away', () => {
    expect(parseRoute(legacyResumeLibraryPath)).toEqual({ page: 'resumeLibrary' });
    expect(routeHash({ page: 'resumeLibrary' })).not.toBe(legacyResumeLibraryPath);
  });

  it('falls back to the library root for a malformed copy id without losing the page', () => {
    expect(parseRoute('#/resumes/bad-id')).toEqual({ page: 'resumeStudio' });
    expect(parseRoute('#/settings/resumes/extra')).toEqual({ page: 'resumeLibrary' });
  });

  it('maps both library views onto the editor and attachments tabs', () => {
    expect(resumeLibraryTab('resumeStudio')).toBe('editor');
    expect(resumeLibraryTab('resumeLibrary')).toBe('attachments');
    expect(menuPage('resumeLibrary')).toBe('resumeStudio');
    expect(menuPage('career')).toBe('career');
  });
});

describe('resume library navigation entry', () => {
  it('exposes one resume menu item and keeps it selected for both views', () => {
    const resumeItems = menuGroups.flatMap(group => group.items).filter(item => item.key === 'resumeStudio' || item.key === 'resumeLibrary');
    expect(resumeItems).toEqual([{ key: 'resumeStudio', label: '简历库' }]);
    expect(moduleTitle('resumeStudio')).toBe('简历管理 / 简历库');
    expect(moduleTitle('resumeLibrary')).toBe('简历管理 / 简历库');
  });
});
