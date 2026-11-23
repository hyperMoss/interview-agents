# Hot 100 固定用例验证

对应需求：REQ-067。

## 入口与结果

算法练习 → Hot 100 题单 → Python 独立作答 → 运行固定用例验证。

使用原题 `class Solution` 与方法签名；设计类题使用原题类名。自动提供节点类、typing 常用类型以及常用集合、堆与缓存工具。固定用例来自 `packages/interview/src/hot100-checks.py`，与参考代码回归共享，覆盖当前一百题。失败展示异常和失败的检查行；修改代码后清除旧结果，切题或离开时销毁当前执行环境。验证不会修改用户自评或复习计划。

固定检查不是完整官方判题；部分检查对输出顺序、输入恢复和对象引用有更具体要求。通过只表示当前固定检查通过，失败需结合原题条件复核。它不是防作弊系统，不适合考核或执行恶意代码。

## 隔离与依赖

显式点击后才创建 `sandbox="allow-scripts"` iframe，不授予 `allow-same-origin`。iframe 在不透明来源创建 Worker，用户代码不能访问应用 DOM、同源浏览器存储或 API。CSP 默认拒绝资源，仅允许 blob Worker、必要的脚本执行及固定版本 Pyodide CDN 路径。主页面通过独立 MessageChannel 接收有限长度结果。

Pyodide 版本固定为 0.27.7，首次从 `https://cdn.jsdelivr.net/pyodide/v0.27.7/full/` 下载 WebAssembly 运行时。用户代码通过内存消息传递，不发送给 API 或模型；运行时下载会产生第三方网络请求。该方案依赖 CDN 可用性及其跨来源策略，不承诺完全离线或主机级内存隔离。

加载上限 60 秒；运行开始后上限 5 秒。取消、超时和卸载移除 iframe，销毁其执行上下文。浏览器级资源耗尽仍可能影响标签页，应只运行自己的练习代码。加载或执行失败不清除草稿，可再次显式重试。

## 回归

```sh
rtk pnpm exec vitest run --config hot100-vitest.config.ts
rtk pnpm typecheck
rtk pnpm exec vite build --config apps/web/vite.config.ts
```

算法专用 Vitest 配置不加载真实环境文件或数据库。主机 Python 仅执行仓库维护的参考实现与错误 fixture，不接收浏览器输入。
