# Windows 真实生命周期与持久化验收

验收日期：2026-09-07。分支：`feat/windows-mvp`。测试对象是当前工作区源码，未提交、未合并、未推送。

## 结果

- `npm test`：**30/30 通过**，包含上一轮 27 项和本轮新增 3 项存储异常用例。
- `npx tsc --noEmit`：通过。
- Vite 应用构建：通过，输出到 `work/final-isolated-build-20260907/dist`，没有覆盖现有 `dist`。
- `git diff --check`：通过。
- Windows release：从当前源码构建到 `work/windows-lifecycle-20260907/target/release/hangke.exe`，SHA-256 为 `0345E3363F8F9DBF9BE2976B68886E5AAB95A43A6081A242A5F73CB3A79D4250`。
- 实际 Windows 验收：5 次原生窗口关闭，`gracefulCloseCount=5`、`forcedCloseCount=0`，隔离 WebView2 profile 已清理。

真实实例完成了以下链路：

1. 启动后恢复飞行中状态。
2. 飞行中关闭并重启，活动航程保持不变。
3. 点击真实暂停按钮后关闭并重启，暂停状态保持不变。
4. 将合法航程安排在截止前 2.5 秒后关闭，等待截止时间经过，再启动应用；启动恢复完成一次降落并写入一条历史。
5. 完成后再次关闭并重启，历史仍只有一条，活动航程仍为空。

测试使用独立 Tauri release 可执行文件、独立 `WEBVIEW2_USER_DATA_FOLDER` 和独立 CDP 端口。关闭通过 Windows `WM_CLOSE` 发给本次启动的窗口句柄；仅当该进程没有退出时才会对同一个 PID 做强制兜底，本次没有触发兜底。测试通过 localStorage 注入合法的活动航程，避开 GPT 正在修改的起飞前、选座、值机和票面 UI；暂停按钮、启动恢复、计时 tick、完成和历史写入均运行真实应用代码。

## 新增存储异常覆盖

`tests/persistence-browser.test.ts` 新增：

- `localStorage.getItem` 首次抛出 `SecurityError`：应用回退为空状态并显示读取提示；下一次启动恢复正常存储。
- 恢复操作写入失败：暂停状态和本地存储保持不变，恢复写入成功后只恢复一次。
- 取消操作写入失败：活动航程和历史保持不变，重试后取消且不产生部分历史。

当前源码的存储行为没有发现新的业务缺陷，因此本轮没有修改 `src/app.ts` 或 `src/state.ts`。上一轮的机场代码类型校验修复仍保留。

## 复跑 Windows 验收

在仓库根目录执行，以下命令只写入 `work/windows-lifecycle-20260907`：

```powershell
$temp = 'work/windows-lifecycle-20260907'
New-Item -ItemType Directory -Force -Path $temp | Out-Null
npx tsc --noEmit
npx vite build --outDir "$temp/dist" --emptyOutDir
$cfg = @{ build = @{ beforeBuildCommand = ''; frontendDist = '../work/windows-lifecycle-20260907/dist' }; bundle = @{ active = $false } } | ConvertTo-Json -Compress
$env:CARGO_TARGET_DIR = "$temp/target"
npm exec tauri -- build --no-bundle --config $cfg
Remove-Item Env:CARGO_TARGET_DIR
node scripts/verify-windows-lifecycle.cjs `
  "$temp/target/release/hangke.exe" `
  "$temp/runtime" `
  9357
```

脚本文件为 `scripts/verify-windows-lifecycle.cjs`。它不清理构建目录，但会清理本次运行的 WebView2 profile，并在 runtime 目录留下 `verification.json` 作为结果证据。

## 剩余边界

- 本轮没有覆盖安装器、卸载器、Windows 休眠/唤醒 API 或真实用户 profile；测试使用隔离 profile 和进程内等待模拟关闭期间跨截止时间。
- 关闭路径验证的是原生窗口 `WM_CLOSE`；应用崩溃或系统强制终止不属于本轮验收。
- 起飞前 UI 的创建航程入口仍由 GPT 继续修改，本轮没有把它纳入生命周期夹具。
- 多实例同时写入同一个 localStorage、系统时间大幅回拨、读取持续失败后的用户恢复入口仍未覆盖。
