> 历史资料：本文保留当时的设计与测试结果，不作为当前部署说明。当前项目仅使用 SQLite，运行与备份见 [项目首页](../../README.md)。旧数据库服务、迁移与导入命令已移除。

# SQLite 与 BOSS 暂停验收

2026-11-02，在 `/Users/gooingyu/Documents/project/interview-agents` 的 main 未提交工作区执行。HEAD 为 9c808536e9716dbe11c0ca1cada906acf7283052，HEAD 不包含本轮与既有 BOSS 实现。保留所有原有修改，没有提交或推送。

## 当前结果

本地业务、Agent 回执与加密连接使用独立 SQLite 文件。Mastra 使用单独的 SQLite 文件。文件权限为 0600，启用外键与 WAL，写事务使用 BEGIN IMMEDIATE，租约代际和唯一约束继续防止重复提交。Redis 为空时使用原有任务轮询。SQLite 没有 PostgreSQL 数据库角色隔离，部署隔离依赖服务文件配置和 OS 权限。

原 PostgreSQL 数据没有删除，也没有导入，因为源服务不可达。已提供只读源数据库的导入命令，目标始终为新建私有目录。该命令尚未对真实旧数据库执行，且不迁移 Mastra 自有历史。

## 实际验证

- `pnpm build` 通过，包含类型检查、前端构建、运行时能力一致性及工厂 skill 校验。仍有原有前端包体积和依赖注释警告。
- `pnpm verify:sqlite` 成功编译 182 条固定 SQL。动态模板由行为测试补充，此检查不证明所有业务分支。
- 与 `pnpm test:offline` 相同的完整命令在最终工作区通过 26 个文件、284 项测试，零跳过。命令显式排除七个浏览器控制套件，这些套件不计入通过数。所有模型和搜索调用使用合成本地 HTTP 协议，无真实付费调用。
- 新增 SQLite 测试覆盖权限、WAL、外键、回滚、重开恢复、并发写锁等待、数据库路径隔离、风控暂停入队保护及租约恢复 fencing。
- `pnpm db:migrate` 初始化成功。`pnpm dev` 实际启动 API、Bun Agent、Worker 和 Web。`pnpm run doctor` 的运行时、端口、API、Agent 与 SQLite 检查全部通过，Redis 显示未启用。
- 已启动本地 API 的 BOSS open/check 请求均返回 409 且明确暂停，没有启动浏览器。
- 工厂 diff 为 changed=[]、retirement=[]，`git diff --check` 通过。

## 风控与浏览器边界

用户报告真实 BOSS 风控后，真实站点自动化保持暂停。`BOSS_AUTOMATION=paused` 已写入本地配置。Worker 只处理离线准备与清理，API 与 CLI 拒绝打开和检查。`liveBossProfile.verified` 仍为 false。

参考 works 固定提交的研究见 `docs/research/works-patchright.md`。当前项目已具备 Patchright、有界面 Chrome、原生窗口和独立持久 profile。本次仅调整未来首次显式打开为公开首页，不跳转已有页面。没有复制随机等待或每日次数为所谓安全额度，也没有改写浏览器指纹。

临时迁移副本曾运行 Patchright 合成会话测试，十项中八项通过，两项失败：普通错误页错误信息、详情跳安全页后的暂停分类。用户报告风控后没有重跑浏览器套件。当前最终版本的浏览器行为、真实登录后原生筛选、账号身份与附件回执均未验证。不能据此声称风控已解除或真实自动投递已完成。

## 下一步

先离线定位上述两个合成会话失败，并补充 SQLite 下的浏览器权限、恢复、删除与完整合成 UI 验收。只有用户明确恢复真实站点操作后，才能做有界的人工登录与只读兼容性观察；不能自动解除暂停或启用外发。
