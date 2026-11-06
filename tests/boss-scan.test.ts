import { describe, expect, it } from 'vitest';
import * as browser from '../apps/worker/src/boss-browser';
import { appliedSearchMatches, searchPlan, streamSearches, type SearchBatch, type SearchCard } from '../apps/worker/src/boss-browser';
import { acceptSearch } from '../apps/worker/src/boss-response';
import { careerPolicySchema } from '../packages/contracts/src/career';

// Browser-free facts of the read-only scan: the streaming order (one search at a time), the controls evidence
// that travels with each card, and the absence of any page-state shortcut that could turn a submitted search
// into accepted data. The response-backed acceptance itself is covered by tests/boss-response.test.ts.

const twoCities = careerPolicySchema.parse({
  roleTargets: ['fullstack'], cities: ['广州', '深圳'], salaryUpperMinCnyMonthly: 18000,
  preferAiApplication: true, companyBlacklistKeywords: [],
});

function card(sitePostingId: string): SearchCard {
  return { sitePostingId, url: `https://www.zhipin.com/job_detail/${sitePostingId}.html`, title: '全栈工程师', company: '示例自研科技', location: '广州·天河', salary: '17-30K' };
}

describe('scan order and provenance', () => {
  it('plans every city for every role target, once each', () => {
    const policy = careerPolicySchema.parse({
      roleTargets: ['fullstack', 'agent_development'], cities: ['广州', '深圳'], salaryUpperMinCnyMonthly: 18000,
      preferAiApplication: true, companyBlacklistKeywords: [],
    });
    expect(searchPlan(policy)).toEqual([
      { city: '广州', role: 'fullstack', position: '全栈' },
      { city: '广州', role: 'agent_development', position: 'Agent 开发' },
      { city: '深圳', role: 'fullstack', position: '全栈' },
      { city: '深圳', role: 'agent_development', position: 'Agent 开发' },
    ]);
  });

  it("visits one search's cards before the next search replaces the list, and keeps their own evidence", async () => {
    const batches: Record<string, SearchBatch> = {
      广州: { evidence: { searchKey: '广州:fullstack', controls: [{ label: 'city', selected: '广州', url: 'www.zhipin.com/web/geek/jobs' }] }, cards: [card('gz-1'), card('gz-2')] },
      深圳: { evidence: { searchKey: '深圳:fullstack', controls: [{ label: 'city', selected: '深圳', url: 'www.zhipin.com/web/geek/jobs' }] }, cards: [card('sz-1')] },
    };
    const log: string[] = [];
    for await (const batch of streamSearches(searchPlan(twoCities), async target => {
      log.push(`search ${target.city}`);
      return batches[target.city]!;
    })) {
      // The caller's work for a batch happens here, while that search is still the current page.
      for (const item of batch.cards) log.push(`read ${item.sitePostingId}`);
      // Each card travels with the evidence of the search that produced it, never another search's filters.
      const city = batch.evidence.controls.find(control => control.label === 'city')?.selected;
      expect(batch.cards.every(item => item.sitePostingId?.startsWith(city === '广州' ? 'gz' : 'sz'))).toBe(true);
      expect(batch.evidence.searchKey.startsWith(`${city}:`)).toBe(true);
    }
    expect(log).toEqual(['search 广州', 'read gz-1', 'read gz-2', 'search 深圳', 'read sz-1']);
  });

  it('stops the whole scan with no cards when a search has no response receipt', async () => {
    const log: string[] = [];
    let received = 0;
    await expect((async () => {
      for await (const batch of streamSearches(searchPlan(twoCities), async target => {
        log.push(`search ${target.city}`);
        // The live surface refuses here, exactly like `searchRendered`: the production acceptance pauses
        // because no response of this action was observed, so no batch is produced.
        const acceptance = acceptSearch({
          release: { status: 'recognized', build: 'v6789' },
          scope: { owner: 'owner-1', taskRevision: 3, sessionGeneration: 1 },
          actionEpoch: 1,
          submitted: { city: target.city, query: target.position, page: 1 },
          controls: {
            requested: { city: target.city, position: target.position, salary: '不限' },
            observed: { city: target.city, position: target.position, salary: '不限' },
          },
          capture: null,
          list: { cardCount: 0, cardPaths: [], loading: false, empty: false },
        });
        if (acceptance.status === 'paused') throw new Error(`${acceptance.reason}: ${acceptance.detail}`);
        return { evidence: { searchKey: `${target.city}:${target.role}`, controls: [{ label: 'city', selected: target.city, url: '' }] }, cards: [] };
      })) {
        received += batch.cards.length;
      }
    })()).rejects.toThrow('response_missing');
    // Nothing was yielded, no detail was read, and no later city/role was attempted.
    expect(received).toBe(0);
    expect(log).toEqual(['search 广州']);
  });
});

describe('applied controls', () => {
  it('records evidence only for controls the page still shows', () => {
    const requested = { city: '广州', position: '全栈', salary: '不限' };
    expect(appliedSearchMatches(requested, requested)).toEqual({ ok: true });
    expect(appliedSearchMatches(requested, { city: '深圳', position: '全栈', salary: '不限' })).toEqual({ ok: false, mismatched: ['city'] });
    expect(appliedSearchMatches(requested, { city: '广州', position: 'Agent 开发', salary: '10-20K' })).toEqual({ ok: false, mismatched: ['position', 'salary'] });
  });
});

describe('removed page-state shortcuts', () => {
  it('keeps no page-state acceptance predicate behind the response evidence', () => {
    // Guards the removal itself: a changed address, a changed list, a transient empty list, two equal samples,
    // matching titles or a clicked card are not acceptance signals anywhere in the adapter.
    for (const removed of ['searchCompletionBlocker', 'paneIdentityBlocker', 'searchCompleted', 'detailIdentity', 'readablePane']) {
      expect(removed in browser).toBe(false);
    }
  });
});


it('plans custom-only keywords literally and de-duplicates preset search phrases',()=>{
  const policy=careerPolicySchema.parse({...twoCities,roleTargets:[],customRoleKeywords:['C++','Python']});
  expect(searchPlan(policy).map(t=>[t.city,t.position])).toEqual([['广州','C++'],['广州','Python'],['深圳','C++'],['深圳','Python']]);
  expect(searchPlan({...twoCities,customRoleKeywords:['全栈']}).map(t=>t.position)).toEqual(['全栈','全栈']);
});
