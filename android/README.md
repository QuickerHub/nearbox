# Nearbox Android

薄壳，不带会话 UI。打开后自动扫描同一局域网里的 Nearbox 电脑，点一下即可配对；也可以扫描电脑上的二维码，或手动填 IP + 验证码。之后每次启动直接回到上次的电脑，页面始终从正在运行的电脑端加载。

因此：

- 日常只更新 Windows 安装包即可，手机看到的界面跟着电脑走
- APK 只在壳本身变了才需要重装
- 发布时 Windows 包会带上同版本 APK，电脑局域网提供 `/app/nearbox.apk`

版本号来自仓库根目录 `package.json`，用 `npm run android:sync` 写进 `version.properties`。
