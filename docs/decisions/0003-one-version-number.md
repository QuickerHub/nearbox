# 0003 全仓库只维护一个版本号，发布由 tag 触发

- 状态：已采纳
- 日期：2026-09-06
- 相关：`package.json`、`android/version.properties`、`scripts/check-release-version.mjs`、`scripts/sync-android-version.mjs`、`.github/workflows/release.yml`；README「发布」

## 背景

一个仓库里有 Windows 安装包、Android APK、给 Agent 用的 `nearbox` 命令行三样东西，它们互相引用
（Windows 包内含 APK，手机从电脑下载 APK，页面显示版本、检查更新）。各自有版本号的话，很快就会对不上。

## 决定

版本号只写在根目录 `package.json`。`npm run android:sync` 把它抄进 `android/version.properties`；
打 `vX.Y.Z` tag 后 GitHub Actions 先核对 tag、`package.json`、`version.properties` 三处一致，再编 APK、
把 APK 打进 Windows 安装包、发 GitHub Release。

## 后果

- 不存在「只发手机」或「只发电脑」的版本；每个 Release 里两端同号。
- 版本核对失败会直接让发布失败，这是故意的，别绕过它。
- 正式 APK 必须用仓库 Secrets 里那把固定的 keystore 签名，指纹写在 `android/release-cert.sha256`，发布时核对。
  Actions 每次都是新机器，用默认调试证书会让手机拒绝覆盖安装。
