# piwebui

把本机运行的 [pi](https://github.com/earendil-works/pi) coding agent 搬到浏览器里用。

手机、平板、公司电脑都能连；支持发图片、语音转文字；本机不需要公网 IP。

```
📱 浏览器（手机 / 平板 / 任意电脑）
   │  HTTPS + WSS
   ▼
☁️ 远程服务器  ·  Node 服务（项目里的 server/）
   ├─ /           前端静态资源（React SPA）
   ├─ /ws         浏览器实时通道（Cookie 鉴权）
   ├─ /agent      本地 agent 的反向连接（共享密钥鉴权）
   └─ /api/transcribe → faster-whisper 转写服务
   ▲
   │  WebSocket（本地主动连出）
   ▼
💻 本机  ·  agent-host（项目里的 agent-host/）
   └─ 拉起并驱动 `pi --mode rpc`（stdin/stdout JSONL）
```

**为什么让本地主动连服务器**：pi 带着 `bash` / `edit` / `write` 工具，把它暴露到公网风险很高。反向连接意味着本机不开放任何端口、不需要公网 IP、不需要端口映射；服务器只做转发，命令执行永远发生在你自己的机器上。

---

## 能力

| 功能 | 说明 |
|---|---|
| 实时流式输出 | 文本增量、思考过程折叠、工具调用生命周期（开始/输出/耗时） |
| 图片输入 | 粘贴 / 拖拽 / 选择文件，浏览器端压到长边 1568px 再 base64 内联；模型不支持视觉时会提示 |
| 语音转文字 | 浏览器录音（Opus/AAC 自适应）→ 服务器 faster-whisper → 文本插入输入框 |
| 多会话 | 列出所有项目的 pi 会话；跨项目切换时会自动把 pi 重启到那个目录 |
| 模型 / 思考等级 | 顶栏直接切换，支持搜索模型 |
| 中断与插话 | 停止当前运行；忙碌时发消息按 `steer` 排队，工具执行完立即送达 |
| 扩展交互 | pi 扩展弹出的 `confirm` / `select` / `input` / `editor` 会在网页上弹窗 |
| 多端同步 | 多个浏览器同时打开，消息和状态实时同步 |
| 断线恢复 | 网络中断后自动重连，并从 pi 的会话文件重建时间线 |
| 主题 | 深色 / 浅色，跟随系统，可手动切换 |

---

## 目录结构

```
piwebui/
├─ shared/            三层共用的协议类型（pi RPC + 自定义帧）
├─ server/            跑在远程服务器上的 Node 服务
│   ├─ src/hub.ts         agent ↔ 浏览器 的双向转发
│   ├─ src/auth.ts        HMAC 会话 cookie
│   └─ src/index.ts       HTTP 路由 / WebSocket 升级 / 静态资源
├─ agent-host/        跑在你自己机器上的桥接进程
│   ├─ src/pi-process.ts  spawn `pi --mode rpc`，逐行解析 JSONL
│   ├─ src/link.ts        出站 WebSocket + 指数退避重连
│   └─ src/sessions.ts    扫描 ~/.pi/agent/sessions 生成会话列表
├─ web/               React + Vite + Tailwind 前端
├─ whisper/           faster-whisper 转写服务（Python / FastAPI）
├─ deploy/            nginx、systemd、Windows 启动脚本、install.sh
├─ scripts/           打包（pack.mjs）与排障脚本
└─ .pack/             打包产物（已 gitignore）
```

---

## 一、先在本机跑通（5 分钟）

前置：本机已安装 Node ≥ 20，且 `pi` 已在 PATH 里并能正常对话（`pi --version` 有输出）。

```bash
# 1. 装依赖
npm install

# 2. 生成两个密钥
node -e "console.log('ACCESS_TOKEN=' + require('crypto').randomBytes(24).toString('base64url'))"
node -e "console.log('AGENT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"

# 3. 配置 server（粘贴上面的值）
cp server/.env.example server/.env
#    ACCESS_TOKEN=...
#    AGENT_SECRET=...
#    SECURE_COOKIES=false      ← 本地是 http，必须关掉

# 4. 配置 agent-host（AGENT_SECRET 与上面一致）
cp agent-host/.env.example agent-host/.env
#    PIWEBUI_SERVER_URL=ws://127.0.0.1:8787/agent
#    AGENT_SECRET=...
#    PI_CWD=你的项目目录

# 5. 构建并启动（两个终端）
npm run build
npm run start:server      # 终端 A
npm run start:agent       # 终端 B
```

打开 <http://127.0.0.1:8787>，用 `ACCESS_TOKEN` 登录。

想改代码热调试：`npm run dev:server`、`npm run dev:agent`、`npm run dev`（前端 5173，已配置代理）。

---

## 二、部署到远程服务器

假设：Ubuntu/Debian、域名 `pi.example.com` 已解析到服务器、nginx 已装。

有两条路。**方式 A 不需要在服务器上装构建工具链**，适合绝大多数情况。

### 方式 A：一键部署包（推荐）

本地打包 → 上传 → 一条命令装完。

```powershell
npm run pack        # 构建并打包，产物 .pack/piwebui-deploy-<日期>.tar.gz（约 220 KB，不含源码）
```

```bash
scp .pack/piwebui-deploy-*.tar.gz you@your-server:/tmp/
ssh you@your-server
tar -xzf /tmp/piwebui-deploy-*.tar.gz -C /tmp
sudo bash /tmp/piwebui-deploy/deploy/install.sh
```

脚本按顺序做这些事：建 `piwebui` 系统账号 → 装到 `/opt/piwebui` → `npm install --omit=dev` → 生成随机的 `ACCESS_TOKEN` / `AGENT_SECRET` / `SESSION_SECRET` 写入 `.env`（600 权限）→ 建 venv 装 faster-whisper → 注册并启动 systemd → 健康检查 → 把两个令牌和剩余步骤打印出来。

| 参数 | 作用 |
| --- | --- |
| `--no-whisper` | 不装语音转写（服务器没有 Python 3.9+、或不需要语音输入） |
| `--port 8787` | 改监听端口 |
| `--src <dir>` | 指定解压目录（默认自动推断） |

重复执行是安全的：**已存在的 `.env` 不会被覆盖**，升级代码时令牌保持不变。

装完只剩两件事——配 nginx（下面第 6 步）和在本地机器配 agent-host（第 7 步）。

### 方式 B：在服务器上从源码构建

要改代码、或想直接在服务器上 `git pull` 时用这条。

#### 1. 服务器准备

```bash
# 专用账号（不要用 root 跑服务）
sudo adduser --system --group --home /opt/piwebui piwebui

# 本地把代码传上去（排除构建产物和依赖）
rsync -av --delete \
  --exclude node_modules --exclude shots --exclude .venv \
  --exclude server/dist --exclude server/public --exclude agent-host/dist \
  ./ user@your-server:/tmp/piwebui/

ssh user@your-server
sudo rsync -av /tmp/piwebui/ /opt/piwebui/
sudo chown -R piwebui:piwebui /opt/piwebui
```

#### 2. 构建

```bash
cd /opt/piwebui
sudo -u piwebui npm ci
sudo -u piwebui npm run build          # 产出 server/dist + server/public + agent-host/dist
sudo -u piwebui npm prune --omit=dev   # 去掉 vite/esbuild 等构建期依赖
```

#### 3. 配置

```bash
sudo -u piwebui cp server/.env.example server/.env
sudo -u piwebui nano server/.env
```

关键几项：

```dotenv
HOST=127.0.0.1
PORT=8787
ACCESS_TOKEN=<你登录网页用的令牌>
AGENT_SECRET=<与本地 agent-host 完全一致>
SESSION_SECRET=<单独生成，用于 cookie 签名>
SECURE_COOKIES=true          # 走 https 必须开
WHISPER_URL=http://127.0.0.1:8001
```

```bash
sudo chmod 600 server/.env
```

#### 4. 语音转写服务（可选）

不装也能用，只是录音按钮会提示转写服务不可用。

```bash
cd /opt/piwebui/whisper
sudo -u piwebui python3 -m venv .venv
sudo -u piwebui ./.venv/bin/pip install -r requirements.txt
sudo -u piwebui cp .env.example .env
```

`whisper/.env` 里选模型：

- `WHISPER_MODEL=small` — 2 核 CPU 可用，中文够用（首次启动下载约 500MB）
- `WHISPER_MODEL=medium` — 准确率明显更好，需要 4 核以上
- `WHISPER_DEVICE=cuda` + `WHISPER_COMPUTE_TYPE=float16` — 有 GPU 时最快

国内下载慢可以加 `HF_ENDPOINT=https://hf-mirror.com`，**并且必须同时加 `HF_HUB_DISABLE_XET=1`**——镜像不支持 HF 的 Xet 传输协议，只设镜像会卡在 `401 Unauthorized ... cas-server.xethub.hf.co`。

#### 5. systemd

```bash
sudo cp deploy/piwebui-server.service deploy/piwebui-whisper.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now piwebui-server
sudo systemctl enable --now piwebui-whisper    # 没装 whisper 就跳过
sudo systemctl status piwebui-server
```

> unit 文件里的路径、用户假设是 `/opt/piwebui` + `piwebui` 账号，按实际情况改。

#### 6. nginx + 证书

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/piwebui
sudo nano /etc/nginx/sites-available/piwebui     # 改 server_name 和证书路径
sudo ln -s /etc/nginx/sites-available/piwebui /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d pi.example.com
```

配置里 `/ws` 和 `/agent` 两段必须保留 `Upgrade` / `Connection` 头，否则 WebSocket 无法升级。

#### 7. 本机 agent-host

把最新的 `agent-host/.env` 改成连服务器：

```dotenv
PIWEBUI_SERVER_URL=wss://pi.example.com/agent
AGENT_SECRET=<与服务器一致>
PI_CWD=D:\code\my-project
```

```powershell
npm run build:agent
```

然后双击 `deploy\start-agent.bat` 前台运行（能看到日志），或 `deploy\start-agent-silent.vbs` 静默后台运行（日志写到 `agent-host\agent.log`）。

**开机自启**（推荐）：

1. 打开「任务计划程序」→「创建任务」
2. 常规：勾选「不管用户是否登录都要运行」或「只在用户登录时运行」
3. 触发器：新建 →「登录时」
4. 操作：启动程序 → `wscript.exe`，参数 `"C:\完整路径\deploy\start-agent-silent.vbs"`
5. 条件：取消「只有在计算机使用交流电源时才启动」

登录网页后，顶栏应显示「就绪」。

---

## 三、配置项

### server/.env

| 变量 | 默认 | 说明 |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `8787` | 只监听回环，由 nginx 对外 |
| `ACCESS_TOKEN` | — | 网页登录令牌，**必须 >= 16 字符** |
| `AGENT_SECRET` | — | agent-host 连接密钥，两边一致 |
| `SESSION_SECRET` | 由 token 派生 | cookie 签名密钥；单独设置后轮换 token 不会踢掉已登录设备 |
| `SESSION_TTL_DAYS` | `30` | 登录有效期 |
| `SECURE_COOKIES` | `false` | https 环境**必须设 true** |
| `WHISPER_URL` | `http://127.0.0.1:8001` | 转写服务地址 |
| `WHISPER_TOKEN` | 空 | 与 whisper/.env 一致；留空则不校验 |
| `MAX_UPLOAD_MB` | `25` | 单次音频上限 |
| `TRUST_PROXY` | `true` | 读取 `X-Forwarded-For`，登录限速用 |

### agent-host/.env

| 变量 | 默认 | 说明 |
|---|---|---|
| `PIWEBUI_SERVER_URL` | `ws://127.0.0.1:8787/agent` | 生产用 `wss://域名/agent` |
| `AGENT_SECRET` | — | 与服务器一致 |
| `PI_CWD` | 当前目录 | pi 的工作目录，决定它能读写哪个项目 |
| `PI_BIN` | `pi` | pi 可执行文件 |
| `PI_ARGS` | 空 | 追加参数，例如 `--approve --thinking high` |
| `PI_SESSION_DIR` | `~/.pi/agent/sessions` | 会话文件目录 |
| `PI_AUTO_RESTART` | `true` | pi 崩溃后自动重启 |
| `PIWEBUI_VERBOSE` | `false` | 打印完整协议收发，排障用 |

---

## 四、故障排查

**网页显示「agent 离线」**

```bash
# 服务器上看 agent 有没有连上
sudo journalctl -u piwebui-server -f
# 本地看桥接进程日志（前台运行时直接看窗口；静默运行时）
type agent-host\agent.log
```

常见原因：`AGENT_SECRET` 不一致、`PIWEBUI_SERVER_URL` 写成了 `ws://` 但服务器只有 https、nginx 没配 `/agent` 的 Upgrade 头。

**一直卡在「正在连接…」**

`/ws` 升级失败。检查 nginx：

```bash
sudo nginx -T | grep -A6 "location /ws"
```

必须有 `proxy_set_header Upgrade $http_upgrade;` 和 `proxy_http_version 1.1;`。

**登录后立刻被踢回登录页**

`SECURE_COOKIES=true` 但你用的是 http，浏览器会丢弃 Secure cookie。本地测试时设为 `false`。

**录音提示「转写服务不可用」**

```bash
sudo systemctl status piwebui-whisper
sudo journalctl -u piwebui-whisper -n 50
curl http://127.0.0.1:8001/health
```

首次启动要下载模型，`small` 约 500MB，等它跑完再试。下载失败多半是网络：

- 卡住不动 / 只下了几 MB → 设 `HF_ENDPOINT=https://hf-mirror.com`
- 报 `401 Unauthorized ... cas-server.xethub.hf.co` → 同时设 `HF_HUB_DISABLE_XET=1`

**录音后报 500，日志里是 `TypeError: open() got an unexpected keyword argument 'metadata_errors'`**

PyAV 16 移除了这个参数，而 faster-whisper 仍在传它。`requirements.txt` 已锁定 `av<16`，重装依赖即可：

```bash
cd /opt/piwebui/whisper && ./.venv/bin/pip install -r requirements.txt --force-reinstall av
```

**发图片报错 / 模型忽略图片**

顶栏确认当前模型的 `input` 含 image（例如 GLM-4.6V、Claude、GPT-4o）。纯文本模型会直接报错，前端也会提前警告。

**发消息没反应，日志里 pi 反复重启**

`PI_CWD` 指向的目录可能不存在，或 pi 缺少该目录的读写权限。用 `node agent-host/dist/agent-host.js` 前台跑一次看 stderr。

**想切回其他项目的旧会话**

侧栏会列出所有项目的会话，点非当前项目的会话时会自动把 pi 重启到那个目录并恢复该会话。

---

## 五、安全说明

这套东西的默认假设是「单用户、自己用」：

- **登录**：单令牌 → HMAC 签名 cookie（HttpOnly / SameSite=Lax），登录接口按 IP 限速（10 次/分钟）
- **agent 通道**：共享密钥在 WebSocket **首帧**校验，不放在 URL 里，因此不会进 nginx access log
- **执行边界**：所有 shell / 文件操作都在**你本机**发生，服务器只转发字节
- **CSP**：`script-src 'self'`，没有内联脚本
- 服务端只监听 `127.0.0.1`，对外由 nginx 终结 TLS

需要注意的地方：

1. `ACCESS_TOKEN` 泄露等于把本机 shell 交出去。用 32 字节随机值，别用生日。
2. 不要把 `HOST` 改成 `0.0.0.0` 直接暴露端口，一定走 nginx + https。
3. 多用户场景**不要**直接用这套：目前只有一个 agent、一份会话，所有人共享同一个 pi 进程。要做多用户得按用户隔离 agent-host 实例。
4. 会话文件包含你的 prompt、文件内容、命令输出；`export_html` 导出前先自己看一眼。

---

## 六、已知限制

- **一个 agent 一个会话**：服务器同时只维护一条到本地 pi 的连接，多个浏览器看到的是同一个会话（这是有意设计，多端同步）。
- **切换项目要重启 pi**：pi 的 cwd 在启动时固定，跨目录打开会话会重启进程，期间约 1–2 秒页面无响应。
- **语音依赖浏览器录音权限**，iOS Safari 必须 https，且录音格式是 AAC（已做适配）。
- **首包较大**：前端 gzip 后约 195KB，主要是 markdown 渲染和代码高亮的语法包。内网/4G 都够用。

---

## 七、开发

```bash
npm run dev          # 前端（5173，代理到 8787）
npm run dev:server   # 服务器热重载
npm run dev:agent    # 桥接热重载
npm run build        # 全量构建
npm run pack         # 构建 + 打部署包（.pack/piwebui-deploy-*.tar.gz）
npm run pack:fast    # 只打包，不重新构建
```

打包脚本刻意排除源码、`node_modules`、`.env` 和 `*.map`——服务器上只需要 `server/dist` + `server/public` + 三个运行时依赖（hono / @hono/node-server / ws），密钥始终不出本机。

协议定义集中在 `shared/src/index.ts`，改协议时三个包会同时报类型错误，不会漏改。

仓库里的 `scripts/e2e.mjs`（命令行端到端）、`scripts/shoot.mjs`（截图）、`scripts/probe.mjs`（查状态）是排障用的，需要先设 `TOKEN` 环境变量：

```bash
TOKEN=你的ACCESS_TOKEN node scripts/e2e.mjs
```
