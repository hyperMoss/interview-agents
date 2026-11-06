# jobs.async

SQLite 持久任务、租约和轮询对账；可选 BullMQ 通知

当前成熟度：supported；选择原因：REQ-006, agent.runtime。

依赖：core.platform。

配置读取方：worker。

数据、接口、权限、失败与验收见核心设计包；本能力验证必须回到对应需求，不能把配置生成当成运行实现。
