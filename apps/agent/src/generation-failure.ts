import { z } from 'zod';
import { modelFailure } from './models';

export function generationFailure(error: unknown, signal: AbortSignal) {
  const provider = modelFailure(error);
  if (provider) return provider;
  if (signal.aborted) return { error: 'MODEL_GENERATION_TIMEOUT' };
  const structured = z.object({ id: z.string(), details: z.object({ finishReason: z.string() }).optional() }).safeParse(error);
  if (structured.success && structured.data.id === 'STRUCTURED_OUTPUT_TRUNCATED') {
    return { error: structured.data.details?.finishReason === 'content-filter' ? 'MODEL_CONTENT_FILTERED' : 'MODEL_OUTPUT_LIMIT' };
  }
  const name = error instanceof Error ? error.message : '';
  if (name === 'UNGROUNDED_EVIDENCE') return { error: 'MODEL_INVALID_EVIDENCE' };
  if (error instanceof z.ZodError || structured.success && ['STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED', 'STRUCTURED_OUTPUT_OBJECT_UNDEFINED'].includes(structured.data.id)
    || error instanceof Error && (['AI_JSONParseError', 'AI_NoObjectGeneratedError', 'AI_TypeValidationError'].includes(error.name)
      || /^(Structured output validation failed|No object generated)/.test(name)
      || ['MISSING_EVALUATION', 'MISSING_DIMENSIONS', 'UNEXPECTED_ASSESSMENT', 'TECHNICAL_NOT_APPLICABLE', 'MODEL_MODE_INVALID', 'MISSING_NEXT_QUESTION'].includes(name))) {
    return { error: 'MODEL_INVALID_OUTPUT' };
  }
  const upstream = z.object({ statusCode: z.number().int().min(400).max(599) }).safeParse(error);
  return { error: upstream.success ? 'MODEL_UPSTREAM_FAILED' : 'GENERATION_FAILED' };
}
