import { z } from 'zod';
import snapshot from '../data/boss-cities.json' with { type: 'json' };

// Controlled mainland city list for BOSS searches. The snapshot is the site's public city
// configuration, so the shared schema, the search URL code and the local location check all
// read the same names, province names and codes. No city code is inferred or guessed here.
export const bossCitySourceUrl = 'https://www.zhipin.com/wapi/zpCommon/data/city.json';

export const bossCitySchema = z.strictObject({
  name: z.string().trim().min(2).max(20),
  code: z.number().int().min(101000000).max(101999999),
  province: z.string().trim().min(2).max(20),
});
export type BossCity = z.infer<typeof bossCitySchema>;

export const bossCitySnapshotSchema = z.strictObject({
  source: z.strictObject({
    url: z.literal(bossCitySourceUrl),
    capturedAt: z.iso.date(),
    responseCode: z.literal(0),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  scope: z.literal('mainland-prefecture-cities-and-municipalities'),
  note: z.string().min(1).max(400),
  cities: z.array(bossCitySchema).min(1).max(400),
}).superRefine(({ cities }, context) => {
  if (new Set(cities.map(city => city.name)).size !== cities.length) context.addIssue({ code: 'custom', message: '城市名称不能重复。' });
  if (new Set(cities.map(city => city.code)).size !== cities.length) context.addIssue({ code: 'custom', message: '城市代码不能重复。' });
});

export const bossCitySnapshot = bossCitySnapshotSchema.parse(snapshot);
export const bossCities: readonly BossCity[] = bossCitySnapshot.cities;

export const CAREER_MAX_CITIES = 10;
export const CAREER_DEFAULT_CITIES: readonly [string, string] = ['广州', '深圳'];

// Snapshot validation guarantees a non-empty catalog before constructing the enum.
export const careerCityNames = bossCities.map(city => city.name);
export const careerCitySchema = z.enum(careerCityNames);

const cityByName = new Map(bossCities.map(city => [city.name, city]));

export function findBossCity(name: string): BossCity | undefined {
  return cityByName.get(name);
}

export function bossCityCode(name: string): number | undefined {
  return cityByName.get(name)?.code;
}

/** Exact-name or province substring search for the city multi-select. Unknown text matches nothing. */
export function searchBossCities(query: string): BossCity[] {
  const needle = query.normalize('NFKC').trim().toLowerCase();
  if (!needle) return [];
  const starts: BossCity[] = [];
  const contains: BossCity[] = [];
  for (const city of bossCities) {
    const name = city.name.toLowerCase();
    const province = city.province.toLowerCase();
    if (name.startsWith(needle) || province.startsWith(needle)) starts.push(city);
    else if (name.includes(needle) || province.includes(needle)) contains.push(city);
  }
  return [...starts, ...contains];
}
