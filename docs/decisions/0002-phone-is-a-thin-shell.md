# 0002 手机端是薄壳，界面永远由电脑下发

- 状态：已采纳
- 日期：2026-09-06
- 相关：`android/`、`src/shared/discover.ts`、`src/main/lan-discover.ts`；README「手机端」

## 背景

功能在飞快地变，每天好几个版本。如果手机上有一套自己的界面，每次都要同时改两端、发两个包，
手机还得跟着更新，否则两边对不上。

## 决定

Android 应用只做三件事：在局域网里找到 Nearbox 电脑（UDP 广播 + `/api/discover`）、完成配对（扫码或验证码）、
用 WebView 打开电脑下发的页面。业务界面和电脑窗口是同一套 React 页面，由电脑的 HTTP 服务提供。
手机浏览器直接打开同一个地址也能用。

## 后果

- 日常只发 Windows 安装包，手机打开就是新界面。APK 只在壳本身变了才需要重装，Windows 包内含同版本 APK，
  手机可以「从电脑安装」。
- 壳读到的那一小块协议要向后兼容：`discover.ts` 里的应答字段、UDP 广播格式、`nearbox://connect?host=&port=&t=` 邀请格式。
  用户手机上的 APK 可能落后好几个版本。
- `src/shared/protocol.ts` 不受此限制：页面和主进程总是同一次构建出来的。
- 不做 iOS 原生壳（见 `docs/scope.md`，待确认）：浏览器已经够用，做壳的收益只有「自动找电脑」。
