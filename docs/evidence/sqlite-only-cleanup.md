# SQLite 单一存储验收

2026-11-06，本地未提交工作区。

存储契约仅接受 SQLite。工厂默认服务为 Web、API、Agent 与 Worker，Redis 通知可选。旧数据库驱动、独立服务部署文件、旧迁移和导入脚本已移除，用户数据与真实配置保持原样。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `pnpm test:offline` | 31 个文件、317 项测试通过；命令显式排除七个浏览器套件 |
| `pnpm verify:sqlite` | 226 条固定 SQL 通过 SQLite prepare；动态查询由行为测试覆盖 |
| `pnpm test:e2e:resumes` | 3 项 Chrome 流程通过，覆盖导入导出、副本与附件、手机菜单 |
| `pnpm build` | 类型、生产构建、工厂能力与 skill 校验通过 |
| 工厂 diff | 无差异，无能力退役 |
| 冻结锁文件安装 | 通过；不安装旧数据库驱动 |
| `git diff --check` | 通过 |

生成器回归验证默认 SQLite、拒绝其他引擎，并检查不再生成旧服务入口。查询结果使用本地类型，涉及业务值的读取通过 schema 解析。

本轮只使用合成资料和本地服务，未访问真实 BOSS 或收费模型。保留已有的依赖注释与包体积构建警告。历史验收资料标注历史状态，其旧结果不计入本次验收。

旧源码文件移除前已备份至 `/tmp/interview-sqlite-retired.MDPpIq/retired-source.tar.gz`，该临时备份可恢复未提交旧文件；不会随仓库发布，也不保证跨系统清理长期保留。
