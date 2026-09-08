# 给 Agent 和新来的人

Nearbox：手机记想法，电脑跑 Agent。Electron 主进程常驻托盘，起一个只对局域网开放的 HTTP / WebSocket 服务；
同一套 React 页面既是电脑窗口，也是手机浏览器里的界面；Android 只是一个找到电脑、打开页面的薄壳。
各模块的职责见 `README.md` 末尾「架构」一节。

## 先读什么

- `docs/scope.md`：它是什么、不是什么。动手前对一眼，尤其是「不做什么」。
- `docs/decisions/`：为什么是现在这样。改到某个模块前，读文件名相关的那几条。
- `README.md`：今天的行为，用户视角。它是行为规格，不是宣传页。

## 三条规则

1. **不在边界外动手。** 需求不属于 `docs/scope.md` 的核心场景，或撞上「不做什么」，不要直接实现：
   先在 `docs/decisions/` 写一条状态为「待定」的记录，把取舍摆出来，等人拍板。
2. **取舍要留痕。** 做了不显而易见的选择——选了 A 没选 B、绕过了某个工具的坑、改动了用户环境里 Nearbox 之外的东西——
   在同一次改动里补一条决策记录。写法见 `docs/decisions/README.md`。
3. **行为变了就改 README。** 用户可见的行为有变化，同一次改动里更新 README 对应段落。
   README 只描述「现在」，不写历史和迁移说明；历史在 git log 和 GitHub Releases 里。

## 代码约定

- 界面文案、给用户看的错误、发给 Agent 的提示词用中文；标识符、注释、提交信息用英文，提交信息带 `feat:` / `fix:` / `chore:` 前缀。
- 提示词和路径永远不经过 cmd.exe 的命令行：Windows 上解析 `.cmd` 壳找到真正的 `node.exe + 脚本` 或 `.exe` 再 spawn；远端电脑用 PowerShell `-EncodedCommand`。
- 纯逻辑抽成不依赖 Node / Electron 的函数，配同目录的 `*.test.ts`；测试用 `node --test` 跑，新测试文件要加进 `package.json` 的 `test` 脚本，否则不会被执行。
- 页面由电脑下发，所以主进程和页面之间的 `src/shared/protocol.ts` 总是同版本，可以放心改。
  真正要向后兼容的是 Android 壳读的那一小块：`src/shared/discover.ts` 里 `/api/discover` 的应答、UDP 广播和 `nearbox://connect` 邀请格式——手机上的 APK 可能落后好几个版本。
- 运行时依赖只有 `ws`、`qrcode`、`lucide-react` 三个；能用几十行写清楚并配上测试的，就不引入库。

## 验证

```powershell
npm run typecheck
npm test
```
