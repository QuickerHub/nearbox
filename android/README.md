# Nearbox Android

薄壳，不带会话 UI。打开后填电脑 IP + 验证码，或粘贴邀请链接；页面始终从正在运行的电脑端加载。

因此：

- 日常只更新 Windows 安装包即可，手机看到的界面跟着电脑走
- APK 只在壳本身变了才需要重装
- 发布时 Windows 包会带上同版本 APK，电脑局域网提供 `/app/nearbox.apk`

版本号来自仓库根目录 `package.json`，用 `npm run android:sync` 写进 `version.properties`。
