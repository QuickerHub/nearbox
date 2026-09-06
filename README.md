# Nearbox

电脑和手机在同一局域网里互传消息、图片和文件。独立软件，不依赖 Quicker。

电脑端是 Electron 窗口；手机扫二维码用浏览器打开同一套页面。不需要装 Android / iOS 应用。

## 为什么做成独立软件

Quicker 仓库里的 Remote /「手机连接」和 [PR #610](https://github.com/QuickerOrg/Quicker/pull/610) 的互传，都绑在 Quicker Host、Headless Bridge 和 Android WebView 上。这条路重、难发布，也不适合当日常工具用。

Nearbox 只做一件事：

1. 电脑在局域网拉起 HTTP + WebSocket
2. 手机扫码加入
3. 两边在同一条会话里发文字、图片、文件

从现有实现里带走的部分：

- PR #610 的会话模型：气泡、图文/文件、按设备落盘
- `Quicker.Remote` 的传输边界：只绑私有网段、staging 后改名、可执行文件拒绝、不自动打开接收内容

刻意丢掉的部分：Quicker 身份、动作执行、Agent、Android 原生壳、mTLS / SPKI。

## 使用

电脑和手机连同一 Wi-Fi（或同一以太网网段）。

```powershell
npm install
npm run dev
```

窗口左侧出现二维码和 6 位验证码后，用手机扫码，或浏览器打开链接。之后两边可以直接发消息。

收到的文件在用户数据目录下的 `nearbox/inbox/<设备名>/`，电脑端点「打开接收文件夹」。

打包预览：

```powershell
npm run build
npm start
```

## 架构

```text
Electron 主进程
  LanServer  :17831
    /            同一套 React 页面（电脑窗口 / 手机浏览器）
    /ws          实时消息
    /api/text    发文字
    /api/upload  发文件（原始流，先写 .part 再改名）
    /api/files   取回已接收文件

手机 ──扫码──► http://192.168.x.x:17831/?t=<一次性邀请>
```

邀请码 30 分钟有效。配对成功后，手机用会话 token 重连，不必反复扫码。

## 仓库

计划放在 [QuickerHub/nearbox](https://github.com/QuickerHub/nearbox)。
