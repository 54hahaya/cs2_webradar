# Web-Radar（外部读取版）

来源：`cankao\cs2_webradar-main`（原项目 usermode 是**注入式**，我们用**外部 RPM** 替代其数据层）。
只搬了前端 + 中继 + 地图资源；原 `usermode/` 没有搬（我们用 `hlo-cs2-ext` 自己的 SDK 推送）。

## 目录

| 路径 | 说明 |
|---|---|
| `src/` | React 前端（Vite + Tailwind） |
| `ws/app.js` | 中继：监听 **22006**，同时托管 `dist/` 静态页面 + `/cs2_webradar` WS |
| `public/data/<map>/` | 17 张地图：`data.json`(x/y/scale) + `radar.png` + `background.png` |
| `start-all.bat` | **一键启动**：构建 + 中继 + 隧道，并打印全部可用地址 |
| `serve.bat` | 构建前端 + 起中继（一个端口给页面和 WS） |
| `tunnel.bat` | 把 22006 暴露到公网（cloudflared / ngrok） |
| `tools/test-ws-url.mjs` | 回归测试：各种部署形态下 WS 地址算得对不对 |
| `tools/test-relay.mjs` | 回归测试：中继广播是否正常 |
| `tools/check-case.mjs` | 回归测试：import 大小写（Linux CI 会挂，Windows 不会） |
| `tools/test-tunnel.ps1` / `test-pages-flow.mjs` | 端到端：起中继+隧道，验证页面和 wss 真的通 |
| `LICENSE-cs2_webradar` | 原项目 GPL-3.0 许可 |

## 运行

### DLL 自动托管（推荐）

DLL 加载后会在**独立线程**里自己把中继（+ 可选隧道）拉起来，不用手动开 bat。
配置在 **DLL 同目录**的 `radar.json`（首次运行自动生成）：

```json
{
  "auto_start": true,
  "mode": "public",
  "webradar_dir": "E:\\...\\webradar",
  "relay_port": 22006,
  "node_exe": "node",
  "cloudflared_exe": ""
}
```

| mode | 行为 | 手机怎么访问 |
|---|---|---|
| `"public"` | 中继 + cloudflared 隧道 | **内外网通用**：任意网络用隧道地址 |
| `"lan"` | 只起中继，不拉隧道 | **仅局域网**：手机得和 PC 同一个 WiFi |
| `auto_start: false` | 完全不自动托管 | 自己跑 `start-all.bat` |

日志里会直接打印可用地址：
```
[host] mode=public   webradar=E:\...\webradar
[host] 中继 OK
[host] 手机(同一WiFi) ->  http://192.168.x.x:22006
[host] 手机(任意网络) ->  https://xxxx.trycloudflare.com
```

> `mode: "public"` 时**每次加载 DLL 都会自动开一个公网隧道**。只想局域网用就改成 `"lan"`。

### 一键启动（推荐）

```bat
start-all.bat
```

它会依次：构建前端 → 起中继(22006) → 起 cloudflared 隧道 → **把全部可用地址打在一屏**：

```
  PC 本机        : http://localhost:22006
  手机(同一WiFi) : http://192.168.x.x:22006
  手机(任意网络) : https://xxxx.trycloudflare.com
  Pages 入口     : https://<user>.github.io/<repo>/?ip=xxxx.trycloudflare.com
```

按 `Ctrl+C` 退出，会一并关掉中继和隧道；中继的 `connected / disconnected` 也会实时转到屏幕上。

### 分开跑（调试用）

```bat
install.bat     :: 第一次，装 npm 依赖
start.bat       :: 同时起 ws(22006) + 前端(5173)
```

浏览器打开 <http://localhost:5173>。
`package.json` 里的 `dev` 脚本已用 `concurrently` 同时拉起中继和 Vite，所以只要 `npm run dev`。

## 三种访问方式

前端会自动判断该连哪个中继地址，**不用改代码**（`src/app.jsx` 的 `resolveWebSocketURL`）：

| 场景 | 打开什么 | 连到哪 |
|---|---|---|
| **A. 局域网**（PC + 手机同一 WiFi） | 手机开 `http://<PC的IP>:5173` | 自动 `ws://<PC的IP>:22006` |
| **B. 外网**（手机不在同一网络） | `serve.bat` → `tunnel.bat` → 手机开隧道给的 `https://xxx.trycloudflare.com` | 同源 `wss://xxx.trycloudflare.com/cs2_webradar` |
| **C. 静态托管 + 指定IP** | `?ip=` 参数，如 `https://user.github.io/repo/?ip=xxx.trycloudflare.com` | 按参数拼（域名→443/TLS，IPv4→:22006） |

### C. GitHub Pages（可选，仅在你要"固定网址 / 给别人打开"时才需要）

**先想清楚值不值**：只是"自己手机在外面看"的话，B 已经完整覆盖，而且不公开任何东西。
C 的意义是：一个不用开本机前端的固定网址，别人拿到也能打开。

**前提（不满足就连不上）**

页面是 **https**，浏览器禁止 https 页面去连 `ws://`（混合内容拦截）。所以：

- **必须同时开着 `tunnel.bat`**，用 `?ip=` 指向隧道域名
- `?ip=` 填局域网 IP（`192.168.x.x`）**没用**，会被浏览器拦截

**步骤**

1. 建仓库，把 `webradar/` 的内容推到 `main`
2. `Settings → Pages → Source` 选 **GitHub Actions**
3. 推一次代码，`.github/workflows/deploy-pages.yml` 会自动 `npm ci && npm run build` 并发布
4. 手机打开
   ```
   https://<用户名>.github.io/<仓库名>/?ip=<隧道域名>
   例：https://joao.github.io/cs2_webradar/?ip=frango.trycloudflare.com
   ```

不想用 Actions，手动推 `gh-pages` 分支也行：

```bat
cd webradar
npm run build
type nul > dist\.nojekyll
cd dist
git init
git checkout -B gh-pages
git add -A
git commit -m "deploy"
git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -f origin gh-pages
```

然后 `Settings → Pages → Source` 选 **Deploy from a branch** → `gh-pages` / `(root)`。


### B. 外网访问（推荐，一条隧道搞定）

```bat
serve.bat        :: npm run build + node ws/app.js  → 本机 http://localhost:22006 先验证
tunnel.bat       :: 选 1=cloudflared 或 2=ngrok
```

关键点：**中继同时托管页面和 WebSocket**，所以隧道只需要暴露 `22006` 一个端口，
手机直接打开隧道给的 https 地址即可，不需要再填 IP，也不会碰到 https 页面连 `ws://` 的混合内容拦截。

> ⚠️ 原 fork 的 README 写的是 `ws://<隧道域名>:22006/...`，**这是错的**：
> cloudflared/ngrok 给的是 443 上的 https/wss，不是 22006 端口。按上面做才对。

### 相关改动（相对原始前端）

- `ws/app.js`：新增 `dist/` 静态托管 + `/__relay` 同源标记 + 404/SPA 回退 + 目录穿越防护
- `src/app.jsx`：`resolveWebSocketURL()` 三级解析（`?ip=` → 同源探测 → 局域网），支持 `wss`
- `vite.config.js`：`base: './'`，构建产物用相对路径，同时兼容"中继根目录"和"GitHub Pages 子目录"

回归测试：

```bat
npm run test:url      :: 6 个部署形态的地址解析（不需要起服务）
npm run test:relay    :: 中继广播（需要先 node ws/app.js）
```

## 数据链路

```
cs2.exe  <--外部 ReadProcessMemory--  我们的进程 (xmllite.dll)
                                          |
                                          | ws://127.0.0.1:22006/cs2_webradar  (100ms 一帧)
                                          v
                                    ws/app.js  (中继，纯转发)
                                          |
                                          | broadcast
                                          v
                                    React 前端 (localhost:5173)
```

推送端实现在 `..\net\RadarFeed.hpp`；目标地址在 `feed::g_host`（默认 `127.0.0.1`）。

## JSON 契约（与前端约定，别改字段名）

```json
{
  "m_local_team": 2,
  "m_map": "de_dust2",
  "m_players": [
    {
      "m_idx": 5, "m_name": "player", "m_color": 0, "m_team": 2,
      "m_health": 100, "m_is_dead": false, "m_model_name": "",
      "m_steam_id": "0", "m_money": 0, "m_armor": 100,
      "m_position": { "x": 0.0, "y": 0.0 },
      "m_eye_angle": 0.0, "m_has_helmet": true, "m_has_defuser": false,
      "m_weapons": { "m_primary": "", "m_secondary": "", "m_active": "" }
    }
  ]
}
```

## 地图名从哪来

`sdk::MapName()` —— `*(client + dwGlobalVars)` 的 `+0x180 / +0x188`（见 `sdk/Game/GlobalVars.hpp`），
并且用 `de_/cs_/dz_/ar_` 前缀做了自校验，扫不到就返回空（前端不显示）。

## 已知未实现（前端会显示为默认值）

- `m_weapons`：目前是空对象 → 前端不显示武器图标
- `m_money` / `m_color` / `m_model_name` / `m_steam_id`：占位值

补法见 `..\sdk\Game\PlayerList.hpp` + `..\net\RadarFeed.hpp`。
