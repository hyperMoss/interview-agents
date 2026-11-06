# works 的 Patchright 实现对照

2026-11-02，只读源码研究。没有访问真实 BOSS、启动浏览器、登录、发送消息或运行参考项目。GitHub connector 已读取仓库元数据，代码搜索没有结果，因此克隆公开仓库至临时目录并固定提交：`21a96187a5e9f9028cb210db9e4d4b02cfbf2054`。当前本地项目比较对象是 `/Users/gooingyu/Documents/project/interview-agents` 的未提交工作区，不能用 HEAD 代表该实现。

## 核心结论

works 没有一套能解除当前账号风控的特殊 Patchright 配置。其关键是 BOSS 单独使用官方 Patchright、可见系统 Chrome、专用持久 profile、原生窗口尺寸，以及保留已有验证页、出现限制就停止。这些核心做法当前项目已经具备。

官方 Patchright 说明它调整 Chromium 的部分 CDP 调用和默认启动参数。它不能证明此次 BOSS 风控的具体原因，更不能据此证明已有账号限制已经解除。[Patchright 官方说明](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright#patches)。

## 固定源码对照

| 方面 | works 固定源码 | 当前项目 | 建议 |
|---|---|---|---|
| 驱动 | BOSS 懒加载 `patchright.async_api`，其他平台 Playwright；Python 依赖固定 1.62.3。[browser.py 166–176](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L166-L176)、[requirements.txt](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/requirements.txt) | Node Patchright 1.64.2，`boss-browser.ts:646` 默认启用。 | 不需要为了参考项目降级 Python 版本或再换驱动。 |
| 浏览器与资料 | `launch_persistent_context`，headed、`no_viewport=True`、禁用下载；每平台一份专用 profile。仅二进制缺失时 Chrome→Edge→Chromium fallback。[browser.py 201–237](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L201-L237) | 相同核心参数：`channel:'chrome'`,`headless:false`,`viewport:null`,`acceptDownloads:false`；按 owner/engine 独立 profile，另有进程所有权锁。 | 保留已建立的 profile 和单控制器边界；不通过切换浏览器或清空资料试图解除已触发的限制。fallback 是安装兼容性策略，不能作为风控恢复依据。 |
| 初次入口 | 离站页先到公开首页；明确未登录才进 `/web/user/`，未知状态只等待，重复打开保留原页。[browser.py 299–318](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L299-L318) | `liveBossProfile.entryUrl` 为 `/web/geek/jobs`；只有首次显式 open 才允许一次导航，inspect 不导航。 | 首页入口值得作为独立、用户显式触发的登录入口设计对比；不能在风控页自动跳首页，也不能擅自改变已约定的一次导航语义。仍需未来真实只读证据验证，不能现在称为修复。 |
| 限制检测 | 观察主框架跳转，不留查询参数；12秒内至少6次导航或同路径至少4次视为不稳定。识别验证、频率、上限、异常退回空白并停止。[browser.py 178–199](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L178-L199)、[257–269](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L257-L269) | 已有安全/频率/导航循环检测、暂停锁存、显式人工检查才能恢复。 | 保留更严格的暂停锁存，不复制提示中的自动关窗重登流程。当前合成测试的限制分类失败应先离线定位。 |
| 节奏与额度 | 每个岗位处理后等待默认5–10秒；默认每日50次尝试，含失败和未知，持久计数；不确定发送不自动重投。[config.py 24–27](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/config.py#L24-L27)、[engine.py 174–204](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L174-L204) | 已有单任务30岗/批准10岗、跨任务去重、未知不重投；浏览器内可见等待多是条件轮询，不等于持久化的跨任务节奏。 | 可设计持久化的最小动作间隔、尝试预算与取消感知等待；不要照抄50次或5–10秒为“安全阈值”。这些配置不是 BOSS 官方许可额度。 |
| 搜索/详情 | 搜索构建URL并 `page.goto`；BOSS 读卡片DOM，详情开新页；网络响应捕获主要为51job/猎聘。[browser.py 432–449](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L432-L449)、[460–538](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L460-L538) | 真实搜索明确只驱动当前页控件并核对其自然请求/响应，限制30个身份，不构造搜索URL或新开详情页。 | 不直接搬此搜索实现，避免破坏原生筛选、证据归属和浏览器所有权契约。 |

## 证据边界

参考仓库自己的 1.0.1 记录明确：只在独立临时 profile 访问未登录公开首页与登录页，各观察20秒；没有使用真实账号、没有职位搜索或投递。[VALIDATION-1.0.1.md 23–29](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/docs/VALIDATION-1.0.1.md#L23-L29)。其文档还明确驱动检测只是可能诱因，没有证明平台内部判定机制。[同文13行](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/docs/VALIDATION-1.0.1.md#L13)。

参考项目的教学说明也明确随机等待和本地额度不能保证不受限制：[BOSS-automation-teaching.md 19–30](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/docs/BOSS-automation-teaching.md#L19-L30)。

其源码保留 GET JOBS Non-Commercial License；直接复制代码前需要核对许可证及署名。[THIRD_PARTY_NOTICES.md](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/THIRD_PARTY_NOTICES.md)。本研究没有复制其实现进入业务代码。

当前操作决策：真实 BOSS 维持暂停，`liveBossProfile.verified` 保持 false；先离线修复已有暂停分类缺陷及研究动作预算，再由用户明确恢复真实只读验证。不能通过本报告声称已解除本次风控。

## 补充核对

- `jobs_app/browser.py` 中未发现 `ignore_default_args`、`add_init_script`、自定义 `user_agent`、`navigator.webdriver` 覆盖或手写反调试覆盖实现；启动参数保持在上表所列参数集合中。此结论来自完整文件静态检索，不是运行时不可检测性证明。
- 每日尝试预算确实跨重启：`claim_delivery` 先插入 SQLite `delivery_ledger`，`attempts_today` 按该表的本地当天记录计数；与最终成功状态无关。[storage.py 187–203](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/storage.py#L187-L203)。每岗间隔只是内存等待，源码没有把下次允许动作的时刻持久化；不能误称其动作节奏也跨重启保持。
- 最小入口变更可以仅把当前项目首次 explicit open 的 `entryUrl` 改为公开首页，保留其余一次导航与人工恢复契约。这是可离线验证的入口策略调整，不代表现在可以访问真实站点验证，更不能称为已经解决账号风控。参考项目在明确未登录后还会自动再跳登录，本项目不应直接复制这个额外导航。
