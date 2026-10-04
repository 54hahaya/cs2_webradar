// 端到端验证「GitHub Pages + ?ip=<隧道域名>」这条路径：
//   1) 起中继(3360)
//   2) 起 cloudflared 快速隧道，拿到 https://xxx.trycloudflare.com
//   3) 用 src/app.jsx 里真实的 resolveWebSocketURL 算地址（location 模拟成 54hahaya.github.io + ?ip=）
//   4) 用算出来的 wss:// 地址真的连一次 WS，A 发 B 收
//   5) 收尾
//
//   node tools/test-pages-flow.mjs
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocket } from "ws";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CF = path.join(ROOT, "tools", "bin", "cloudflared.exe");
const PORT = 3360;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kids = [];
const cleanup = () => { for (const k of kids) { try { k.kill(); } catch {} } };
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

function fail(msg) { console.log("FAIL  " + msg); cleanup(); process.exit(1); }
function ok(msg) { console.log("PASS  " + msg); }

// ---------- 1) 中继 ----------
console.log("[1/5] starting relay ...");
kids.push(spawn(process.execPath, ["ws/app.js"], { cwd: ROOT, stdio: "ignore" }));
await sleep(2000);

// ---------- 2) 隧道 ----------
if (!fs.existsSync(CF)) fail(`cloudflared not found: ${CF}`);
console.log("[2/5] starting cloudflared ...");
const cf = spawn(CF, ["tunnel", "--url", `http://localhost:${PORT}`, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"] });
kids.push(cf);

let tunnelUrl = null;
const scan = (buf) => {
  const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && !tunnelUrl) tunnelUrl = m[0];
};
cf.stdout.on("data", scan);
cf.stderr.on("data", scan);

for (let i = 0; i < 40 && !tunnelUrl; i++) await sleep(1000);
if (!tunnelUrl) fail("no tunnel URL within 40s");
const host = tunnelUrl.replace("https://", "");
console.log(`      tunnel = ${tunnelUrl}`);

// ---------- 3) 用真实 resolver 算 WS 地址 ----------
console.log("[3/5] resolving WS url via src/app.jsx resolveWebSocketURL ...");
const src = fs.readFileSync(path.join(ROOT, "src", "app.jsx"), "utf8");
const useLocalhost = Number(/const USE_LOCALHOST = (\d);/.exec(src)[1]);
// PORT 现在是 "const PORT = \n Number(...) || 3360;"，取末尾的默认值
const port = Number(/const PORT =[\s\S]{0,200}?\|\|\s*(\d+)\s*;/.exec(src)[1]);
const marker = /const RELAY_MARKER = "([^"]+)";/.exec(src)[1];
// buildWsUrl 也要带上：resolveWebSocketURL 会调它
const fnSrc = src.slice(
  src.indexOf("const buildWsUrl = "),
  src.indexOf("\n};", src.indexOf("const resolveWebSocketURL")) + 3
);

// Node 里没有 localStorage，给个最小实现
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

const pageLocation = {
  protocol: "https:",
  hostname: "54hahaya.github.io",
  port: "",
  host: "54hahaya.github.io",
  search: `?ip=${host}`,
};
const resolve = new Function(
  "window", "URLSearchParams", "fetch", "USE_LOCALHOST", "PORT", "RELAY_MARKER", "RELAY_HOST_KEY",
  `${fnSrc}; return resolveWebSocketURL();`
);
const { url: wsUrl } = await resolve(
  { location: pageLocation }, URLSearchParams, globalThis.fetch, useLocalhost, port, marker, "radarRelayHost"
);
console.log(`      ws url = ${wsUrl}`);
if (wsUrl !== `wss://${host}/cs2_webradar`) fail(`unexpected ws url: ${wsUrl}`);

// ---------- 4) 真连一次（带传播重试）----------
console.log("[4/5] connecting over the tunnel ...");
const attempt = (timeoutMs) =>
  new Promise((res) => {
    const a = new WebSocket(wsUrl);        // 模拟 DLL 推送端
    const b = new WebSocket(wsUrl);        // 模拟手机
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; res(false); } }, timeoutMs);
    const finish = (v) => { if (!done) { done = true; clearTimeout(t); try { a.close(); b.close(); } catch {} res(v); } };
    a.on("error", () => {});
    b.on("error", () => {});
    b.on("message", (m) => { if (String(m).includes("de_dust2")) finish(true); });
    b.on("open", () => setTimeout(() => a.readyState === 1 && a.send(JSON.stringify({ m_map: "de_dust2", m_players: [{ m_idx: 1 }] })), 400));
  });

let connected = false;
for (let i = 0; i < 12 && !connected; i++) {
  if (i) await sleep(5000);
  connected = await attempt(8000);
  if (!connected) console.log(`      attempt ${i + 1} not ready yet, retrying ...`);
}
if (!connected) fail("could not establish WS through the tunnel");

ok(`Pages + ?ip= path works end-to-end  (${wsUrl})`);
ok("broadcast A -> B delivered over wss through cloudflared");

// ---------- 5) 收尾 ----------
console.log("[5/5] cleanup ...");
cleanup();
process.exit(0);
