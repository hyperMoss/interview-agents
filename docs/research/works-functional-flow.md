# works 功能与浏览器操作流程对照

固定提交 `21a96187a5e9f9028cb210db9e4d4b02cfbf2054`。本次研究读取源码，没有运行参考应用或复验其真实账号投递。下面先说明产品入口，再保留逐函数浏览器分析。

## 产品流程

1. 用户保存每个平台的关键词、城市、薪资、排除词、招呼语和运行间隔。FastAPI校验配置并存SQLite。运行任务时不允许改配置、简历或登录状态。[main.py 72–114](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/main.py#L72-L114)
2. 登录、检查状态与任务都提交到同一个TaskRunner后台事件循环，浏览器操作由BrowserAutomation集中持有。检查结果更新runner.sessions，管理页面每四秒读取dashboard的缓存状态，不是每次刷新管理页面就重新连接浏览器。[main.py 116–145](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/main.py#L116-L145)、[app.js 314–321](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/static/app.js#L314-L321)
3. 用户选择preview或deliver。只有use_ai开启时才要求AI配置和个人经历；图片文件仅在deliver且send_image开启时必需。纯搜索预览无需先上传图片或配置模型。[engine.py 93–116](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L93-L116)
4. 两种模式共用搜索、去重、硬条件过滤与可选AI匹配。preview把结果保存为preview，不调用apply；deliver登记发送尝试后才调用apply。[engine.py 132–204](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L132-L204)
5. 页面展示统计、任务进度、日志、岗位详情、招呼语和处理说明，可筛选、分页、导出CSV、加入黑名单。deliver按钮只有一次任务级确认，没有当前项目的逐岗冻结批准清单。[app.js 224–260](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/static/app.js#L224-L260)

## 对当前项目的结论

- 优先借鉴独立的站点搜索预览。浏览器登录和搜索验证不该被AI连接、简历上传阻塞；个性化匹配和备题再要求真实资料与模型。当前已新增search权限模式，但完整career任务仍要求简历和模型，二者不能混为已实现。
- 保持一个明确的浏览器控制器，并让该控制器回写应用状态。当前Worker已接管专用profile，登录识别已在实际页面读到ready；不再通过日常Chrome窗口判断。
- 首页登录完成到职位页搜索需要独立过渡。当前真实只读证据显示`/guangzhou/`首页可见`input[name=query]`，首页表单为GET `/web/geek/jobs`，不等同于已验证职位列表接口、城市下拉或薪资筛选。不能把职位SPA的控件选择器直接用于SEO首页。
- 保留本项目精确批次批准、不可变原文件、原文依据、归属校验、租约代际与未知不重发。参考项目的图片消息、重新搜索投递和单进程锁不满足这些既定要求。
- 不把其默认50次/日、每岗5–10秒等待当作平台许可或不会触发风控的保证。

## 逐函数浏览器分析

# works 浏览器与执行引擎完整流程

2026-11-02，固定源码提交 `21a96187a5e9f9028cb210db9e4d4b02cfbf2054`，目录 `/tmp/works-patchright-reference`。本次只读源码与仓库验收文档，没有启动参考项目、浏览器或招聘平台，没有登录或发送。下文“已实现”表示有实际函数及调用链，不表示已通过当前真实平台验证。

基础链接均指向该固定提交：[browser.py](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py)、[engine.py](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py)、[storage.py](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/storage.py)。

## 1. 所有权、生命周期与队列

真实类名是 `BrowserAutomation`，不是 BrowserManager。`TaskRunner.__init__` 创建唯一后台线程及 asyncio loop；浏览器对象与全部方法在同一 loop 执行，HTTP 线程通过 `run_coroutine_threadsafe` 提交协程。`RLock` 保护任务快照与 `session_busy`；任务运行时拒绝另一个任务、登录或清除会话，status 仍可只读调用。源码不是每岗启动一个线程或浏览器，也没有 Redis/BullMQ 或跨进程任务队列。[engine.py 20–81](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L20-L81)

`_driver` 对 BOSS 启动 Patchright Python，对其他平台启动 Playwright；`_context` 按平台缓存一个持久 context，目录 `data_dir/profiles/<platform>`，headed，BOSS 使用原生窗口，优先系统Chrome，仅二进制缺失时才依次尝试Edge及Chromium。`_page` 复用 context 的首个页，后续复用它。context关闭触发 `_forget`。[browser.py 155–246](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L155-L246)

`logout` 清该context cookies、关闭context，然后仅删除受校验的本应用平台profile，包含IndexedDB；不是网站内点击退出。`close` 关闭所有context与两套driver。Runner关闭先设置停止标志、有限等待正在执行的任务，再关闭browser/loop/thread。[browser.py 337–364](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L337-L364)、[engine.py 227–241](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L227-L241)

局限：单线程规则约束同一进程，不等同于本项目跨进程profile锁、租约代际和旧执行者隔离。

## 2. 登录及站点限制

`open_login → _page → _context`；若当前页不属于平台，首次进入公开首页。调用 `status`，unknown时最多等8次400ms；只有检测到未登录才跳 `/web/user/`。需要时切扫码控件，最后聚焦窗口。重复打开不会替换已在平台上的登录/验证页。[browser.py 299–330](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L299-L330)

`status` 不启动浏览器、不创建页：没有现有页即closed；依次识别导航循环/异常空白、验证文本或URL、登出标志、用户标志，否则unknown。`_watch_navigation` 仅记录主框架净化路径，12秒内6次导航或同路径4次视为不稳定。`_guard` 在动作中检测验证、次数上限、登录失效并抛错，`_before_navigation` 在覆盖已有BOSS页面前执行guard。[browser.py 180–199](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L180-L199)、[257–297](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L257-L297)、[332–335](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L332-L335)

局限：这里主要是检测时抛错/终止当前任务，没有本项目显式检查才解除的持久暂停锁存。Patchright本身不提供账号限制解除保证。

## 3. 搜索与逐岗详情

1. `TaskRunner.start` 冻结本次settings内存快照，校验AI、图片、每日次数，保存running任务，提交 `_run`。[engine.py 93–116](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L93-L116)
2. `_run` 消费 `BrowserAutomation.search` 异步生成器。`search_cities` 使用内置城市/别名或明确高级城市码，未知城市报错。`build_search_url` 对BOSS生成 `/web/geek/jobs?query=...&city=...`，其他高级筛选一起编码；不是操作原生筛选后验证其请求。[browser.py 90–133](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L90-L133)
3. `search` 循环城市×关键词，`page.goto` 后等待1500ms，按max_pages循环，每页guard，等待卡片。仅51job/猎聘订阅网络响应并尝试 `_api_jobs`；BOSS主要 `_dom_jobs`，读取卡片标题/公司/薪资/城市/标签/链接，缺链接时点卡片读取右侧 `a.more-job-btn`。[browser.py 387–408](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L387-L408)、[460–538](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L460-L538)
4. `_normalize_job` 校验https平台域、提取稳定external_id、解析薪资；BOSS对专用字体薪资字符做固定映射。`search`按external_id去重，记录来源列表URL/页号/关键词。
5. 每个新岗位 `_detail` 在同context新开一页，进入详情，等待800ms，guard，读取JD/HR活跃/猎头/公司；成功关闭详情页，异常保留页。然后yield给engine做筛选与匹配。[browser.py 370–385](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L370-L385)、[438–458](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L438-L458)
6. `_next_page`先点可用下一页；BOSS没有下一页时将最后卡片滚入视野并向下滚1500px，等待1500ms。用本页新增ID判定是否继续。[browser.py 540–563](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L540-L563)

这些是可执行适配函数，不是API规格占位。但它缺少本项目“原生控件实证、请求响应关联、明确成功业务码、当前面板与保留岗位身份对应”的严密证明，不能直接覆盖本项目response-backed适配器。其每岗详情新页和构造搜索URL也与当前需求冲突。

## 4. 从筛选结果到一次投递

`_run`先按本次seen集合及持久delivery_ledger排除重复，再执行 `filter_job`（关键词、城市、薪资、黑名单、HR活跃/猎头）。可选 `match_job` 生成score/greeting，低于配置阈值过滤；AI失败立即终止，没有demo替代。preview只保存预览记录；deliver仍是新一轮搜索/过滤，不是将预览逐条冻结批准。[engine.py 132–182](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L132-L182)

投递前再次检查每日次数，先保存submitting记录，再 `claim_delivery` INSERT OR IGNORE ledger抢占，之后调用 `browser.apply`。ledger抢占失败则不发送。[engine.py 174–203](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L174-L203)

`apply`检查职位URL域与图片文件类型，在context内新开任务页并收集其popup；goto详情、guard、找唯一可见申请按钮。BOSS按钮文本已沟通/已申请则already_contacted；未找到或禁用即failed。**点击前设置clicked=true**，超时也可能有副作用。`_find_apply`在猎聘/智联按钮歧义时才回原列表，逐卡按exact external_id找按钮，BOSS不做该fallback。[browser.py 565–598](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L565-L598)、[759–812](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L759-L812)

## 5. BOSS 原生招呼、定制文字、图片三个阶段

- `apply`先点击职位原生立即沟通按钮，该点击自身可能发送平台原生问候；之后 `_boss_message` 才尝试自定义内容。即使后续失败，也不能说没有任何沟通。[browser.py 785–797](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L785-L797)
- `_boss_open_chat`最多40轮检查原页和该页popup。必须进入平台域 `/web/geek/chat` 且看到完整聊天编辑器；处理“继续沟通”确认框；旧版 `.startchat-dialog` 必须先关闭并等hidden，再点详情聊天入口，避免覆盖层挡点击。[browser.py 617–660](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L617-L660)
- `_boss_message`先采当前相同文本回执，fill完整聊天编辑器，等 `.btn-send:not(.disabled)` 可见，再点发送。随后最多40×300ms检查guard与新回执；匹配规范化文字，要求回执行数量增加且末条ID不在发送前集合，并以delivery/read判为sent、status-error判失败。旧客户端ID被服务器改名不够，必须有新增行。[browser.py 662–712](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L662-L712)
- 文字确认后才 `_boss_image`。定位“发送图片”工具栏，优先set_input_files，fallback file chooser；必要时仅确认带图片且“发送图片/图片预览”的预览框。最多40×400ms检查新增自己的图片消息ID及delivery/read，检查失败toast。图片未知时保留页面，并明确文字已经送达，避免重发文字。[browser.py 714–757](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L714-L757)

**重要能力区别**：这里上传的是 PNG/JPG/JPEG/WEBP 图片简历，通过聊天“图片”功能发送。没有PDF/DOCX原附件上传、站内已有简历选择、接收方同意后发送附件、原始文件hash核验路径。`send_image`不是“已经实现原始简历附件投递”。完整聊天页是否属于目标招聘者主要依赖原生导航链；代码没有本项目要求的独立recipient身份冻结与验证。

非BOSS `_result_after_click`最多12×500ms轮询guard，以成功提示或原按钮变为已申请/已投递等文字确认，否则unconfirmed。[browser.py 599–615](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L599-L615)

## 6. 结果、节奏与停止/重启

- `apply`仅关闭自己创建的任务页及popup。验证/登录/次数限制或unconfirmed时保留供人工核对；关闭失败只记warning，不覆盖已经确认的发送结果。[browser.py 797–812](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L797-L812)
- engine将结果限制到submitted/already_contacted/unconfirmed/failed。异常亦为unconfirmed；写ledger+jobs后，unconfirmed或failed立即结束整次任务，不自动重投。[engine.py 184–203](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L184-L203)
- 每个处理完且未提前continue的岗位后等待random.uniform(delay_min,delay_max)，默认5–10秒，等待每250ms响应停止；该等待没有跨重启的nextAllowedAt持久记录。硬过滤、历史去重等continue路径跳过这次等待，因此不能把它描述为“所有浏览器动作至少间隔5秒”。每日默认50次尝试不是平台官方安全额度。[engine.py 125–130](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L125-L130)、[204](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L204)
- stop仅设置event及stopping状态，等当前页面操作结束；浏览器方法内部不全面读取stop_event，不能保证停止请求后绝无下一次发送点击。[engine.py 118–123](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L118-L123)
- Store启动将jobs/ledger的submitting改unconfirmed；TaskRunner启动将running/stopping任务改interrupted，明确不自动恢复投递。保留ledger使用户新开任务仍跳过未知记录。没有租约过期恢复、fencing或可靠后台续跑。[storage.py 52–103](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/storage.py#L52-L103)、[187–211](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/storage.py#L187-L211)、[engine.py 27–32](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L27-L32)

## 7. 拒绝反馈与持久存储

deliver正常结束且没stop时，engine调用 `rejected_companies` 到聊天列表，最多10批，提取公司名及最后一条消息，识别“暂不合适”等文本，跳过省略公司名并加入本地黑名单。不是逐会话读取完整历史，也不是自动与HR谈话；人工同步可通过同方法触发。[browser.py 814–843](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/browser.py#L814-L843)、[engine.py 205–211](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/engine.py#L205-L211)

Store是单个SQLite文件：settings JSON、jobs、delivery_ledger、blacklist、logs、tasks。WAL，contextmanager事务，20秒busy timeout，非Windows数据目录700/文件600；settings对AI key/webhook调用protect，公开读取只给set标志。tasks存快照JSON，未充当可claim的任务队列。ledger主键(platform,external_id)是跨重启去重与本地每日预算来源。[storage.py 52–120](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/storage.py#L52-L120)、[187–211](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/jobs_app/storage.py#L187-L211)

## 8. 可复用顺序及验收边界

优先学习：单浏览器所有权；先明确登录状态再动作；打开任务页只关闭自有页；原生问候/自定义文字/图片分别记录；发送前后消息回执差分；先持久记录尝试再点击；未知不重试；重启把在途状态降为待核实；每日尝试预算跨重启；停止可打断等待。

不要直接移植：构造搜索URL替代本项目原生筛选证据；新详情窗口替代既定单窗口身份约束；AI分数阈值替代本项目grounded排序；图片简历替代原附件；单进程锁替代跨进程租约；preview后rerun替代冻结审批；每岗末尾等待冒充全部动作节流。

源码有完整可执行函数与合成测试，不是只写README。最新验收记录说明1.0.5全套83项及32个subtests通过；1.0.3/1.0.4用真实Patchright驱动内存页面测试图文与完整apply。它们均明确没有真实账号消息或平台送达验收。本次研究没有重跑这些历史测试。[VALIDATION-1.0.3.md 29–46](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/docs/VALIDATION-1.0.3.md#L29-L46)、[VALIDATION-1.0.4.md 23–41](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/docs/VALIDATION-1.0.4.md#L23-L41)、[VALIDATION-1.0.5.md 23–37](https://github.com/YuGuanzhou/works/blob/21a96187a5e9f9028cb210db9e4d4b02cfbf2054/docs/VALIDATION-1.0.5.md#L23-L37)

若复用源码需保留GET JOBS Non-Commercial License约束及署名；可先学习状态与验证方法，不复制平台代码。此报告不授权任何真实站点操作或外发；当前项目权限以实际配置和用户授权为准。
