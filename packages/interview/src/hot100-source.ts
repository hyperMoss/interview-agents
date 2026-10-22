import { createHash } from 'node:crypto';
import { z } from 'zod';
import { hot100MetadataSchema, hot100SourceUrl } from '../../contracts/src/hot100';

const officialQuestionSchema = z.object({
  questionFrontendId: z.string().regex(/^\d+$/), titleSlug: z.string(), translatedTitle: z.string().min(1),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']), paidOnly: z.literal(false),
  topicTags: z.array(z.object({ nameTranslated: z.string().nullable(), name: z.string() })),
});
const officialPageSchema = z.object({ props: z.object({ pageProps: z.object({ dehydratedState: z.object({
  queries: z.array(z.object({ state: z.object({ data: z.object({ studyPlanV2Detail: z.object({
    slug: z.literal('top-100-liked'), planSubGroups: z.array(z.object({ name: z.string(), questions: z.array(officialQuestionSchema) })),
  }) }) }) })),
}) }) }) });

export function parseOfficialHot100(html: string, capturedAt: string) {
  const payload = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!payload) throw new Error('官方页面没有可识别的题单数据，保留已有快照。');
  const page = officialPageSchema.parse(JSON.parse(payload));
  const groups = page.props.pageProps.dehydratedState.queries.flatMap(query => query.state.data.studyPlanV2Detail.planSubGroups);
  const difficulty = { EASY: 'easy', MEDIUM: 'medium', HARD: 'hard' } satisfies Record<string, 'easy' | 'medium' | 'hard'>;
  const questions = groups.flatMap(group => group.questions.map(question => ({
    id: Number(question.questionFrontendId), title: question.translatedTitle, slug: question.titleSlug,
    difficulty: difficulty[question.difficulty], group: group.name, tags: question.topicTags.map(tag => tag.nameTranslated || tag.name),
  })));
  return hot100MetadataSchema.parse({ source: { url: hot100SourceUrl, capturedAt, sha256: createHash('sha256').update(JSON.stringify(questions)).digest('hex') }, questions });
}
