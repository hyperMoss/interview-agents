export const catalog = {
  'core.platform': { dependencies: [], services: ['web','api','postgres'], env: { api: ['DATABASE_URL','COOKIE_SECRET','WEB_ORIGIN'] }, maturity: 'supported', description: '身份、资源归属、配置和健康检查' },
  'ai.text': { dependencies: ['core.platform'], services: [], env: { agent: ['MODEL_MODE','LLM_MODEL','LLM_API_KEY'] }, maturity: 'supported', description: '文本模型和严格输出验证' },
  'jobs.async': { dependencies: ['core.platform'], services: ['worker','redis'], env: { api: ['REDIS_URL'], worker: ['DATABASE_URL','REDIS_URL','AGENT_URL','INTERNAL_SERVICE_TOKEN'] }, maturity: 'supported', description: 'PostgreSQL 任务真相与 BullMQ 通知、租约和对账' },
  'agent.runtime': { dependencies: ['ai.text','jobs.async'], services: ['agent'], env: { agent: ['AGENT_DATABASE_URL','INTERNAL_SERVICE_TOKEN'] }, maturity: 'supported', description: '独立 Hono/Mastra 有界生成与结果持久化' },
  'interview.practice': { dependencies: ['agent.runtime'], services: [], env: {}, maturity: 'supported', description: '简历/JD、轮次问答、逐题反馈与报告' },
  'resume.import': { dependencies: ['core.platform'], services: [], env: {}, maturity: 'supported', description: '本地 PDF/DOCX/文本简历提取与可编辑预览' },
  'files.object-storage': { dependencies: ['core.platform'], services: ['rustfs'], env: { api: ['RUSTFS_ENDPOINT','RUSTFS_ACCESS_KEY','RUSTFS_SECRET_KEY'] }, maturity: 'planned', description: 'S3 对象存储；运行适配器待实现' },
  'files.manage': { dependencies: ['files.object-storage'], services: [], env: {}, maturity: 'planned', description: '文件权限与生命周期；待实现' },
  'documents.manage': { dependencies: ['jobs.async'], services: [], env: {}, maturity: 'planned', description: '文档版本与任务状态；待实现' },
  'documents.parse': { dependencies: ['documents.manage'], services: ['mineru'], env: { worker: ['MINERU_BASE_URL','MINERU_API_KEY'] }, maturity: 'planned', description: 'MinerU 解析；待实现' },
  'documents.chunk': { dependencies: ['documents.manage'], services: [], env: {}, maturity: 'planned', description: '结构分块；待实现' },
  'ai.embedding': { dependencies: ['core.platform'], services: [], env: { worker: ['EMBEDDING_MODEL','EMBEDDING_DIMENSION','EMBEDDING_API_KEY'] }, maturity: 'planned', description: 'Embedding；待实现' },
  'retrieval.lexical': { dependencies: ['core.platform'], services: [], env: {}, maturity: 'planned', description: '关键词检索；待实现' },
  'retrieval.vector': { dependencies: ['ai.embedding'], services: [], env: {}, maturity: 'planned', description: 'pgvector 向量检索；待实现' },
  'retrieval.rerank': { dependencies: ['rag.knowledge'], services: [], env: { worker: ['RERANK_API_KEY','RERANK_MODEL'] }, maturity: 'planned', description: '结果重排；待实现' },
  'rag.knowledge': { dependencies: ['documents.manage','documents.chunk'], services: [], env: {}, maturity: 'planned', description: '知识库、检索与引用；待实现' },
  'rag.answer': { dependencies: ['rag.knowledge','ai.text'], services: [], env: {}, maturity: 'planned', description: '基于证据回答；待实现' },
  'web.search': { dependencies: ['core.platform'], services: [], env: { api: ['TAVILY_API_KEY'] }, maturity: 'supported', description: 'Tavily/Firecrawl 搜索、连接配置与来源快照' },
  'web.extract': { dependencies: ['core.platform'], services: [], env: { api: ['FIRECRAWL_API_KEY'] }, maturity: 'planned', description: '网页正文提取；待实现' },
  'speech.asr': { dependencies: ['core.platform'], services: [], env: { api: ['VOLC_ASR_API_KEY'] }, maturity: 'planned', description: 'ASR 转写；待实现' },
  'speech.tts': { dependencies: ['core.platform'], services: [], env: { api: ['VOLC_TTS_API_KEY'] }, maturity: 'planned', description: 'TTS 合成；待实现' },
  'speech.conversation': { dependencies: ['speech.asr','speech.tts','ai.text'], services: [], env: {}, maturity: 'planned', description: '语音会话；待实现' },
  'mail.delivery': { dependencies: ['core.platform'], services: [], env: { api: ['MAIL_HOST','MAIL_USER','MAIL_PASS'] }, maturity: 'planned', description: '邮件投递；待实现' },
} satisfies Record<string, { dependencies: string[]; services: string[]; env: Record<string,string[]>; maturity: 'supported' | 'planned'; description: string }>;
export type CapabilityId = keyof typeof catalog;
export const blueprints = {
  'saas-basic': ['core.platform'], 'interview-practice': ['interview.practice'], 'agent-chat': ['agent.runtime'],
  'knowledge-assistant': ['rag.knowledge','rag.answer'], 'research-assistant': ['agent.runtime','web.search','web.extract'],
  'voice-assistant': ['speech.conversation'], 'document-workbench': ['files.manage','documents.parse'],
} satisfies Record<string, CapabilityId[]>;
export const providerOptions: Partial<Record<CapabilityId, string[]>> = {
  'ai.text': ['openai-compatible'], 'files.object-storage': ['rustfs'], 'documents.parse': ['mineru-local','mineru-cloud'],
  'retrieval.vector': ['pgvector','elasticsearch'], 'retrieval.lexical': ['postgres','elasticsearch'],
  'web.search': ['tavily','firecrawl'], 'web.extract': ['tavily','firecrawl'],
  'ai.embedding': ['openai-compatible'], 'speech.asr': ['volcengine'], 'speech.tts': ['volcengine'],
};
