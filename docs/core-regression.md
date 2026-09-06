# 航刻核心逻辑自动化验收

验收日期：2026-09-07。分支：`feat/windows-mvp`。基准提交：`4fb990d0a07ced738fb6012528e25ba895066fa2`，测试对象为本轮执行时的真实工作区（包含 GPT 的未提交改动），不是仅该提交。

## 结果

原有 9 项测试全部保留。本轮新增 18 项，总计 **27/27 通过，0 失败、0 跳过**。最终完整运行约 7.7 秒。`tsc --noEmit` 和完整应用 Vite 构建通过；构建仅在内存中完成，没有覆盖正在使用的 `dist`。`git diff --check` 通过（仅有已有换行符提示）。未提交、未合并、未推送。

## 复跑

在 hangke 仓库根目录执行：

```powershell
npm test
```

沿用现有 npm test 入口和已安装的 Vite、Playwright，无新增 npm 依赖或配置。本次运行环境为 Node 24.15.0。新环境安装依赖后，浏览器验收需要安装与 Playwright 匹配的运行时：

```powershell
npx playwright install chromium --only-shell
```

只运行某组：

```powershell
node --experimental-strip-types --test tests/airports.test.ts
node --experimental-strip-types --test tests/distance.test.ts
node --experimental-strip-types --test tests/state-regression.test.ts
node --experimental-strip-types --test tests/persistence-browser.test.ts
```

## 真实调用链与新增覆盖

| 文件 | 新增测试 | 覆盖 |
| --- | ---: | --- |
| `tests/airports.test.ts` | 4 | 4008 条当前机场数据的唯一性、字段与坐标；机场查找、空搜索、IATA/ICAO/城市搜索；10–180 分钟换算；CGQ/HND/SFO/LHR/SYD × 全部 35 档时长的可达范围、排除起点、去重、距离准确性、误差排序与最多 6 个候选 |
| `tests/distance.test.ts` | 2 | 公里单位、距离对称性、同点、日期变更线、对跖点、近距离；大圆路径按比例推进距离与端点钳制 |
| `tests/state-regression.test.ts` | 7 | 空闲与重复操作、准确到期边界、多次暂停和重载、长暂停、恢复不缩短截止时间、输入不被修改、完成追加与去重、取消保留历史、时长合法边界、损坏结构和字段类型 |
| `tests/persistence-browser.test.ts` | 5 | 实际 app 启动读取 localStorage；暂停/恢复事件经过 commit 写入；重载恢复；focus 驱动 tick 到期完成；历史只写一次；暂停和完成保存失败时保留原状态并重试；普通点击不取消、长按取消后重载保留旧历史 |

机场调用链：`app.ts` → `search / reachable / focusDistanceKm` → `airports.ts` → 原始 JSON 和 `geo.distance`。

飞行调用链：`app.ts` 初始化 → `decode(localStorage.getItem(KEY))`；暂停/恢复事件 → `state.pause / resume` → `commit`；`tick` → `finalize` → `commit`；取消长按 → `cancel` → `commit`。写入成功之后才更新内存状态。

机场模块使用 Vite 将真实源码和 JSON 打包到内存后加载。浏览器组将真实应用打包到内存，通过随机本地端口提供页面，每个测试使用独立浏览器上下文与固定时钟，不接触用户浏览器存储。所有服务与上下文在测试结束时关闭。

浏览器组明确以测试替身使 `FlightMap` 构造失败，执行应用已有的地图不可用分支；不验证地图、WebGL、相机、地图动画或视觉效果。业务模块、存储、状态转换与 DOM 事件处理均使用实际源码。测试调用按钮事件处理，不依赖按钮位置或动画完成。

## 发现与最小修复

`state.ts` 的机场代码校验只使用正则，JavaScript 会将数组隐式转换为字符串，因此 `originIata: ["HND"]`、`destinationIata: ["SFO"]`、`lastAirportIata: ["HND"]` 可以通过校验；实际机场查找使用严格字符串比较，无法匹配这类恢复后的数据。

先补失败测试：状态组出现 2 项失败，明确显示数组被 decode 放行；独立验证确认数组可通过正则、却不等于机场代码字符串。随后仅补三个字段的 `typeof ... === "string"` 检查。修复后，活动航程、历史记录和最后机场中的数组代码都会按已有策略重置为空状态，合法及旧版存储仍正常恢复。状态组及最终完整回归均通过。

本轮业务代码只修改 `src/state.ts` 的数据校验，没有改动状态转换、飞行、暂停、历史写入或地图运动实现。

测试搭建时曾遇到缺失 Playwright 无头浏览器以及开发服务器资源请求长时间未完成。前者通过安装测试运行时解决；后者通过独立内存构建避开，未将其判定为业务缺陷。最终机场和浏览器测试都不使用开发服务器热更新或共享预构建缓存。

## 并行修改边界

开始时已有未提交改动：`package.json`、`package-lock.json`、`src/app.ts`、`src/airports.ts`、`src/styles.css` 和现有 UI/Windows/运动验证脚本。过程中还观察到 `src/main.ts`、票面样式和资源持续变化。本轮没有编辑这些文件，也没有运行或改写 GPT 的起飞前、选座、值机或撕票交互验收。

本轮交付仅包括四个新增测试文件、`src/state.ts` 的最小校验修复及本文档。

## 剩余覆盖边界

- 起飞按钮创建 activeFlight 的完整入口仍与 GPT 正在进行的起飞前流程耦合；浏览器测试直接注入合法在飞状态，不宣称覆盖该入口、选座或票面交互。
- 航线选择覆盖真实机场筛选与排序函数；不覆盖候选卡片和地图点击交互。
- 已覆盖暂停和完成的写入失败；localStorage 读取抛错、恢复和取消的写入失败尚未单独建立浏览器用例。
- 本轮未运行 Windows 可执行文件/WebView2、实际关闭重启程序或操作系统休眠；使用浏览器重载和固定时间验证对应核心时间逻辑。
- 不覆盖多个窗口同时写入同一存储，以及系统时间大幅回拨的整体产品行为；未为这些场景增加新需求或兼容层。
- GPT 后续修改真实应用后应重新执行 `npm test`；此次通过仅代表本轮运行时的代码快照。
