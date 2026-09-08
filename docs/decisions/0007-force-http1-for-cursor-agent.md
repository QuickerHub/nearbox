# 0007 主动改用户的 cursor-agent 配置，强制走 HTTP/1.1

- 状态：已采纳
- 日期：2026-09-07
- 相关：`src/main/cursor-http.ts`、`src/main/acp.ts`

## 背景

cursor-agent 默认用 HTTP/2 和模型服务通信，带 5 秒一次的 keepalive ping。一轮很长的思考、工具调用或者网络慢一跳，
ping 没按时回，整轮以 `RetriableError: PING timed out` 挂掉，已经写了一半的改动就断在那里。
官方给的绕法是切到 HTTP/1.1，开关在 `~/.cursor/cli-config.json` 的 `network.useHttp1ForAgent`。

## 决定

Nearbox 启动 cursor-agent 之前确保这个开关是 `true`：读用户的 `cli-config.json`（尊重 `CURSOR_CONFIG_DIR` 和 `XDG_CONFIG_HOME`），
没开就写进去，其余字段原样保留。刚翻过开关时回收已在 HTTP/2 下启动的常驻进程。
即便如此还是断了的话，同一轮最多重试 2 次，用「刚才因连接中断没有写完，请从中断处继续」接上。

## 后果

- **这是 Nearbox 唯一一处改动用户环境里自己目录之外的文件。** 它影响用户在终端里直接跑的 cursor-agent，不只是 Nearbox 派的。
  用户看到这个开关莫名其妙被打开，来源在这里。
- 写失败只警告不阻塞（比如文件只读），Agent 照常运行，只是可能遇到断连。
- Cursor 修好 HTTP/2 之后这条应当废弃，把写配置的逻辑整个删掉，而不是留着。
