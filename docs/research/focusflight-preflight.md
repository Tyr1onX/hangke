# FocusFlight 起飞前流程研究

> 调研日期：2026-09-06
>
> 范围：只研究起飞前流程与状态转换，不研究飞行中计时、暂停、历史数据结构，也不建议复制 FocusFlight 的 Logo、插画、字体、文案或其他专属资产。

## 结论摘要

FocusFlight 的核心并不是把所有设置放在同一张表单里，而是把一次专注会话包装成一条连续、不可混淆的航旅状态链：

`选择/确认出发机场 → 地图上选路线和时长 → Book My Flight → 选座 → 为该座位指定 Focus Type → 确认 → 登机牌 → Check In（撕票）→ Airplane Mode 配置 → Boarding → Ready for takeoff → GO`

其中最值得复用的是信息出现顺序和状态门控：

- 航班规划阶段只处理路线和时长。
- Focus Type 不是预先铺满页面，而是在用户点选座位后以浮层出现。
- 座位被赋予 Focus Type 后，座位本身变成带活动图标和颜色的已选状态，再出现确认动作。
- 登机牌之后不是无交互占位，而是一个可完成的 check-in 手势；完成后界面明确进入下一状态，并继续给出 `Boarding`、`GO` 等动作。
- 每一步都通过一个明确动作提交当前 draft，再进入下一状态；在 `GO` 之前都仍是准备流程。

需要特别注意版本差异：Apple 当前页面显示版本 **2.0（2026-06-07）**；ScreensDesign 的完整实机录屏里，登机牌日期是 **2025/07/10**，因此录屏属于旧版。当前 2.0 的官方截图仍能确认“地图＋时间尺＋横向航班卡”的规划结构，但默认首页、完整选座和 check-in 的当前细节没有同等完整的一手视频证据。

## 证据等级

- **A｜当前官方**：Apple App Store 页面、Apple Lookup API、当前 App Store 官方截图、开发者官方域名。
- **B｜直接实机观察（旧版）**：ScreensDesign 14:57 全流程录屏及逐帧截图。可确认真实交互顺序，但不能默认等同于 2.0。
- **C｜公开实机补证**：Lemon8、Bilibili 等用户录屏/图文，只用于补足状态，不用于覆盖官方资料。
- **推断**：由相邻画面或当前/旧版材料交叉推出，均显式标注，不写成确定事实。

## 逐项研究结果

### 1. 默认首页与进入 flight flow

**直接观察（B，旧版首次使用）**

- ScreensDesign 的 `Starting a Focus Session` 章节从 03:20 开始；03:21 首屏是底部抽屉 `Select Your Starting Airport`，上方仍是地图，而不是同时展示时长、航班卡、座位和 Focus Type。
- 这个抽屉提供机场/城市搜索、`Use Current Location` 和 `Use Random Location`。
- 03:24 选择机场后出现二次确认抽屉 `Starting From Here?`，显示机场 IATA 与城市，并提供 `Confirm / Cancel`。

**当前官方可确认（A）**

- 版本 2.0 新增 `Random Route Mode`，官方说明是可不先选目的地而直接开始，落地后才发现目的地。这说明 2.0 可能存在不止一种进入 flight flow 的入口。
- 当前 App Store 规划截图左上角有返回控件，说明规划页有父级页面；但截图没有展示父级页面内容。

**不能直接确认**

- 当前 2.0 默认首页是否恰好采用“地图＋当前机场＋单一开始按钮”，公开官方材料没有完整画面。
- `开始专注飞行` 这一具体 CTA 文案不是 FocusFlight 证据，而是 Hangke 可以采用的本地产品文案。

**对 Hangke 的结构启示（推断）**

- 默认主页与规划页应分开是有证据支持的方向；默认主页只承担“当前所在机场/地图”和“进入规划”的职责较合理。
- 出发机场修改应作为克制的独立入口或抽屉，而不是与时长、目的地、座位、Focus Type 混成 planning console。

证据：[ScreensDesign 完整流程与章节](https://screensdesign.com/apps/focusflight-deepfocus-timer/)、[03:21 出发机场抽屉](https://media.screensdesign.com/avs-pr/8bad577f747c46e5af16fa13004e864f.webp)、[03:24 出发机场确认](https://media.screensdesign.com/avs-pr/cea1b66364c74d519b07e098963777da.webp)、[Apple App Store 官方页面](https://apps.apple.com/us/app/focusflight-deepfocus-timer/id6648771147)

### 2. 出发机场选择

**直接观察（B）**

- 机场选择是地图上的 bottom sheet，不是常驻大面板。
- 输入提示为 `Search Airport / City`，说明搜索同时面向机场与城市。
- 选择后不是立即进入下一步，而是先显示地图定位和 `Starting From Here?` 确认。
- 旧版文案写明出发机场确认后不能更改；这只代表该旧版首次使用流程，不能外推到当前 2.0。

**可复用结构**

- “打开轻量选择器 → 搜索/定位 → 在地图上预览 → 确认”比把出发机场始终展开更接近真实流程。
- Hangke 可以继续使用 `lastAirportIata` 作为默认当前机场，同时保留一个独立“修改出发机场”入口；不需要复制旧版“确认后不可修改”的限制。

证据：[03:21 出发机场抽屉](https://media.screensdesign.com/avs-pr/8bad577f747c46e5af16fa13004e864f.webp)、[03:24 定位确认](https://media.screensdesign.com/avs-pr/cea1b66364c74d519b07e098963777da.webp)

### 3. Duration ruler

**直接观察（A＋B）**

- 当前 App Store 官方截图显示一条水平时间尺，标注 `30m`、`40m`，刻度密集且长短分级；上方有固定的向下三角指针。
- 旧版 03:50 规划画面也显示相同结构：地图在上，时间尺靠近底部，航班卡在时间尺下方。
- 旧版航班卡出现 `33m`、`39m`，当前官方截图的卡片出现 `41m`。这表明 FocusFlight 的实际结果并非只使用 5 分钟整数。

**不能由公开材料确认**

- 静态截图无法证明惯性曲线、滚动期间是否逐帧吸附、停止后延迟多少毫秒，也无法证明它使用 5 分钟 snapping。
- 因此“原生惯性＋停止 100–150ms 后吸附到 5 分钟”应当视为 Hangke 自己的交互规格，而不是声称复制了 FocusFlight 的精确参数。

**可复用结构**

- 复用“内容移动、指针固定、数字和长短刻度建立层级”的结构。
- 滚动中的连续反馈与停止后的离散提交应分开；这是对当前视觉结构的合理实现推断，不是公开材料直接披露的算法。

证据：[当前 App Store 官方规划截图 1](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/a1/bb/9a/a1bb9ac0-4a76-bfaa-8152-c28c15d0b118/iPhone-EN-1.jpg/960x1440bb.jpg)、[当前 App Store 官方规划截图 2](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/cf/6c/c7/cf6cc7d9-5a39-ff46-6d59-bc2ca739e471/iPhone-EN-2.jpg/960x1440bb.jpg)、[旧版 03:50 规划页](https://media.screensdesign.com/avs-pr/dc2e55616ad243289970dccd18203a70.webp)

### 4. Flight card 与 selected 状态

**直接观察（A＋B）**

- 航班卡是地图下方的横向卡片组，一屏露出少量候选，暗示可横向浏览。
- 每张卡最醒目的是带飞机图标的 IATA 标签，其次是短城市/机场名与分钟数。
- 旧版 03:50：未选卡为深色底，IATA 使用黄色描边标签；selected 卡为浅色/白色实底、深色文字，IATA 标签仍保留黄色航空强调。
- 当前 2.0 官方截图延续了同一 selected 对比：未选深色，选中浅色；并没有把整张 selected 卡做成黄色实底。
- selected 卡与地图上对应机场同时高亮，并显示从出发点到目的地的路线。

**对 Hangke 的结构启示**

- 应复用“地图 marker、预览航线、carousel 卡片共用一个 selection”的状态结构。
- 可复用 IATA 优先、短城市名次之的内容层级；不要引入半中文半英文的长机场名。
- Hangke 是否把 selected 卡改为航空黄实底属于自身视觉语言选择；这不是 FocusFlight 当前官方截图的逐像素做法。

证据：[当前 App Store 官方规划截图 1](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/a1/bb/9a/a1bb9ac0-4a76-bfaa-8152-c28c15d0b118/iPhone-EN-1.jpg/960x1440bb.jpg)、[旧版 03:50 规划页](https://media.screensdesign.com/avs-pr/dc2e55616ad243289970dccd18203a70.webp)

### 5. 座位图结构和数量

**直接观察（B）**

- 点击 `Book My Flight` 后，界面整页切换到飞机俯视轮廓；规划地图、时间尺和航班卡不再与座位同屏。
- 顶部是机头/驾驶舱形状；座位采用窄体机 2–2 布局，列标为 `A C | D F`，中间是明确过道，排号位于过道中央。
- 录屏帧清楚显示 `01–07` 排，至少 28 个座位槽位；下方是否还有更多排无法从公开帧确定，因此不能宣称精确总数。
- 公开帧没有看到文字 `FRONT`，方向感主要由机头轮廓表达。若 Hangke 增加 `FRONT`，这是可用性增强，不是对截图的照搬。

**状态逻辑**

- 初始座位页只显示座位图，没有把 Focus Type 全部常驻展开。
- 用户点击具体座位后，Focus Type 选择浮层才出现。
- 选择活动后，对应座位被活动颜色填充并显示活动图标，页面随后出现 `Confirm` CTA。

证据：[03:56 初始座位图](https://media.screensdesign.com/avs-pr/0a3f790ad0024c3ebd02605be928f85a.webp)、[04:04 选座后 Focus Type 浮层](https://media.screensdesign.com/avs-pr/2ce5a6dd74fa427291e4b8b917616125.webp)、[04:05 已赋予活动的座位](https://media.screensdesign.com/avs-pr/35c6f8f3be8a46378a32061a3a31d7e4.webp)

### 6. Focus Type 出现时机与图标

**直接观察（B）**

- 点选座位后，浮层标题先显示座位号（示例 `Seat 03F`），再询问 `What do you want to focus?`。
- 旧版提供 6 个活动：`Work`、`Exercise`、`Read`、`Focus`、`Fly`、`Meditate`。
- 每个活动都是“独立图标＋名称＋独立色彩”的胶囊项，而非同质化文本按钮：
  - Work：笔记本电脑，紫色；
  - Exercise：跑步人物，青色；
  - Read：书本，绿色；
  - Focus：花/聚焦符号，黄色；
  - Fly：飞机，蓝色；
  - Meditate：冥想人物，粉紫色。
- 选中 Work 后，03F 座位变为紫色并显示笔记本图标；这把“座位”和“本次活动”绑定成一个清晰的视觉结果。

**当前官方旁证（A）**

- App Store 描述仍明确写有不同 Focus Types，并称其通过 seat options 选择；当前宣传图也展示了大量“图标＋活动名＋各自颜色”的 activity chips。

**对 Hangke 的结构启示**

- 先选座，再按需出现 Focus Type，是最明确的门控关系。
- Hangke 可以用本地 SVG 表达学习、代码、阅读、写作、事务，但应自行绘制，不复制 FocusFlight 图标造型、色板或品牌表现。

证据：[04:04 Focus Type 浮层](https://media.screensdesign.com/avs-pr/2ce5a6dd74fa427291e4b8b917616125.webp)、[04:05 座位确认态](https://media.screensdesign.com/avs-pr/35c6f8f3be8a46378a32061a3a31d7e4.webp)、[当前 App Store 官方活动视觉](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/cf/6c/c7/cf6cc7d9-5a39-ff46-6d59-bc2ca739e471/iPhone-EN-2.jpg/960x1440bb.jpg)、[Apple App Store 官方描述](https://apps.apple.com/us/app/focusflight-deepfocus-timer/id6648771147)

### 7. Boarding pass 信息层级

**直接观察（B）**

- 登机牌覆盖在航线地图之上，与前一步形成明显页面切换。
- 最强层级是左右两端 IATA（示例 `PEZ`、`BWO`）；城市名紧随其下；中间显示时长 `33m`。
- 次级信息包括 `Seat 03F`、`Distance 144 mi`、`Boarding Now`、`Date 2025/07/10`。
- 底部是横向条码/票根，页面主动作是 `Check In`。
- 当前 App Store 官方宣传图仍展示同类登机牌：IATA、城市、时长、座位、距离、登机时间和条码是主要信息，没有堆叠完整机场长名。

**可复用结构**

- Hangke 的登机牌可以保留 `IATA → IATA / 中文城市 / TIME / DISTANCE / SEAT / FOCUS / DATE`，重点是强弱层级，不需要复制票面纹理、世界地图底纹或条码造型。

证据：[04:12 登机牌](https://media.screensdesign.com/avs-pr/2a328d8d7f83494ebd512a8ae30831e5.webp)、[当前 App Store 官方登机牌宣传图](https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/e7/92/cc/e792ccff-f04f-a536-8bd0-4fe7abaa98b3/iPhone-EN-3.jpg/960x1440bb.jpg)

### 8. Check-in 的下一步交互

**直接观察（B）**

1. 登机牌页显示可点击 `Check In`。
2. 进入 check-in 后，票根虚线左端出现圆形抓手；用户通过横向拖动完成撕票，而不是再点一个无反馈按钮。
3. 撕下的条码票根脱离主票并发生旋转/位移，形成“已值机”的完成反馈。
4. 随后页面显示 `Airplane Mode` 摘要、已选类别小图标和 `Edit`，并提供新的主动作 `Boarding`。
5. `Edit` 可进入 app/category/domain 选择页，也可进入场景预设（旧版可见 `Work / Focus / Fly / Exercise`）。
6. `Boarding` 之后出现独立状态页 `Cabin doors closed, Ready for takeoff.`，CTA 为 `GO`。
7. 点击 `GO` 后才进入飞行界面；04:56 的下一帧已显示实时路线和剩余时间/距离。

**交互动效可确认与不可确认**

- 相邻实机帧可直接确认票根由连接态变为分离、倾斜态，也能确认状态页顺序。
- App Store 官方页面中的用户评价提到“打印票”和“撕票根”伴随细致触觉反馈；这是用户报告，不是开发者规格，不能据此断言具体振动参数。
- 公开静态帧无法给出撕票弹簧、阻尼、阈值或动画时长。

**关键产品结论**

- `准备值机` 不应是终点文案或死按钮。它必须是一个真实状态，并至少提供下一动作：进入值机手势、完成值机，或继续 `Boarding`。
- 每个状态都只有一个主要完成条件；前一个完成后，下一 CTA 才出现。

证据：[04:12 Check In 入口](https://media.screensdesign.com/avs-pr/2a328d8d7f83494ebd512a8ae30831e5.webp)、[04:15 撕票交互](https://media.screensdesign.com/avs-pr/e38b37db5d5e465e8797b0ddd7edd454.webp)、[04:23 已撕票＋Boarding](https://media.screensdesign.com/avs-pr/3d02f9ea674949fabbe26e0a0b19a835.webp)、[04:36 app/category 选择](https://media.screensdesign.com/avs-pr/60cdf14701fb4546a932ceafe4036382.webp)、[04:42 场景预设](https://media.screensdesign.com/avs-pr/af4d2bfe5d29449bbcbd1998ef8c70eb.webp)、[04:50 Ready for takeoff＋GO](https://media.screensdesign.com/avs-pr/781351d5ced244889a8e8088eae15e90.webp)、[04:56 飞行状态](https://media.screensdesign.com/avs-pr/558abc8fb7324f49987eb2a54513c8c9.webp)、[Lemon8 公开实机图文](https://www.lemon8-app.com/%40life.of.aye/7553743619534946846?region=us)

## 建议给 Hangke 的起飞前状态模型

以下是基于上述观察整理的结构建议，不代表 FocusFlight 内部实现：

| 状态 | 只显示 | 完成条件 | 下一状态 |
| --- | --- | --- | --- |
| `home` | 地图、当前机场、开始 CTA、克制的改机场入口 | 点击开始 | `flight-planning` |
| `flight-planning` | 出发机场、duration ruler、地图候选、flight carousel | 目的机场已选并确认 | `seat-selection` |
| `seat-selection` | 完整机舱、座位 | 点选座位 | `focus-type`（浮层/渐进区） |
| `focus-type` | 当前座位号、图标化活动 | 选中活动并确认 | `boarding-pass` |
| `boarding-pass` | 核心航旅信息、Check In CTA | 点击 Check In | `check-in-ready` |
| `check-in-ready` | 可执行值机入口/手势 | 完成值机 | `boarding-ready` |
| `boarding-ready` | 值机完成反馈、可选配置、Boarding CTA | 点击 Boarding | 后续 Ready/GO（不在本轮实现） |

对现有数据边界的建议：上述状态全部属于 preflight draft；在未来真正 `GO` 前不创建 `activeFlight`，也不写 `startedAt`。这是 Hangke 架构约束，与 FocusFlight 公开材料无关。

## 未确认事项与实现时的边界

- **默认首页**：当前 2.0 的完整默认首页没有公开官方流程画面；只能确认规划页有返回控件，不能把具体主页布局写成“FocusFlight 原样”。
- **时间尺算法**：无法确认 snapping 单位、惯性参数和停止延迟。FocusFlight 画面反而展示 33/39/41 分钟，不能拿它为 5 分钟吸附背书。
- **座位总数**：旧版能确认至少 7 排、4 座/排，不能确认完整总排数；Hangke 应复用密度和布局关系，不硬编码成“FocusFlight 有 N 个座位”。
- **2.0 是否仍保留完全相同的选座/撕票细节**：官方描述仍保留 seat options、boarding、takeoff 等概念，但没有当前版本逐帧证据。实现时应沿用验证成熟的状态顺序，而不是逐像素复制旧版 UI。
- **60fps / Screenlane**：本次公开检索未找到可索引的 FocusFlight 专页，因而没有从这些站点引用具体交互结论。ScreensDesign 是目前可验证性最强的完整实机参考。

## 来源索引

### 当前官方（优先级最高）

1. Apple App Store 产品页：<https://apps.apple.com/us/app/focusflight-deepfocus-timer/id6648771147>
2. Apple Lookup API（版本、发布日期、版本说明、官方截图 URL）：<https://itunes.apple.com/lookup?id=6648771147&country=us>
3. 当前官方规划截图 1：<https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/a1/bb/9a/a1bb9ac0-4a76-bfaa-8152-c28c15d0b118/iPhone-EN-1.jpg/960x1440bb.jpg>
4. 当前官方规划/活动截图 2：<https://is1-ssl.mzstatic.com/image/thumb/PurpleSource211/v4/cf/6c/c7/cf6cc7d9-5a39-ff46-6d59-bc2ca739e471/iPhone-EN-2.jpg/960x1440bb.jpg>
5. 当前官方登机牌截图 3：<https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/e7/92/cc/e792ccff-f04f-a536-8bd0-4fe7abaa98b3/iPhone-EN-3.jpg/960x1440bb.jpg>
6. 开发者官方支持页：<https://focus.flights/support/>
7. 开发者官方用户协议：<https://focus.flights/terms/>
8. 开发者官方隐私政策：<https://focus.flights/privacy/>

说明：`focus.flights` 当前公开根域未提供可读取的产品 walkthrough；支持页只有联系方式，产品功能与当前版本信息主要以 Apple 官方页面为准。

### 完整实机流程（旧版）

9. ScreensDesign 14:57 全流程、143 个时间点截图：<https://screensdesign.com/apps/focusflight-deepfocus-timer/>
10. ScreensDesign 实机视频源：<https://vz-7812b4b7-1e2.b-cdn.net/6cadf86c-48e0-467c-a7c1-c930b973ad8d/play_720p.mp4>
11. 03:21 选择出发机场：<https://media.screensdesign.com/avs-pr/8bad577f747c46e5af16fa13004e864f.webp>
12. 03:24 确认出发机场：<https://media.screensdesign.com/avs-pr/cea1b66364c74d519b07e098963777da.webp>
13. 03:50 航班规划：<https://media.screensdesign.com/avs-pr/dc2e55616ad243289970dccd18203a70.webp>
14. 03:56 初始座位图：<https://media.screensdesign.com/avs-pr/0a3f790ad0024c3ebd02605be928f85a.webp>
15. 04:04 Focus Type 浮层：<https://media.screensdesign.com/avs-pr/2ce5a6dd74fa427291e4b8b917616125.webp>
16. 04:05 座位活动确认态：<https://media.screensdesign.com/avs-pr/35c6f8f3be8a46378a32061a3a31d7e4.webp>
17. 04:12 登机牌：<https://media.screensdesign.com/avs-pr/2a328d8d7f83494ebd512a8ae30831e5.webp>
18. 04:15 撕票：<https://media.screensdesign.com/avs-pr/e38b37db5d5e465e8797b0ddd7edd454.webp>
19. 04:23 已值机与 Boarding：<https://media.screensdesign.com/avs-pr/3d02f9ea674949fabbe26e0a0b19a835.webp>
20. 04:36 app/category 选择：<https://media.screensdesign.com/avs-pr/60cdf14701fb4546a932ceafe4036382.webp>
21. 04:42 Airplane Mode 场景：<https://media.screensdesign.com/avs-pr/af4d2bfe5d29449bbcbd1998ef8c70eb.webp>
22. 04:50 Ready for takeoff：<https://media.screensdesign.com/avs-pr/781351d5ced244889a8e8088eae15e90.webp>
23. 04:56 进入飞行：<https://media.screensdesign.com/avs-pr/558abc8fb7324f49987eb2a54513c8c9.webp>

### 公开实机补证

24. Lemon8 图文（登机牌撕票、Ready for takeoff、GO 等）：<https://www.lemon8-app.com/%40life.of.aye/7553743619534946846?region=us>
25. Bilibili 公开短视频：<https://www.bilibili.com/video/BV15Tt2zGEhT/>
26. Bilibili 公开体验视频：<https://www.bilibili.com/video/BV11GpXzeEZX/>
