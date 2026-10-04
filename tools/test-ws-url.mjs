// 纯逻辑回归：验证 src/app.jsx 里的 resolveWebSocketURL 在各种部署形态下算对地址。
// 不需要起服务器：node tools/test-ws-url.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "src", "app.jsx"), "utf8");

// 从真实源码里抽取函数，避免测试的是"副本"
const useLocalhost = Number(/const USE_LOCALHOST = (\d);/.exec(src)[1]);
const port = Number(/const PORT = (\d+);/.exec(src)[1]);
const marker = /const RELAY_MARKER = "([^"]+)";/.exec(src)[1];
// buildWsUrl 也要带上：resolveWebSocketURL 会调它
const fnSrc = src.slice(
  src.indexOf("const buildWsUrl = "),
  src.indexOf("\n};", src.indexOf("const resolveWebSocketURL")) + 3
);

const J = (o) => ({ protocol: "http:", port: "5173", search: "", ...o });
const RELAY = { ok: true, text: async () => marker };
const PLAIN = { ok: true, text: async () => "<!doctype html><html>vite</html>" };

// 简易 localStorage（Node 里没有）
const makeStorage = (initial = {}) => {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: () => Object.fromEntries(m),
  };
};

const cases = [
  ["dev :5173 局域网", J({ hostname: "192.168.8.48", host: "192.168.8.48:5173" }), PLAIN, {}, true, "ws://192.168.8.48:22006/cs2_webradar", false],
  ["中继 :22006", J({ hostname: "192.168.8.48", port: "22006", host: "192.168.8.48:22006" }), RELAY, {}, true, "ws://192.168.8.48:22006/cs2_webradar", false],
  ["隧道 https(port='')", J({ protocol: "https:", hostname: "x.trycloudflare.com", port: "", host: "x.trycloudflare.com" }), RELAY, {}, true, "wss://x.trycloudflare.com/cs2_webradar", false],
  ["?ip=域名(GitHub Pages)", J({ protocol: "https:", hostname: "u.github.io", port: "", host: "u.github.io", search: "?ip=abc.trycloudflare.com" }), PLAIN, {}, true, "wss://abc.trycloudflare.com/cs2_webradar", false],
  ["?ip=IPv4", J({ hostname: "192.168.8.48", host: "192.168.8.48:5173", search: "?ip=192.168.8.48" }), PLAIN, {}, true, "ws://192.168.8.48:22006/cs2_webradar", false],
  ["探测失败回退", J({ hostname: "10.0.0.5", host: "10.0.0.5:5173" }), { ok: false, text: async () => "" }, {}, true, "ws://10.0.0.5:22006/cs2_webradar", false],
  // 新增：?ip= 会被记住
  ["?ip= 被记住", J({ protocol: "https:", hostname: "u.github.io", port: "", host: "u.github.io", search: "?ip=abc.trycloudflare.com" }), PLAIN, {}, true, "wss://abc.trycloudflare.com/cs2_webradar", true],
  // 新增：URL 没带 ?ip= 时用记住的（GitHub Pages 场景）
  ["用记住的地址", J({ protocol: "https:", hostname: "u.github.io", port: "", host: "u.github.io" }), PLAIN, { radarRelayHost: "old-tunnel.trycloudflare.com" }, true, "wss://old-tunnel.trycloudflare.com/cs2_webradar", false],
  // 新增：useRemembered=false 时跳过记忆，直接走同源探测
  ["跳过记忆走同源", J({ protocol: "https:", hostname: "x.trycloudflare.com", port: "", host: "x.trycloudflare.com" }), RELAY, { radarRelayHost: "stale.trycloudflare.com" }, false, "wss://x.trycloudflare.com/cs2_webradar", false],
];

let fail = 0;
for (const [name, loc, probe, stored, useRemembered, expectUrl, expectStored] of cases) {
  const storage = makeStorage(stored);
  globalThis.localStorage = storage;

  const fn = new Function(
    "window", "URLSearchParams", "fetch", "USE_LOCALHOST", "PORT", "RELAY_MARKER", "RELAY_HOST_KEY",
    `${fnSrc}; return resolveWebSocketURL({ useRemembered: arguments[7] });`
  );
  const { url } = await fn(
    { location: loc }, URLSearchParams, async () => probe, useLocalhost, port, marker, "radarRelayHost", useRemembered
  );
  const okStored = expectStored
    ? storage._dump().radarRelayHost === loc.search.replace("?ip=", "")
    : true;
  const ok = url === expectUrl && okStored;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(24)} -> ${url}${expectStored ? "  (已写入 localStorage)" : ""}`);
}
console.log(fail ? `FAIL (${fail} case(s))` : `OK (${cases.length}/${cases.length} cases)`);
process.exit(fail ? 1 : 0);
