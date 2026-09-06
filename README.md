# Nearbox

电脑和手机在同一局域网里互传消息、图片和文件。独立软件，不依赖 Quicker。

电脑端是 Electron 窗口。手机可以用系统相机扫码打开网页，也可以装一个薄壳 Android App。会话 UI 始终由电脑下发，所以更新 Windows 就等于更新手机界面。

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

## 发布

只维护一个版本号：根目录 `package.json`。打 `vX.Y.Z` tag 后，GitHub Actions 会：

1. 检查 tag、`package.json`、`android/version.properties` 是否同一版本
2. 编 Android 薄壳 APK
3. 把这份 APK 打进 Windows 安装包
4. 发布 [GitHub Release](https://github.com/QuickerHub/nearbox/releases)：Windows 安装包 / zip，以及同版本 APK

```powershell
npm version patch --no-git-tag-version
npm run android:sync
git add package.json package-lock.json android/version.properties
git commit -m "chore: bump version"
git tag v0.1.1
git push origin main --tags
```

tag 必须写成 `v` + `package.json` 的 version，对不上 CI 会直接失败。

更新习惯（从电脑来）：

1. 装新的 Windows 包
2. 打开 Nearbox，手机扫「连接」码就能用新界面
3. 只有薄壳本身变了，才让手机扫「安装手机端」码，从这台电脑下载 `/app/nearbox.apk`

不要单独升 Android 去配旧电脑。APK 不带会话页面，也配不上另一版协议。

## 架构

```text
Electron 主进程
  LanServer  :17831
    /            同一套 React 页面（电脑窗口 / 手机浏览器）
    /ws          实时消息
    /api/text    发文字
    /api/upload  发文件（原始流，先写 .part 再改名）
    /api/files   取回已接收文件
    /app/nearbox.apk  同版本 Android 薄壳（随 Windows 包分发）

手机 ──扫码──► http://192.168.x.x:17831/?t=<一次性邀请>
Android 薄壳只负责打开上述页面，不内嵌另一套 UI
```

邀请码 30 分钟有效。配对成功后，手机用会话 token 重连，不必反复扫码。

## 仓库

[QuickerHub/nearbox](https://github.com/QuickerHub/nearbox)
