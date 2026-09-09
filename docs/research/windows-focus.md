# Windows 勿扰 / 专注：最小集成研究（2026-09-08）

本轮仅研究，没有执行系统设置、注册表、安全策略或其他程序控制。

## 结论

Windows 11 的专注会话可自动启用勿扰；勿扰仍允许用户配置的优先通知、提醒和闹钟。Windows 10 对应专注助手。它们不等于关闭其他应用，也不能保证屏蔽应用自绘弹窗、声音或覆盖层。[Microsoft 支持](https://support.microsoft.com/en-us/windows/experience/focus-stay-on-task-without-distractions-in-windows)、[通知与勿扰](https://support.microsoft.com/en-us/windows/notifications-and-do-not-disturb-in-windows-feeca47f-0baf-5680-16f0-8801db1a8466)

## 可用接口和边界

- 官方 `ms-settings:` URI 可打开系统设置，由用户亲自开启。文档列出 `ms-settings:quiethours`（专注助手）、`ms-settings:notifications`（通知）。页面可用性随系统版本与SKU不同，失败时给出手动导航，不宣称开启成功。[设置 URI](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings)
- `Windows.UI.Shell.FocusSessionManager` 有 `IsSupported`、`IsFocusActive` 和变化事件。但文档要求API contract v15，标注从Windows 11 Insider 23504引入；不能当作所有Windows 10/11的通用接口。
- `TryStartFocusSession`、`DeactivateFocus` 属于 Limited Access Feature，须申请解锁令牌，不能绕过限制；后者会结束所有会话，不适合作为本应用退出时的清理动作。[官方 API](https://learn.microsoft.com/en-us/uwp/api/windows.ui.shell.focussessionmanager?view=winrt-26100)
- 没有在本次核对的官方文档中找到面向普通桌面应用、跨Windows 10/11保证可用的全局勿扰写入接口。此结论是本轮资料覆盖范围，不等于断言Windows内部不存在实现。

## 建议的最小方案（未实现）

在现有登机信息旁提供一个明确的“打开系统通知设置”动作；只有用户点击才调用一个无任意参数的Tauri Rust command，通过受支持的系统URI启动设置。后端固定URI白名单、限制为本地窗口权限，不提供通用shell/任意命令。现有工程未引入opener/windows依赖，本轮不安装。后续若批准实现，再选择最小系统调用绑定并验证Win10/11失败回退。[Tauri commands](https://v2.tauri.app/develop/calling-rust/)、[Capabilities](https://v2.tauri.app/security/capabilities/)

不绑定起飞计时、不自动修改勿扰、不在降落时恢复全局设置；用户已有专注会话完全由系统管理。没有状态读取能力时仅显示“请在系统中开启”，不显示虚假的已开启标记。
