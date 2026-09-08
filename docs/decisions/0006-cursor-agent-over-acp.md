# 0006 Cursor Agent 以 ACP 常驻进程运行，其他情形退回一句话一个进程

- 状态：已采纳
- 日期：2026-09-07
- 相关：`src/main/acp.ts`、`src/main/runner.ts`、`src/main/cursor-bundle.ts`；README「回复为什么快：常驻的 Agent 进程」

## 背景

命令行 Agent 每次启动要花 10 到 15 秒，主要在拉起用户配置的 MCP 服务器。每条消息新开一个 `cursor-agent -p` 进程，
说一句「好」也要等 20 秒，「每条任务就是一段对话」这个体验立不住。cursor-agent 提供 `acp` 子命令：
Agent Client Protocol，stdio 上一行一条 JSON-RPC 2.0 消息，支持 `session/new`、`session/load`、`session/prompt`。

## 决定

每种支持 ACP 的 Agent 保持一个常驻进程（目前只有 Cursor），多段会话共用。打开任务、把芯片指向某个 Agent 时提前把会话装好；
启动后几秒预载最近的会话。连续 120 分钟没消息进程自行退出，下一条消息再拉起。权限请求由 Nearbox 代答：
完全放开自动同意，安全模式把终端命令拿到界面上让人点。

以下情形自动退回原来的 `-p --output-format stream-json` 一次性进程：远程电脑上的运行、开了委派的运行、
选了常驻会话里没有对应预设的模型、这个版本之前用命令行模式创建的旧会话。

## 后果

- 常驻进程启动失败后 5 分钟内不再尝试，一律走一次性进程，避免每条消息都等一次失败。
- 打包后的 Nearbox 有时只找得到 `.cmd` 壳，`cursor-bundle.ts` 会到旁边找真正的 `node.exe + index.js`。
- `acp.ts` 只依赖 Node 内置模块，JSON-RPC 层和模型映射能用 `node --test` 单测。
- Codex / Claude Code / Grok / opencode 目前没有等价接口；哪天有了，照 `ACP_LAUNCH` 加一项即可。
