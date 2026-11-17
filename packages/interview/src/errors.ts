const messages:Record<string,string>={MODEL_CONNECTION_EXPIRED:'模型连接已过期或被清除。请重新启用连接，再重试本轮。',CUSTOM_MODELS_DISABLED:'部署方关闭了自定义模型，请联系部署方或启用可用的默认模型。',MODEL_KEY_UNAVAILABLE:'模型密钥无法恢复，请在模型设置中重新输入后重试。',MODEL_NOT_CONFIGURED:'默认模型未配置，请启用自己的连接后重试。',MODEL_AUTH_FAILED:'模型认证失败，请检查密钥和模型权限后重试。',MODEL_RATE_LIMITED:'模型服务限流，请稍后重试本轮。'};
messages.MODEL_DEFAULT_CHANGED='部署方默认模型配置已改变。作答未发送给新模型，请检查设置后显式重试。';
messages.MODEL_OUTPUT_LIMIT='模型输出达到长度上限，未能返回完整评分。作答已保存，请重试本轮；若持续失败，可切换模型后重试。';
messages.MODEL_GENERATION_TIMEOUT='模型评分超时。作答已保存，请稍后重试本轮，或调整模型连接的超时设置。';
messages.MODEL_INVALID_OUTPUT='模型返回的评分格式或必填字段无效。作答已保存，请重试本轮，或切换模型。';
messages.MODEL_INVALID_EVIDENCE='模型评分引用了当前作答中不存在的原文，结果未被采纳。作答已保存，可重试本轮。';
messages.MODEL_UPSTREAM_FAILED='模型服务请求失败。作答已保存，请检查服务地址或供应商状态后重试本轮。';
messages.MODEL_CONTENT_FILTERED='模型服务未返回可用的评分内容。作答已保存，请检查供应商限制后重试。';
export class RuntimeFailure extends Error{constructor(readonly code:string){super(messages[code]??'本轮生成暂时不可用。作答已保存，请检查模型配置后重试，或取消练习。');}}
