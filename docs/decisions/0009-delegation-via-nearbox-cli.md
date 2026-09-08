# 0009 Agent 之间的委派通过一个 `nearbox` 命令行完成，令牌只对这一次运行有效

- 状态：已采纳
- 日期：2026-09-07
- 相关：`resources/cli/nearbox.mjs`、`src/main/delegation.ts`、`src/main/scheduler.ts`、`src/main/prompt.ts`；README「Agent 之间互相委派」

## 背景

想让「Cursor 规划、Grok 实现、Claude 审查」这种组合在一条任务里跑起来，主 Agent 得有办法把子任务交出去并拿回结果。
可选的路子：给每个 Agent 配 MCP 服务器（每种 CLI 配法不同，还要改用户的配置文件），或者给它一个能在终端里调的命令。
所有支持的 Agent 都会执行终端命令，这是最小公分母。

## 决定

运行开了「允许委派」时，往 PATH 前面加一个 `bin` 目录，里面是 `nearbox` 命令（Windows 同时写 `.cmd` 和给 Git Bash 用的 sh 脚本），
提示词末尾附上用法。命令由 Nearbox 自带的 Electron 以 `ELECTRON_RUN_AS_NODE=1` 执行，不依赖用户装没装 Node。
它通过 `NEARBOX_URL` / `NEARBOX_TOKEN` / `NEARBOX_RUN_ID` 调本机 API：`ask` 创建子运行并等结果，`wait` 继续等，`status` 看列表。
令牌只能操作这一次运行，子任务不能再往下委派，权限不超过主 Agent。

## 后果

- 委派只在本机运行时可用；项目在远程电脑上时没有这个命令（见 0008）。
- `ask` 默认最多等 90 秒，落在各 CLI 的命令超时之内；没等到就返回一句提示让主 Agent 自己 `wait`。
- 主 Agent 等子任务时不占并发名额，否则「同一项目只跑一个」会让父子互相等死（见 0005）。
- 安全模式下每条 `nearbox` 命令都会先问用户，这是权限模型的必然结果，不为它开后门。
- `bin` 目录每次启动重写，因为 Electron 路径随更新变化。
