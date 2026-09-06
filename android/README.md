# Nearbox Android

薄壳，不带会话 UI。打开后自动扫描同一局域网里的 Nearbox 电脑，点一下即可配对；也可以扫描电脑上的二维码，或手动填 IP + 验证码。之后每次启动直接回到上次的电脑，页面始终从正在运行的电脑端加载。

无论是回到上次的电脑还是扫码 / 手动连接，壳都会先用 2 秒超时探测 `/api/discover`，确认电脑在线才把地址交给 WebView，探测期间停留在配对页显示「正在连接…」，不会黑屏等系统超时。手机没连 Wi-Fi（只有移动数据）时，配对页顶部直接提示原因，连上 Wi-Fi 后自动重试。

因此：

- 日常只更新 Windows 安装包即可，手机看到的界面跟着电脑走
- APK 只在壳本身变了才需要重装
- 发布时 Windows 包会带上同版本 APK，电脑局域网提供 `/app/nearbox.apk`

版本号来自仓库根目录 `package.json`，用 `npm run android:sync` 写进 `version.properties`。
