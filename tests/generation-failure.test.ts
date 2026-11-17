import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { generationFailure } from '../apps/agent/src/generation-failure';
import { RuntimeFailure } from '../packages/interview/src/errors';

describe('safe interview generation failures', () => {
  it.each([
    [{ id: 'STRUCTURED_OUTPUT_TRUNCATED', details: { finishReason: 'length', value: 'private-model-output' } }, 'MODEL_OUTPUT_LIMIT', '长度上限'],
    [{ id: 'STRUCTURED_OUTPUT_TRUNCATED', details: { finishReason: 'content-filter' } }, 'MODEL_CONTENT_FILTERED', '评分内容'],
    [new Error('UNGROUNDED_EVIDENCE'), 'MODEL_INVALID_EVIDENCE', '原文'],
    [new Error('MISSING_EVALUATION'), 'MODEL_INVALID_OUTPUT', '必填字段'],
    [{ id: 'STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED' }, 'MODEL_INVALID_OUTPUT', '格式'],
    [{ statusCode: 401, message: 'private-model-output' }, 'MODEL_AUTH_FAILED', '认证失败'],
    [{ statusCode: 429 }, 'MODEL_RATE_LIMITED', '限流'],
    [{ statusCode: 503 }, 'MODEL_UPSTREAM_FAILED', '请求失败'],
  ])('maps %j to a recoverable public error', (error, code, message) => {
    const result = generationFailure(error, new AbortController().signal);
    expect(result.error).toBe(code);
    expect(new RuntimeFailure(result.error).message).toContain(message);
    expect(JSON.stringify(result)).not.toContain('private-model-output');
  });
  it('reports an aborted model request and invalid output without exposing details', () => {
    expect(generationFailure(new Error('private-model-output'), AbortSignal.abort()).error).toBe('MODEL_GENERATION_TIMEOUT');
    const invalid = z.string().safeParse(123);
    if (invalid.success) throw Error('Expected invalid fixture');
    expect(generationFailure(invalid.error, new AbortController().signal).error).toBe('MODEL_INVALID_OUTPUT');
  });
});
