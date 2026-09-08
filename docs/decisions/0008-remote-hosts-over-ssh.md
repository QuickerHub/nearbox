# 0008 另一台电脑上的项目一律通过本机的 ssh 客户端操作，远端不装任何东西

- 状态：已采纳
- 日期：2026-09-06
- 相关：`src/main/ssh.ts`、`src/main/hub.ts` 和 `src/main/runner.ts` 里 `RemoteDevice` 相关部分、`src/renderer/src/ui/RemoteDirBrowser.tsx`。
  注意 `src/main/remote.ts` 是远程桌面（0010），和这条无关。

## 背景

项目不一定在跑 Nearbox 的这台电脑上：可能在家里的另一台机器、一台 Linux 服务器。要在那里跑 Agent，
就得能列目录、传文件、启动进程、读实时输出、必要时杀掉进程。选项是在远端也装一个 Nearbox 代理，
或者复用用户已经配好的 ssh。

## 决定

所有对另一台电脑的操作都通过本机 `ssh` 命令完成：一台设备能不能用，等价于终端里 `ssh <host>` 能不能通。
探测时先试 PowerShell 再试 sh，判断远端是 Windows 还是 POSIX；列目录、写文件、启动 Agent 都是往 ssh 里送一段脚本。
Windows 端脚本以 base64 UTF-16LE 走 `powershell -EncodedCommand`，POSIX 端用单引号转义，提示词内容不经过任何 shell 的命令行解析。
启动 Agent 时把 pid 记到文件，取消时按 pid 文件杀进程树。

## 后果

- 远端不需要装 Nearbox、Node 或任何代理，但需要装好并登录了 Agent CLI；非交互 ssh 的 PATH 不含 `~/.cursor/bin` 这类目录，脚本里手工补。
- 远端运行拿不到 ACP 常驻进程（见 0006），也用不了 `nearbox` 委派命令（见 0009），走一次性进程。
- Windows sshd 在连接断开后会留下静默进程，pid 文件是唯一可靠的收尾办法，别删。
- ssh 自身的失败退出码是 255，其他退出码来自远端命令；`explainSshFailure` 把 stderr 翻成一句用户能行动的话。
