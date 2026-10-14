# 契约

请求与响应唯一 schema 位于 packages/contracts/src/index.ts；公开、运行时和事件版本为 v1。

GET /api/v1/interviews；POST /api/v1/interviews；GET /api/v1/interviews/:id；POST /api/v1/interviews/:id/answers；POST /api/v1/interviews/:id/cancel；DELETE /api/v1/interviews/:id。

提交后返回 preparing/evaluating；前端查询终态。答案 requestId 用于幂等，revision 防止旧页面提交。非归属资源统一 404；冲突 409；字段验证 400。内部 POST /internal/v1/generate 验证服务身份与结构输出。
