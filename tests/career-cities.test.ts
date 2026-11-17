import { describe, expect, it } from 'vitest';
import {
  CAREER_DEFAULT_CITIES, CAREER_MAX_CITIES, bossCities, bossCityCode, bossCitySnapshot, careerCitySchema, findBossCity, searchBossCities,
} from '../packages/contracts/src/career-cities';
import { careerPolicySchema, careerTaskCreateSchema, type ObservedPosting } from '../packages/contracts/src/career';
import { evaluatePosting } from '../packages/career/src/filters';
import { BrowserUnavailable, searchPlan, worksSearchUrl } from '../apps/worker/src/boss-browser';

// The controlled city snapshot is the one source for the shared contract, the search URL code and the
// local location check. These cases pin the snapshot provenance, the bounded selection and the exact
// location evidence without launching a browser or contacting the site.

function policy(cities: string[], roleTargets: ['fullstack'] = ['fullstack']) {
  return careerPolicySchema.parse({ roleTargets, cities, salaryUpperMinCnyMonthly: 18000, preferAiApplication: true, companyBlacklistKeywords: [] });
}

function posting(location: string): ObservedPosting {
  return {
    site: 'boss', sitePostingId: `fixture-${location}`, url: 'https://example.test/job_detail/fixture.html',
    title: '全栈工程师', company: '示例自研科技', location, salaryRaw: '15-25K',
    jdText: '负责全栈应用开发，使用 React 与 NestJS，编写自动化测试。', companyProfileText: '示例自研科技，自有研发团队，公司直招。',
    identitySource: 'detail_link',
    nativeFilterEvidence: { searchKey: 'city', controls: [{ label: 'city', selected: location, url: 'https://example.test/web/geek/job' }] },
  };
}

describe('BOSS mainland city snapshot', () => {
  it('records the official source, capture date and code=0 response it was read from', () => {
    expect(bossCitySnapshot.source).toEqual({
      url: 'https://www.zhipin.com/wapi/zpCommon/data/city.json',
      capturedAt: '2026-11-17',
      responseCode: 0,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(bossCitySnapshot.scope).toBe('mainland-prefecture-cities-and-municipalities');
    expect(bossCities).toHaveLength(337);
  });

  it('keeps every city unique and carries the site code and province without inference', () => {
    expect(new Set(bossCities.map(city => city.name)).size).toBe(bossCities.length);
    expect(new Set(bossCities.map(city => city.code)).size).toBe(bossCities.length);
    expect(bossCities.every(city => /^101\d{6}$/.test(String(city.code)))).toBe(true);
    expect(findBossCity('广州')).toEqual({ name: '广州', code: 101280100, province: '广东' });
    expect(findBossCity('深圳')).toEqual({ name: '深圳', code: 101280600, province: '广东' });
    expect(findBossCity('北京')).toEqual({ name: '北京', code: 101010100, province: '北京' });
    expect(findBossCity('上海')).toEqual({ name: '上海', code: 101020100, province: '上海' });
    expect(findBossCity('杭州')).toEqual({ name: '杭州', code: 101210100, province: '浙江' });
    expect(findBossCity('成都')).toEqual({ name: '成都', code: 101270100, province: '四川' });
    // 新疆 and 西藏 keep their real prefecture names instead of short display aliases.
    expect(findBossCity('乌鲁木齐')?.code).toBe(101130100);
    expect(findBossCity('阿里地区')?.code).toBe(101140700);
  });

  it('excludes the country, province, Hong Kong/Macau/Taiwan, district and county-level nodes', () => {
    const names = new Set(bossCities.map(city => city.name));
    for (const name of ['全国', '香港', '澳门', '台湾', '广东', '浙江', '东沙群岛', '朝阳区', '济源', '仙桃', '琼海', '石河子']) {
      expect(names.has(name)).toBe(false);
    }
    // Every municipality appears exactly once even though the site nests it under its own province row.
    expect(bossCities.filter(city => city.name === '北京')).toHaveLength(1);
  });
});

describe('city selection contract', () => {
  it('keeps the historical 广州/深圳 default and accepts new mainland cities', () => {
    expect(CAREER_DEFAULT_CITIES).toEqual(['广州', '深圳']);
    expect(careerCitySchema.parse('杭州')).toBe('杭州');
    expect(policy(['广州', '深圳']).cities).toEqual(['广州', '深圳']);
    expect(policy(['北京', '杭州', '成都']).cities).toEqual(['北京', '杭州', '成都']);
    expect(careerTaskCreateSchema.parse({
      mode: 'preview', requestId: '00000000-0000-4000-8000-000000000000',
      policy: { roleTargets: ['fullstack'], cities: ['杭州', '成都'], salaryUpperMinCnyMonthly: 18000, preferAiApplication: true, companyBlacklistKeywords: [] },
    })).toMatchObject({ policy: { cities: ['杭州', '成都'] } });
  });

  it('bounds the selection at ten, rejects duplicates and rejects unknown city values', () => {
    const ten = bossCities.slice(0, CAREER_MAX_CITIES).map(city => city.name);
    expect(policy(ten).cities).toHaveLength(CAREER_MAX_CITIES);
    expect(() => policy([...ten, '广州'])).toThrow();
    expect(() => policy(['广州', '广州'])).toThrow();
    expect(() => policy(['纽约'])).toThrow();
    expect(() => policy([])).toThrow();
  });

  it('searches only the controlled names and provinces, returning nothing for unrelated text', () => {
    expect(searchBossCities('杭州').map(city => city.name)).toEqual(['杭州']);
    expect(searchBossCities('广东').map(city => city.name)).toEqual(expect.arrayContaining(['广州', '深圳', '东莞']));
    expect(searchBossCities('上海').map(city => city.name)).toEqual(['上海']);
    expect(searchBossCities('长沙').map(city => city.name)).toEqual(['长沙']);
    expect(searchBossCities('纽约')).toEqual([]);
    expect(searchBossCities('  ')).toEqual([]);
  });
});

describe('city search plan and URL', () => {
  it('plans every selected city once and builds the URL from the snapshot code', () => {
    const selected = policy(['广州', '杭州', '成都']);
    expect(searchPlan(selected).map(target => target.city)).toEqual(['广州', '杭州', '成都']);
    const url = new URL(worksSearchUrl('https://www.zhipin.com', { city: '杭州', role: 'fullstack', position: '全栈' }));
    expect(url.pathname).toBe('/web/geek/jobs');
    expect(url.searchParams.get('city')).toBe('101210100');
    expect(url.searchParams.get('query')).toBe('全栈');
    expect(worksSearchUrl('https://www.zhipin.com', { city: '成都', role: 'fullstack', position: '全栈' })).toContain('city=101270100');
  });

  it('refuses a city outside the controlled snapshot instead of guessing a code', () => {
    expect(() => worksSearchUrl('https://www.zhipin.com', { city: '纽约', role: 'fullstack', position: '全栈' })).toThrow(BrowserUnavailable);
    expect(bossCityCode('纽约')).toBeUndefined();
  });
});

describe('local location matching', () => {
  it('matches a selected city from the exact rendered name or its 市 form with the original quote', () => {
    const cases = [
      { city: '北京', location: '北京·朝阳区', quote: '北京' },
      { city: '杭州', location: '杭州市·西湖区', quote: '杭州市' },
      { city: '上海', location: '上海', quote: '上海' },
      { city: '成都', location: '成都·武侯区', quote: '成都' },
    ];
    for (const item of cases) {
      const decision = evaluatePosting({ policy: policy([item.city]), posting: posting(item.location) });
      expect(decision.disposition, item.location).toBe('eligible');
      const matched = decision.reasons.find(reason => reason.code === 'city_matched');
      expect(matched?.evidence[0]).toMatchObject({ field: 'location', quote: item.quote });
    }
  });

  it('keeps street and county overlap unresolved instead of treating a substring as the city', () => {
    for (const location of ['上海路', '长沙县']) {
      const decision = evaluatePosting({ policy: policy([location === '上海路' ? '上海' : '长沙']), posting: posting(location) });
      expect(decision.disposition, location).toBe('needs_review');
      expect(decision.reasons.map(reason => reason.code)).toContain('location_ambiguous');
      expect(decision.reasons.map(reason => reason.code)).not.toContain('city_matched');
    }
  });

  it('excludes a cross-city posting and never passes another city in the same province', () => {
    expect(evaluatePosting({ policy: policy(['广州']), posting: posting('深圳·南山') })).toMatchObject({ disposition: 'excluded' });
    expect(evaluatePosting({ policy: policy(['深圳']), posting: posting('广东·广州·天河') })).toMatchObject({ disposition: 'excluded' });
    const cross = evaluatePosting({ policy: policy(['广州', '深圳']), posting: posting('广州·天河/佛山·禅城') });
    expect(cross.disposition).toBe('excluded');
    expect(cross.reasons.find(reason => reason.code === 'city_mismatch')?.evidence[0]?.quote).toBe('佛山');
  });

  it('keeps an unknown or ambiguous location in review, not eligible', () => {
    for (const location of ['远程', '全国多地', '珠三角', '']) {
      const decision = evaluatePosting({ policy: policy(['广州']), posting: posting(location) });
      expect(decision.disposition, location).toBe('needs_review');
      expect(decision.reasons.map(reason => reason.code)).toContain('location_ambiguous');
    }
  });
});
