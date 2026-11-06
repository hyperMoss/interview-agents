import { describe, expect, it } from 'vitest';
import { accountMarkerFor, canonicalUrl, liveBossProfile, postingIdFromUrl, redactError, redactUrl } from '../apps/worker/src/boss-browser';

// Pure profile and URL facts of the browser adapter. Nothing here launches a browser, opens a page or
// touches a profile: these cases pin what the live scan may claim before any real session exists.

describe('live BOSS profile', () => {
  const profile = liveBossProfile('https://www.zhipin.com');

  it('stays unverified and opens only the public home entry before authenticated observation', () => {
    expect(profile.verified).toBe(false);
    expect(profile.entryUrl).toBe('https://www.zhipin.com/');
    expect(profile.surface).toBe('rendered');
  });

  it('declares rendered labels and curated selectors only, so no search URL or filter parameter can be built', () => {
    if (profile.surface !== 'rendered') throw new Error('EXPECTED_RENDERED_SURFACE');
    // The live scan addresses the site's own widgets; it has no search-URL builder and no `<select>` filters.
    expect('searchUrl' in profile).toBe(false);
    expect('filters' in profile).toBe(false);
    const labels = [profile.rendered.keywordPlaceholder, profile.rendered.submitName, profile.rendered.cityPanelTitle, profile.rendered.salaryControlLabel, profile.rendered.broadSalaryBand];
    expect(labels.every(label => label.length > 0 && !/[?&=]/.test(label))).toBe(true);
    expect(profile.rendered.keywordPlaceholder).toBe('搜索职位、公司');
    expect(profile.rendered.cityPanelTitle).toBe('请选择城市');
    expect(profile.rendered.salaryControlLabel).toBe('薪资待遇');
    // Only the broad state is accepted; every other selection would narrow the result set.
    expect(profile.rendered.broadSalaryBand).toBe('不限');
  });

  it('carries the curated list surface and no unobserved encoding or success fact', () => {
    if (profile.surface !== 'rendered') throw new Error('EXPECTED_RENDERED_SURFACE');
    expect(profile.surfaceSelectors).toEqual({
      keyword: `.job-search-form input[placeholder='搜索职位、公司']`,
      submit: '.job-search-form a.search-btn',
      cardList: '.rec-job-list',
      card: '.rec-job-list .job-card-wrap',
      activeCard: '.rec-job-list .job-card-wrap.active',
      cardLink: 'a.job-name[href*="/job_detail/"]',
      loading: '.job-rec-loading',
      empty: '.job-empty',
      cityLabel: '.c-filter-condition .city-label .cur-city-label',
      cityDialog: '.city-select-dialog',
      salarySelect: '.condition-filter-select',
      salaryCurrent: '.current-select',
      pane: '.job-detail-box',
    });
    // No live request established the form field names or the submitted city's encoded value, so nothing may
    // be mapped by guess.
    expect(profile.encoding).toBeNull();
    // No live successful envelope established an application-success discriminator, so no envelope is accepted.
    expect(profile.success).toEqual({ status: 'unknown' });
    expect(profile.verified).toBe(false);
  });
});

describe('stored and logged URL facts', () => {
  it('keeps only the origin and path of a stored posting link', () => {
    expect(canonicalUrl('https://www.zhipin.com/job_detail/abc123XY.html?securityId=TOKEN#recent')).toBe('https://www.zhipin.com/job_detail/abc123XY.html');
    expect(postingIdFromUrl(canonicalUrl('https://www.zhipin.com/job_detail/abc123XY.html?securityId=TOKEN'))).toBe('abc123XY');
  });

  it('redacts query strings from observations and from driver error text', () => {
    expect(redactUrl('https://www.zhipin.com/web/geek/jobs?query=全栈&city=广州')).toBe('www.zhipin.com/web/geek/jobs');
    expect(redactUrl('not a url')).toBe('');
    const redacted = redactError(new Error('Timeout 30000ms exceeded at https://www.zhipin.com/job_detail/x.html?securityId=TOKEN'));
    expect(redacted).not.toContain('?');
    expect(redacted).toContain('www.zhipin.com/job_detail/x.html');
  });

  it('extracts an identity only from an actual posting path', () => {
    expect(postingIdFromUrl('https://www.zhipin.com/job_detail/abc123XY.html')).toBe('abc123XY');
    expect(postingIdFromUrl('https://www.zhipin.com/web/geek/jobs')).toBeNull();
  });
});

describe('account marker', () => {
  it('is a stable opaque marker that never carries the site account id', () => {
    const marker = accountMarkerFor('uid-12345');
    expect(marker).toMatch(/^[0-9a-f]{16}$/);
    expect(accountMarkerFor('uid-12345')).toBe(marker);
    expect(accountMarkerFor('uid-12346')).not.toBe(marker);
    expect(marker).not.toContain('uid');
    expect(marker).not.toContain('12345');
  });
});
