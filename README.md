# 航刻 · hangke

把一段专注时间变成一次真实世界地图上的旅行。v0.1.0 面向 Windows：本地选择机场、填写任务和时间、沿大圆航线飞行，完成后把航线保存在自己的世界地图上。

## 当前功能

- 全屏深色 Globe 地图、航线预览、真实距离、SVG 飞机和倒计时。
- 本地搜索 4,008 个机场，支持 IATA、ident、城市和机场名称；结果最多 8 条。城市和机场名称沿用 OurAirports 原始文本，例如 `Changchun`、`Tokyo`。
- 专注 10–180 分钟，步长 5 分钟，默认 60 分钟；航程距离不限制专注时长。
- 起飞立即保存；关闭、睡眠后按 `startedAt` / `endsAt` 恢复。到点只保存一次，下一程默认从上次降落机场出发。
- 提前结束需确认，不保存部分航程；航迹列表可查看路线、任务、日期、时长和距离。

航程仅保存在此 Windows 用户的 WebView `localStorage`（`hangke.v1`）。清除应用数据会删除航迹。机场搜索离线可用，底图需要网络。系统时间调整会影响按墙上时间计算的倒计时。

## 技术栈与文件

Tauri 2、Vite 8、TypeScript、原生 HTML/CSS、MapLibre GL JS 6.7、OpenFreeMap。没有后端或数据库。

```text
src/
  main.ts             启动
  app.ts              界面与航班流程
  map.ts              MapLibre、航线、飞机
  state.ts            唯一持久化模型、校验、幂等降落
  airports.ts         本地搜索
  geo.ts              距离、大圆插值、方位角
  styles.css
  data/airports.json
scripts/update-airports.py
src-tauri/            Windows 窗口与打包
tests/core.test.ts    计时、持久化、地理边界测试
```

## Windows prerequisites

- Node.js 24 LTS 与 npm。
- Rust stable 的 MSVC 工具链。
- Visual Studio C++ Build Tools，安装“使用 C++ 的桌面开发”及 Windows SDK。
- Microsoft Edge WebView2 Runtime。
- Python 3 仅更新机场数据或重新生成图标时需要。

详见 [Tauri Windows 环境要求](https://v2.tauri.app/start/prerequisites/)。

## 本地开发与构建

```powershell
npm install
npm run tauri dev
```

仅调试网页可用 `npm run dev`。

```powershell
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

Windows 可执行文件在 `src-tauri/target/release/hangke.exe`，NSIS 安装包在 `src-tauri/target/release/bundle/nsis/`。当前安装包未代码签名。

MapLibre 使用 `maplibre-gl-worker.mjs?worker&url` 和 `setWorkerUrl`，由 Vite 输出完整 worker，不能改成普通 `?url`。[MapLibre 6 官方 ESM / Vite 配置](https://maplibre.org/maplibre-gl-js/docs/#esm)。

生产页面自动验收：先执行 `npm run build`、`npm run preview`，另开终端执行 `node scripts/verify-ui.cjs`（需要本机 Edge）。真实 Windows 进程关闭 / 重启与到点降落验收：构建后执行 `node scripts/verify-windows.cjs`。验收使用独立临时浏览器资料目录，截图和结果写入被 Git 忽略的 `artifacts/`。短时降落验收会调整测试航班的开始时间，产品时长范围不变。

## 更新机场数据

```powershell
python scripts/update-airports.py
```

脚本只使用 Python 标准库，下载官方 `airports.csv`，保留有 IATA、有定期航班且坐标有效的普通机场，精简后写入 `src/data/airports.json`。更新后检查数据差异并重新构建。应用运行时不请求机场 API。

## 数据来源与 attribution

- [OurAirports 开放数据](https://ourairports.com/data/)：机场资料，Public Domain；[字段说明](https://ourairports.com/help/data-dictionary.html)。当前快照更新于 2026-09-06。
- [OpenFreeMap 官方地图样式](https://openfreemap.org/quick_start/)：使用 `https://tiles.openfreemap.org/styles/dark`。
- 地图保留 OpenFreeMap、© OpenMapTiles 和 OpenStreetMap attribution；[OpenStreetMap 版权与 ODbL](https://www.openstreetmap.org/copyright)。
