# 软件工厂使用记录

当前优先交付面试应用，本轮未扩展工厂功能。以下保留已有工具的使用方式。

## 运行软件工厂

```sh
pnpm factory plan --spec app.spec.yaml
pnpm factory:docs
pnpm factory diff --spec app.spec.yaml --output .
pnpm factory context --task implement-interview.practice
pnpm factory init --blueprint saas-basic --id another-app --output /tmp/another-app
```

命令生成能力闭包、选择原因、分服务配置、需求追踪、验收任务与最小开发上下文。显式false阻止依赖启用，未选能力不进入当前文档/配置/服务清单。重复生成稳定；人工修改受管文件时完整预检停止，不覆盖。

工厂首版实现P0文档与上下文编译，当前仓库提供已实现的面试参考产品。`generate`不是任意应用的自动业务代码生成器。本项目已实现本地简历提取和 Tavily/Firecrawl 搜索，能力登记为 supported。可选 RAG、MinerU、RustFS、ASR、TTS 仍为 planned；生产成熟度门禁拒绝这些未实现能力。当前产品的匿名身份不是完整的账号或组织系统。

参考应用在构建和启动时校验实际运行时能力与spec完全一致。规划其他蓝图可以生成设计包；改变此应用能力后，必须先实现并更新运行时注册表，通过一致性门禁再启动，不能只改文档启用不存在的接口。

生成器逐文件原子替换，锁文件最后提交；它不提供跨文件事务。若生成进程被中断，先确认进程已经退出，再保留当前文件副本，核对 `factory.lock.json` 与版本控制中的基线，恢复受管文件后重跑。只有确认没有生成进程时才清理残留 `.factory-generate.lock`；不要删除锁文件来绕过人工修改保护。

## 使用和改进 skill

仓库源：`skills/software-factory`；构建 `pnpm skill:bundle` 生成无需npm依赖的Node脚本。安装后用 `$software-factory` 在其他项目发起需求装配或交付复盘。

共享经验库默认 `~/.codex/software-factory`；可用 `--store`指定其他位置。证据记录与规则版本分离：验收产物→候选规则→两个独立项目回放→审查晋升→按能力注入后续上下文。历史项目锁定学习版本；升级显式审查diff；回滚保留历史。

完整步骤见 [skill](../skills/software-factory/SKILL.md) 与 [证据协议](../skills/software-factory/references/evolution.md)。当前跨项目成长测试使用合成fixture，未伪造多个真实项目交付历史。规则版本改变后续开发上下文；代码或模板改进仍需要具体diff和真实回归。

