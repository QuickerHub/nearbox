# Nearbox

手机记想法，电脑跑 Agent。

Nearbox 是一个跑在自己电脑上的任务管理器：手机随手记下想法和要做的事，电脑端把任务派给本机装好的编程 Agent（Cursor Agent、Codex、Grok Build、Claude Code、opencode）去干活，结果和实时日志两边都能看。独立软件，不依赖 Quicker，也不经过任何云端服务器。

## 它解决什么

- 想法总是在路上、床上、饭桌上冒出来，电脑不在手边 —— 手机打开 Nearbox 一句话记下，回到电脑前它已经在收集箱里。
- 有了环境（电脑开着、在家里的 Wi-Fi）就能开工 —— 在手机上把任务派给某个 Agent，指定项目目录，电脑立刻开跑，手机上看进度。
- Agent 干完后要有人跟进 —— 每次运行的总结写回任务时间线，还能「继续对话」让同一个会话接着改。

## 使用方式

### 电脑端（Windows）

1. 第一次从 [Releases](https://github.com/QuickerHub/nearbox/releases) 装 `Nearbox-x.y.z-win-x64.exe`。之后在「设置 → 外观与关于」点「检查更新」，有新版本就「下载并安装」，不用再去 GitHub。
2. 打开后它常驻托盘。整个界面就是一个输入框：输入框下面的「项目」芯片选（或添加）代码目录，「Agent」芯片选谁来干、放不放开权限，选了 Agent 后旁边的「模型」芯片再挑用哪个模型；左侧是任务列表。「设置」里能看到检测到的 Agent CLI、配对手机、管理项目。
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

手机界面始终由电脑下发：电脑更新后手机打开就是新界面。Android 壳本身变了，在手机「设置」里点「从电脑安装」即可，也不用去 GitHub。

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

### 回复为什么快：常驻的 Agent 进程

命令行 Agent 每次启动都要花十几秒（主要是拉起你配置的 MCP 服务器），如果每条消息都新开一个进程，
说一句「好」也要等 20 秒。所以只要 Nearbox 开着，Cursor Agent 就以 ACP（Agent Client Protocol）服务的形式
**常驻一个进程**：会话在进程里保持加载，接着说的每句话直接送进去，回复只花模型本身的时间（通常 2 秒左右），
回答一边生成一边出现在对话里。打开一条任务、把芯片指向某个 Agent 时，电脑端就提前把进程和那段会话准备好；
Nearbox 启动后几秒也会把最近的会话装进去，所以第一句话同样不用等。

其他情形自动退回到原来的「一句话一个进程」方式：远程电脑上的运行、开了「可委派」的运行、选了常驻会话里没有
对应预设的模型，以及在这个版本之前开始的旧会话（命令行模式创建的会话接不进常驻进程；想要快的回复，
点「改为新会话」即可）。常驻进程连续 2 小时没有消息会自行退出，下一条消息再拉起。目前只有 Cursor Agent
提供这种接口；Codex / Claude Code / Grok / opencode 仍按原方式运行。

### 图片和文字一起发

截图直接粘贴、拖进输入框，或点回形针选文件，它们会先以缩略图挂在输入框上方（点开可预览，× 或 Ctrl+Z 撤掉），
再和文字一起作为**一条消息**发出去：对话里是图文混排的一个气泡；只记录时文字成为任务标题和描述、图片成为第一条消息。
交给 Agent 时这条消息会拆成它能吃的形式：文字原样发送，后面附一段「## 附件」列出每张图在电脑上的绝对路径
（Cursor Agent / Claude Code 会用读文件工具看图）；Codex 额外通过 `-i` 直接把图片传给模型。一条消息最多 8 个文件。

## 关于 Agent 的权限

输入框上方有独立的权限芯片，Agent 菜单和设置里也能改。两种模式：

- **安全模式**（默认）：读写项目文件直接做；终端命令停下来，让你点允许或拒绝。
- **完全放开**（run everything）：所有命令直接执行（对应 `--force` / `--dangerously-bypass-approvals-and-sandbox` / `bypassPermissions` 等）。

在芯片上改过的选择会记住，并写成该 Agent 的默认权限。同一个项目一次只跑一个 Agent，其余排队；不同项目之间的并发上限也在设置里。

## 选模型

选好 Agent 后，旁边会出现「模型」芯片。列表直接来自本机 CLI（`cursor-agent --list-models` / `codex debug models` / `grok models` / `opencode models`），
Claude Code 没有列表命令，给出 `sonnet` / `opus` / `haiku` 这些别名。列表长了可以搜索，任何列表里没有的模型 ID 也能直接输入；
选了列表里没有的模型，芯片会变成警示色提醒你核对。选「默认」就交给「设置」里填的默认模型，没填则由 CLI 自己决定。

列表提前备好、自动保鲜：每次启动和「重新检测」时向各 CLI 拉一遍，之后每 6 小时再拉一遍；选中某个 Agent 或点开模型芯片时，
如果这份列表超过 1 小时没更新、或上次拉取失败，会在后台再问一次（同一个 CLI 一分钟内最多问一次）。拉到的列表存在 `state.json` 里，
所以刚启动、离线、CLI 没登录时看到的仍是上一次的完整列表，并注明「x 分钟前更新」或失败原因。「设置 → Agent」每行也显示可选模型数量和更新时间，可手动刷新。

模型跟着会话走：一条任务里和某个 Agent 的对话用哪个模型开始的，回来继续时芯片就停在那个模型上；中途换模型只影响之后的轮次
（续聊时模型参数照样传给 CLI）。在新对话里选过的模型会被记住，下次选同一个 Agent 时沿用。

## Agent 之间互相委派

Agent 芯片菜单最下面有一个「允许委派给其他 Agent」开关。打开后，这次运行的 Agent 会多一个 `nearbox` 命令，提示词末尾会告诉它怎么用：

```text
nearbox ask grok "给 src/api 里的接口补上单元测试并跑通"   # 交给 Grok，等它做完，把它的回答打印出来
nearbox ask claude --file review.md --project other-app      # 说明写在文件里；也可以换一个项目目录
nearbox ask codex --continue "再把边界情况补上"               # 接着上次委派给 Codex 的那段会话说
nearbox wait 3f2a1b7c / nearbox status                       # 等太久时继续等；看已委派的子任务
```

于是「Cursor 规划、Grok 实现、Claude 审查」这种组合就能在一条任务里跑起来：主 Agent 决定什么时候交出去、交给谁，
子任务作为独立的一轮出现在同一个对话线程里（带「Cursor Agent 委派给 Grok Build」的标记，可以展开看过程），
回答通过命令输出直接回到主 Agent 手里；主 Agent 也可以对同一个子 Agent 连续追问。

几条规则：

- 主 Agent 等子任务时不占并发名额，同一项目的队列也会让它委派的子任务先过；两个子任务在同一个目录里仍然一个一个跑。
- 子任务默认沿用主 Agent 的权限（`--safe` 可收紧），但不会超过它：安全模式的主 Agent 只能派出安全模式的子任务。
- 子任务本身不能再往下委派；停止主 Agent 会一并停止它派出去的子任务。
- 命令默认最多等 90 秒（在各 CLI 的命令超时之内），没等到就先返回一句「还在工作，用 `nearbox wait` 继续等」，主 Agent 照做即可。
- `nearbox` 命令只在这台电脑上、且这次运行开了开关时才有效（它用的令牌只能操作这一次运行）；项目在别的电脑上时不可用。
  安全模式下每条终端命令都会先问你；不想每次点的话，把主 Agent 切到完全放开。

已配对的手机可以在这台电脑上启动 Agent、登记目录，请只配对自己的手机，并在「设置」里随时解除。

## 数据在哪

全部在本机用户目录：

- `%APPDATA%\Nearbox\nearbox\data\state.json`：任务、项目、运行记录、配对信息、设置
- `%APPDATA%\Nearbox\nearbox\data\runs\<id>.jsonl`：每次运行的完整日志
- `%APPDATA%\Nearbox\nearbox\inbox\<设备名>\`：手机发来的图片和文件
- `%APPDATA%\Nearbox\nearbox\bin\`：给 Agent 用的 `nearbox` 命令（每次启动重写）

## 开发

```powershell
npm install
npm run dev        # Electron + Vite 热更新
npm run typecheck
npm test
npm run build && npm start
```

打包：`npm run dist:win`。图标由 `node scripts/make-icons.mjs` 生成。

产品边界在 `docs/scope.md`，「为什么这么做」在 `docs/decisions/`，给 Agent 的约定在 `AGENTS.md`。本文只描述现在的行为。

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
  AgentHostPool  常驻的 Agent 进程（src/main/acp.ts）：每种 Agent 一个 ACP 服务进程，多段会话共用，
                 权限请求：完全放开自动同意；安全模式把终端命令拿到界面上让你点允许或拒绝
  LanServer :17831
    /              同一套 React 页面（电脑窗口 / 手机浏览器）：一个输入框 + 任务列表 + 每条任务的对话线程
    /ws            快照广播 + 订阅某次运行的实时事件
    /api/capture   手机 / 电脑快速记录
    /api/tasks     增删改、备注、派发、默认提示词
    /api/runs      事件回放、取消、继续对话；/delegate、/children 与 GET /api/runs/:id?wait= 供 Agent 的 nearbox 命令使用
    /api/projects  登记目录
    /api/files     上传图片 / 文件拿到 id，随后由 tasks / notes / dispatch 请求用 fileIds 引用
    /api/upload    一步到位：文件直接挂到任务（脚本用）
    /app/nearbox.apk  同版本 Android 薄壳

Agent 适配（src/main/agent-output.ts）
  cursor-agent acp（常驻，JSON-RPC over stdio；session/new · session/load · session/prompt）
  cursor-agent -p --output-format stream-json（远程 / 委派 / 旧会话 / 无预设模型时）
  codex exec --json（提示词走 stdin，图片走 -i）
  grok --prompt-file --output-format streaming-json
  claude -p --output-format stream-json（提示词走 stdin）
  opencode run --format json
```

Windows 上的 npm / cursor-agent 命令都是 `.cmd` 壳，Node 不能直接 spawn；Nearbox 会解析壳脚本找到真正的 `node.exe + 脚本` 或 `.exe` 来启动，提示词永远不经过 cmd.exe 的命令行。

Agent 用的 `nearbox` 命令（`resources/cli/nearbox.mjs`）由 Nearbox 自带的 Electron 以 Node 模式执行（`ELECTRON_RUN_AS_NODE=1`），不依赖用户装没装 Node；
开了委派的运行会拿到 `NEARBOX_URL` / `NEARBOX_TOKEN` / `NEARBOX_RUN_ID` 三个环境变量和加进 PATH 的 `bin` 目录。调度上，
正在等子任务的父运行不算占用（`src/main/scheduler.ts`），这样主 Agent 和它派出的子任务才不会在"同一项目只跑一个"的规则下互相等死。

## 仓库

[QuickerHub/nearbox](https://github.com/QuickerHub/nearbox)
