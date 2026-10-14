const messages:Record<string,string>={MODEL_CONNECTION_EXPIRED:'模型连接已过期或被清除。请重新启用连接，再重试本轮。',CUSTOM_MODELS_DISABLED:'部署方关闭了自定义模型，请联系部署方或启用可用的默认模型。',MODEL_KEY_UNAVAILABLE:'模型密钥无法恢复，请在模型设置中重新输入后重试。',MODEL_NOT_CONFIGURED:'默认模型未配置，请启用自己的连接后重试。',MODEL_AUTH_FAILED:'模型认证失败，请检查密钥和模型权限后重试。',MODEL_RATE_LIMITED:'模型服务限流，请稍后重试本轮。'};
messages.MODEL_DEFAULT_CHANGED='部署方默认模型配置已改变。作答未发送给新模型，请检查设置后显式重试。';
export class RuntimeFailure extends Error{constructor(readonly code:string){super(messages[code]??'本轮生成暂时不可用。作答已保存，请检查模型配置后重试，或取消练习。');}}
