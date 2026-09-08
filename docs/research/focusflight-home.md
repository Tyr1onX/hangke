# FocusFlight home and secondary screens

Evidence checked: 2026-09-07. This is a design reference, not a claim of source-code equivalence.

## Verified public references

- Official App Store: https://apps.apple.com/us/app/focusflight-deepfocus-timer/id6648771147 . The current 2.0 release describes FlightLog, 3D route/window, Random Route and flight statistics. It does not fully document every current home screen.
- ScreensDesign, older recorded full flow: https://screensdesign.com/apps/focusflight-deepfocus-timer/ . The recording is not a current 2.0 walkthrough.
- Mine: https://media.screensdesign.com/avs-pr/6b03b700a0ad4da1bb94076f75c6ffc7.webp . Map-backed sheet, membership card and preferences.
- Trends: https://media.screensdesign.com/avs-pr/2d696f44a3af43c4960715036f76f854.webp . Total/Year/Month/Week/Day period selection, empty-data presentation.
- FlightLog: https://media.screensdesign.com/avs-pr/f4d2c5ea92f049029badd435a5a9abca.webp . Recorded status filtering; the older app includes states not persisted by hangke.
- World: https://media.screensdesign.com/avs-pr/34f612623b744d4f9853f71bcc6dca3c.webp . Personal globe and around-Earth distance card.
- World expansion: https://media.screensdesign.com/avs-pr/32eb83959da8412185d1d2ac8dd6a972.webp . Full-screen globe with controls for scenes, filters, themes and sharing.

## Confirmed versus requested

The map-backed sheets, period controls, personal route log and globe exploration are confirmed in the older public recording. The exact current 2.0 homepage greeting, radar animation, four-card arrangement, membership design and all secondary-screen transitions are not fully verified. The requested greeting/radar/navigation arrangement is implemented as hangke's own presentation rather than attributed to an unverified original screen.

## Local implementation mapping

- Home: current or last landing airport, local clock/greeting, CSS radar anchored to the existing map projection, journey entry.
- In progress: existing active flight only; resume returns to its original timer and route.
- My: original completed-flight history, with local summary. No invented cancelled-flight records or subscription state.
- Trends: completed-flight minutes, count and distance; local calendar buckets. No invented data or analytics service.
- World: existing completed routes, unique endpoint airports and country codes; existing MapLibre globe. No social totals, remote globe service or new map source.
- All additional navigation is transient presentation state. The persisted flight schema, clock, pause, landing and history-writing logic remain authoritative.

## 2026-09-07 用户截图逐页对照（实施前）

本轮以用户提供的六张 1179×2556 截图为直接证据。截图内航班/里程仅是原版示例，绝不写入 Hangke。
官方 App Store 本轮复核确认 FlightLog、3D 航线/地图和专注记录功能。公开 ScreensDesign 录屏长 14:57，目录包含 04:48–06:28 实时专注、06:28–09:51 统计与历史；详细帧目前标注 Unlock Pro，未观看的动作不作确认。此前文档中的旧录屏结论保留为历史证据，不能据此宣称当前版本像素或动作完全相同。

| 页面 / 证据 | 截图中可确认的视觉与信息 | 当前实现 Before | 本轮实现 After / 交互 |
| --- | --- | --- | --- |
| 首页 / 图6 | 夜间地球占全屏；灰色问候、醒目地点；单主按钮；我的/趋势/世界叠层入口；图中没有进行中 | 地图全屏，四项平铺；无航班仍显示进行中 | 保留桌面轻入口与时间/地点/代码，隐藏无航班进行中并让其余三项均分；有航班恢复第四项；不照搬手机底部堆叠占用桌面地图 |
| 世界 / 图1 | 蓝灰外层；横向“你的地球 / 3D 漫游”卡，左地球右箭头；世界卡片分区；黑色成就卡大数字、km、地球切弧与飞机；机场卡大数量、飞机及查看详情 | 几项数字和机场按钮列表，没有独立漫游 | 漫游横卡→独立地图漫游工具栏（返回、缩放、旋转、全览）；成就卡采用真实累计距离/40075 km计算圈数，单张不伪造可解锁卡组；机场卡展开有名称、国家/地区、最近到访和次数的真实端点记录 |
| 趋势 / 图2、3 | 五段周期；连续飞行日历采用舷窗状日单元；专注时间柱形图；航班卡为地图与航线；星期平均柱图；场景为分段环形图和分钟图例 | 单一柱图加统计数字 | 同一周期驱动时间/航班/星期平均/场景；连续日历独立按最近14日本地完成日计算（标题明确）；不同组件、无记录为零/空轨道，无虚假柱条；宽屏两列，窄屏单列 |
| 我的 / 图4 | 浅蓝皮质会员夹占顶部；下方偏好设置列表；Flight Log票据堆叠 | 3项汇总、历史列表 | 用深蓝个人飞行档案而非虚假会员：首次完成日、最后抵达机场、累计次数/时间/距离；Flight Log复用原历史列表和详情点击逻辑；无设置/会员/付费/编辑等假入口 |
| 进行中 / 图5 | 深绿外层、黑色票据，日期/状态、IATA/城市、时长、起飞/距离/到达；虚线和票根缺口；两个仪表；底部继续 | 普通数据卡与两项数值 | 按同样顺序排登机牌与时间/距离仪表，真实时间戳和进度驱动，继续返回现有飞行；暂停显示暂停状态，不新增结束逻辑；无航班自动返回首页且入口隐藏 |

### 几何与材质约束

截图外层圆角约80–100 px（手机大图）并非桌面照搬值。桌面采用18 px页面容器、12–16 px内容角、1 px低对比边框；主字号26–40 px，辅助11–13 px，机场代码等宽。世界色偏蓝灰、趋势中性炭灰、进行中微绿，仅色温差，不做彩色渐变。卡片按内容定高度，世界地球切弧本身是有意义的插画，趋势图分配固定可读高度。

宽窗页面最大760 px、保留地图边缘；900 px窗口使用约600 px宽面板、内部单列；顶部返回固定，内容区域滚动。漫游移开整块内容面板，以原MapLibre地球作为主体，鼠标拖动/滚轮和按钮可用，返回恢复世界面板。机场详情在面板内展开，定位在漫游内完成。

### 数据口径与无法确认项

- 圈数采用赤道周长40075 km，仅是本产品明确的显示口径；原版周长、舍入规则未知。保留两位小数，小于0.01圈显示“<0.01”，防止已有距离看起来为零。
- “到访机场”按已完成航班起终点去重，与既有统计口径一致；原图“到达机场”是否仅算目的地无法确认。每个机场详情分别给出抵达/出发次数。
- 连续飞行以本地完成日期计，今天尚无记录时从昨天续算；原版时区、断日与跨午夜归属未知。星期平均只除以该星期几有记录的日期数，与截图说明一致。
- 计时/距离来自现有activeSummary与progress，不重建时钟。暂停冻结这些量。原版“放弃专注”二次确认与取消记录口径未知，本轮仅保留现有飞行页的按住结束操作。
- 首页截图中心灰色圆盘是静态一帧，不能确认是雷达、加载还是点击反馈，继续沿用本地细线雷达。
- 3D原版转动惯性、透视/俯仰限制、机场卡跳转后的页面、世界卡组滑动/解锁均未确认；实现本地明确可用的旋转/缩放/机场详情/返回，不伪造这些功能。
- 插画复用已有ticket-world.svg及独立小型SVG航空符号，不改飞行中的飞机或尾迹，不引入第三方图片/依赖/API。

### 源码与验收版基线

初查：debug/hangke.exe修改时间19:42:45，src/map.ts为22:19:19，dist/index.html为22:29:44，旧验收版不是当前源码的构建。收尾必须重新构建并核对Windows内载入的前端资源与dist文件SHA256。


## 2026-09-08 实施与实际验证补记

实施遵循上述对照，飞机插画为独立静态符号、地球陆地使用已有ticket-world.svg，并非原版皮质/3D图片复刻。没有把截图的会员、编辑、设置或取消航班业务引入本地。

padding复现：传入66/390/66/66后locate仍保持旧padding（失败）；清零后通过。完整选航线→返回首次仍失败，radar约(641.88,205.41)，确认flight-back未调用locate；接通后浏览器(640,400)，Windows1280×800为(640,399.94)，Windows900×602为(450,300.96)。

最终npm run build、npm test(37/37)、git diff --check、Windows debug构建通过。两个Windows尺寸跑完相同空/有数据、漫游/返回、暂停恢复、漫游期间自动降落测试，页面脚本错误0。真实进程重启保持同一航班。运行中的内嵌JS/CSS与dist哈希一致；验收截图和指纹保存在本任务outputs/hangke-review。地图初次加载有网络等待，已另外截图确认地球瓦片实际显示，不以空黑地图截图当作加载成功。
