# 自动验证

`.github/workflows/verify.yml` 是 REQ-024 的实现。数据与契约检查复用已有 Vitest 套件，用户流程复用 Playwright 套件，不维护第二份验证规则。

## 执行顺序

1. 设置 Node.js 22 和 package.json 指定的 pnpm。
2. 按 pnpm-lock.yaml 安装依赖，跳过通用安装脚本，只显式准备已有 Bun、esbuild 和 Chrome。
3. 从公开的 `.env.example` 创建临时配置，启动两个独立 Compose 项目。应用数据库使用 55439，隔离测试数据库使用 55440。
4. 构建并核对 spec 与 skill，执行启用数据库集成的全部测试。
5. 启动应用，最多等待 120 秒，运行只读 doctor，再驱动 Chrome 桌面和手机流程。
6. 无论成功或失败，保存指定的验证产物并移除临时数据库。

## 数据与权限

工作流不读取部署 Secrets，不调用真实模型或搜索账号。浏览器测试使用自己的身份，测试数据均为固定合成资料。公网 LeetCode 测试默认跳过。

权限为 `contents: read`，checkout 不保存 Git 凭据。工作流使用 `pull_request` 事件，不使用 `pull_request_target`。产物只包括 `.ci-output` 下列出的 JSON 和日志、`test-results` 及测试截图，保留 7 天。环境配置和完整工作目录不上传。

每次运行在独立的 GitHub 托管 runner 中执行。Compose 的 `down --volumes` 只用于该 runner 的临时项目，不在开发者本机自动执行。需要本机复现时，按 [README 验证步骤](../README.md#验证) 执行，保留自己的环境文件和开发数据库。

## 结果与失败排查

到 [Verify 运行记录](https://github.com/hyperMoss/interview-agents/actions/workflows/verify.yml) 查看当前提交。红色步骤表示失败，不会用重试自动隐藏。下载该次运行的 `verification` 产物可查看测试 JSON、应用日志和失败 trace。

在本机打开 trace：

```sh
pnpm exec playwright show-trace path/to/trace.zip
```

脚本和配置的语法检查不代表 GitHub runner 验收通过。只有该提交实际完成的运行结果才证明 CI 链路可用。本地体验改造的原始验收记录保留在 [个人练习体验验收](evidence/usability-acceptance.md)。

## 依赖来源

Action 提交哈希通过官方仓库的 v7 或 v6 标签解析并固定。升级时先核对官方输入和运行时要求，再在分支执行完整回归。

- [actions/checkout](https://github.com/actions/checkout)
- [actions/setup-node](https://github.com/actions/setup-node)
- [pnpm/action-setup](https://github.com/pnpm/action-setup)
- [actions/upload-artifact](https://github.com/actions/upload-artifact)
