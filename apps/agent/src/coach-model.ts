import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { MastraModelConfig } from '@mastra/core/llm';
import type { AgentConfig } from '../../../packages/config/src/index';
import type { ModelDraft } from '../../../packages/contracts/src/models';
import { modelFetch } from './models';

export function coachModel(config: AgentConfig, connection?: ModelDraft): MastraModelConfig {
  return connection
    ? createOpenAICompatible({ name: 'custom', baseURL: connection.baseUrl, apiKey: connection.apiKey || undefined, fetch: modelFetch(config) }).chatModel(connection.model)
    : { providerId: config.LLM_MODEL.split('/')[0] ?? 'openai', modelId: config.LLM_MODEL.split('/').slice(1).join('/'), apiKey: config.LLM_API_KEY, ...(config.LLM_BASE_URL ? { url: config.LLM_BASE_URL, api: 'chat' } : {}) };
}
