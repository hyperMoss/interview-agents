# works 投递流程与风控边界对照

核对日期：2026-11-04。参考提交：`21a96187a5e9f9028cb210db9e4d4b02cfbf2054`，本次已核对远端最新提交与本地参考副本一致。本报告只做源码和已有验证记录对照，没有运行参考应用，没有访问 BOSS，没有恢复自动搜索或沟通。以下改进项尚未实施。

## 能够得出的结论

works 提供了会话复用、串行执行、尝试去重和异常停止机制。它不能证明 Patchright 可以消除 BOSS 风控。项目自己的教学文档也明确区分平台限制、页面交互问题和本地驱动错误，单次 Timeout 不能证明遭遇反自动化检测。账号、设备、网络和平台内部判断机制没有得到验证。[教学说明](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/docs/BOSS-automation-teaching.md#L1-L35)

## 实际执行流程

1. 一个后台浏览器线程负责串行任务，复用每个平台的专用 profile、可见浏览器 context 和主页面。已有任务或登录操作执行时，拒绝冲突操作。[会话实现](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L155-L246)、[任务所有权](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L20-L81)
2. 登录由人完成。状态检查只读取已有页面；遇到验证页、登录页或导航异常则保留页面。后续导航先检查限制，不循环刷新验证页。[页面检查](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L257-L335)
3. 搜索和读取详情后，执行过滤、历史去重和可选 AI 判断。发送前先在 SQLite 中认领岗位并持久记录尝试，只有成功认领才操作页面。[执行循环](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L138-L188)、[持久记录](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/storage.py#L187-L203)
4. 使用原生页面控件沟通，并检查本次新增的消息回执。点击可能发生后即按不确定结果处理，不能因为超时再次点击。失败或结果不明会停止整批；后续任务仍受历史记录去重约束。[点击与结果](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L759-L812)、[整批停止](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L189-L203)
5. 重启把在途提交改为待核实，把未结束任务标记为中断，不自动续投。[恢复记录](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/storage.py#L52-L103)

本项目沿用用户已确定的范围：只点击原生“立即沟通”，使用站内已配置的自动招呼，不复制参考项目额外发送文字和图片的流程。确认直招后才联系的筛选规则继续保留。

## 不能直接照搬的部分

默认每日 50 次、每岗等待 5–10 秒只是应用配置，不是平台公布或实测有效的安全额度。[默认配置](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/config.py#L24-L27)

等待位于每岗循环末尾，去重、过滤和认领失败等 continue 分支会跳过。搜索生成器在输出岗位前已读取详情，因此被过滤的岗位仍可能连续触发详情导航。该项目没有覆盖所有浏览器动作的统一间隔，也没有持久化下一次允许动作的时间。[循环分支与等待](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L125-L204)、[详情读取](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L460-L563)

停止标志也未传入每个发送动作；“停止时没有发送”的搜索阶段测试，不能证明任意点击前都检查取消。本项目现有的租约、fencing、冻结审批和动作前校验应保留。[停止检查](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L118-L130)

## 本项目差距和建议顺序

| 检查项 | 当前源码情况 | 建议，尚未实现 |
| --- | --- | --- |
| 浏览器生命周期 | 已复用专用 Patchright context；开发 Worker 使用 watch，源码变化可能重启窗口 | 真实站点运行时隔离开发热重启，确保一个稳定的浏览器所有者 |
| 全流程节奏 | 未发现覆盖搜索、翻页、详情和点击的统一持久限速；队列轮询间隔不等于点击间隔 | 在每个外部动作前使用同一调度器；过滤和失败分支也不能跳过；重启保留下一次允许动作时间 |
| 尝试预算 | 已有投递意图和结果记录，缺少统一每日尝试预算 | 持久统计尝试与不确定结果；达到预算或平台明确限制即停止，不宣称任何数值安全 |
| 普通失败 | 单条按钮定位失败可结束当前 work，随后处理下一条 | 单次联系失败先停止整批并诊断，避免相同定位错误在多个岗位连续发生 |
| 风控暂停 | 已有会话与任务暂停检查；配置在进程启动时读取 | 持久记录账号/站点暂停状态，每个动作前检查；明确人工恢复前不续跑 |
| 去重与取消 | 已有冻结目标、所有权、租约、未知结果不重发等约束 | 保留这些比参考项目更完整的边界，不因采用参考流程而移除 |

相关本地代码：`apps/worker/src/boss-browser.ts`、`apps/worker/src/career-worker.ts`、`apps/worker/src/main.ts`。这些建议用于减少不必要访问、重复效果和异常后的持续操作，不能保证平台接受自动化。

## 验证范围

参考项目的验证文档明确记录没有执行真实招聘投递。FakeBrowser 和真实 Patchright 承载的本地合成页面可以验证分支、去重和回执算法，不能证明真实账号不会被限制或真实消息已送达。[验证记录](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/docs/VALIDATION-1.0.5.md#L20-L45)

本次没有复现当前账号的限制，也没有因果证据能把用户报告的风控归因到 Runtime.enable、某个启动参数或实际发送频率。先补全运行记录和上述停止机制，再由人工确认页面状态；不能用反复尝试站点来验证猜测。
