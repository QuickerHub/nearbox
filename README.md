# Nearbox

手机记想法，电脑跑 Agent。

Nearbox 是一个跑在自己电脑上的任务管理器：手机随手记下想法和要做的事，电脑端把任务派给本机装好的编程 Agent（Cursor Agent、Codex、Grok Build、Claude Code、opencode）去干活，结果和实时日志两边都能看。独立软件，不依赖 Quicker，也不经过任何云端服务器。

## 它解决什么

- 想法总是在路上、床上、饭桌上冒出来，电脑不在手边 —— 手机打开 Nearbox 一句话记下，回到电脑前它已经在收集箱里。
- 有了环境（电脑开着、在家里的 Wi-Fi）就能开工 —— 在手机上把任务派给某个 Agent，指定项目目录，电脑立刻开跑，手机上看进度。
- Agent 干完后要有人跟进 —— 每次运行的总结写回任务时间线，还能「继续对话」让同一个会话接着改。

## 使用方式

### 电脑端（Windows）

1. 从 [Releases](https://github.com/QuickerHub/nearbox/releases) 装最新的 `Nearbox-x.y.z-win-x64.exe`。
2. 打开后它常驻托盘。整个界面就是一个输入框：输入框下面的「项目」芯片选（或添加）代码目录，「Agent」芯片选谁来干、放不放开权限；左侧是任务列表。「设置」里能看到检测到的 Agent CLI、配对手机、管理项目。
3. Agent 需要你先在本机安装并登录对应的命令行工具（任意一个即可）：
   - `cursor-agent`（Cursor）
   - `codex`（OpenAI Codex CLI）
   - `grok`（Grok Build）
   - `claude`（Claude Code）
   - `opencode`

### 手机端

1. 手机和电脑连同一 Wi-Fi。
2. 打开 Android 薄壳会自动查找同一网络上的电脑，点一下即可配对；也可以在应用里扫电脑「设置 → 连接手机」的二维码，或手动输入 6 位验证码。
3. 配对一次就记住了，电脑重启后不用重新扫码。Windows 安装包内含同版本 APK。

手机界面始终由电脑下发：更新 Windows 安装包就等于更新手机端。

### 一条任务的旅程

```text
手机：Agent 芯片选「只记录」，输入「给登录页加记住密码」  ──►  电脑左侧列表出现这条
电脑：点开它，Agent 芯片选 Codex、项目芯片选目录，按「运行」（或先补一句再「发送并运行」）
电脑：后台启动 codex exec，实时输出直接流进这条任务的对话里
结束：Agent 的总结留在对话里，系统通知弹出；不满意就接着打字，按钮会变成「继续对话」
```

每条任务就是一段对话。输入框旁边的按钮永远写着按下去会发生什么：「记录」「发送并运行」「运行」「继续对话」。
选好 Agent 和项目、在空白处直接输入并回车，等于新建任务并立刻派发；不选 Agent 就只是记一下。
派发时任务自动进入「进行中」，什么时候算完由你点「完成」决定。

### 任务交给 Agent 之后，就是和它的一段会话

第一次派发时 Nearbox 把任务标题、描述、备注和附件整理成提示词交给 Agent；之后在这条任务里再输入的每句话，
都会通过 CLI 的续聊参数（`cursor-agent --resume` / `codex exec resume` / `claude -r` …）发进**同一个会话**，
Agent 记得前面做过什么。任务头部会标出「Cursor Agent · 3 轮」这样的会话归属；Agent 还在干活时发的消息会排队，
等这一轮结束后自动接上。一条任务里每个 Agent 各有一段会话：换 Agent 芯片是另起一段，切回来又接着原来的。
想抛掉上下文重来，点输入框下方的「改为新会话」。

对话里每一轮都按 Cursor 的方式折叠：进行中时展开、实时滚动，结束后收成一行「工作了 36s · 5 步」，只留 Agent 的回答。
点开能看到每一步：终端命令是带输出的小卡片，改文件带 diff，连续的读取 / 搜索合并成「读取了 4 个文件」，
被拦截、失败的调用有明显标记。

### 图片和文字一起发

截图直接粘贴、拖进输入框，或点回形针选文件，它们会先以缩略图挂在输入框上方（点开可预览，× 或 Ctrl+Z 撤掉），
再和文字一起作为**一条消息**发出去：对话里是图文混排的一个气泡；只记录时文字成为任务标题和描述、图片成为第一条消息。
交给 Agent 时这条消息会拆成它能吃的形式：文字原样发送，后面附一段「## 附件」列出每张图在电脑上的绝对路径
（Cursor Agent / Claude Code 会用读文件工具看图）；Codex 额外通过 `-i` 直接把图片传给模型。一条消息最多 8 个文件。

## 关于 Agent 的权限

Agent 芯片的菜单里可选两种模式：

- **安全模式**（默认）：Agent 可以改项目目录内的文件，危险命令按各 CLI 自己的策略拦截或询问失败。
  注意 cursor-agent 在无人值守模式下没有人可以点「允许」，所以安全模式里它会拒绝**所有**终端命令（读写文件不受影响）；
  需要它跑命令、装依赖、起服务时请切到完全放开。
- **完全放开**：所有命令直接执行（对应 `--force` / `--dangerously-bypass-approvals-and-sandbox` / `bypassPermissions` 等）。

每个 Agent 的默认模式、默认模型、命令路径都能在「设置」里改。同一个项目一次只跑一个 Agent，其余排队；不同项目之间的并发上限也在设置里。

已配对的手机可以在这台电脑上启动 Agent、登记目录，请只配对自己的手机，并在「设置」里随时解除。

## 数据在哪

全部在本机用户目录：

- `%APPDATA%\Nearbox\nearbox\data\state.json`：任务、项目、运行记录、配对信息、设置
- `%APPDATA%\Nearbox\nearbox\data\runs\<id>.jsonl`：每次运行的完整日志
- `%APPDATA%\Nearbox\nearbox\inbox\<设备名>\`：手机发来的图片和文件

## 开发

```powershell
npm install
npm run dev        # Electron + Vite 热更新
npm run typecheck
npm test
npm run build && npm start
```

打包：`npm run dist:win`。图标由 `node scripts/make-icons.mjs` 生成。

本地联调时可以固定桌面端密钥，方便用 curl / 浏览器直接调 API：

```powershell
$env:NEARBOX_DESKTOP_SECRET = "dev-secret"; npm start
# http://127.0.0.1:17831/api/state?token=dev-secret
```

## 发布

只维护一个版本号：根目录 `package.json`。打 `vX.Y.Z` tag 后 GitHub Actions 会：

1. 检查 tag、`package.json`、`android/version.properties` 是否同一版本
2. 编 Android 薄壳 APK
3. 把这份 APK 打进 Windows 安装包
4. 发布 [GitHub Release](https://github.com/QuickerHub/nearbox/releases)

```powershell
npm version minor --no-git-tag-version
npm run android:sync
git add package.json package-lock.json android/version.properties
git commit -m "chore: bump version"
git tag v0.2.0
git push origin main --tags
```

## 架构

```text
Electron 主进程（托盘常驻）
  TaskHub        任务 / 项目 / 运行 / 设置，JSON 持久化
  RunManager     队列（每项目串行）、spawn CLI、解析 JSONL 流、写日志、取消
  LanServer :17831
    /              同一套 React 页面（电脑窗口 / 手机浏览器）：一个输入框 + 任务列表 + 每条任务的对话线程
    /ws            快照广播 + 订阅某次运行的实时事件
    /api/capture   手机 / 电脑快速记录
    /api/tasks     增删改、备注、派发、默认提示词
    /api/runs      事件回放、取消、继续对话
    /api/projects  登记目录
    /api/files     上传图片 / 文件拿到 id，随后由 tasks / notes / dispatch 请求用 fileIds 引用
    /api/upload    一步到位：文件直接挂到任务（脚本用）
    /app/nearbox.apk  同版本 Android 薄壳

Agent 适配（src/main/agent-output.ts）
  cursor-agent -p --output-format stream-json
  codex exec --json（提示词走 stdin，图片走 -i）
  grok --prompt-file --output-format streaming-json
  claude -p --output-format stream-json（提示词走 stdin）
  opencode run --format json
```

Windows 上的 npm / cursor-agent 命令都是 `.cmd` 壳，Node 不能直接 spawn；Nearbox 会解析壳脚本找到真正的 `node.exe + 脚本` 或 `.exe` 来启动，提示词永远不经过 cmd.exe 的命令行。

## 仓库

[QuickerHub/nearbox](https://github.com/QuickerHub/nearbox)
