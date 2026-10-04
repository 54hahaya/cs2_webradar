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
const fnBody = src.slice(src.indexOf("const resolveWebSocketURL = async () => {"));
const fnSrc = fnBody.slice(0, fnBody.indexOf("\n};") + 3);

const J = (o) => ({ protocol: "http:", port: "5173", search: "", ...o });
const RELAY = { ok: true, text: async () => marker };
const PLAIN = { ok: true, text: async () => "<!doctype html><html>vite</html>" };

const cases = [
  ["dev :5173 局域网", J({ hostname: "192.168.8.48", host: "192.168.8.48:5173" }), PLAIN, "ws://192.168.8.48:22006/cs2_webradar"],
  ["中继 :22006", J({ hostname: "192.168.8.48", port: "22006", host: "192.168.8.48:22006" }), RELAY, "ws://192.168.8.48:22006/cs2_webradar"],
  ["隧道 https(port='')", J({ protocol: "https:", hostname: "x.trycloudflare.com", port: "", host: "x.trycloudflare.com" }), RELAY, "wss://x.trycloudflare.com/cs2_webradar"],
  ["?ip=域名(GitHub Pages)", J({ protocol: "https:", hostname: "u.github.io", port: "", host: "u.github.io", search: "?ip=abc.trycloudflare.com" }), PLAIN, "wss://abc.trycloudflare.com/cs2_webradar"],
  ["?ip=IPv4", J({ hostname: "192.168.8.48", host: "192.168.8.48:5173", search: "?ip=192.168.8.48" }), PLAIN, "ws://192.168.8.48:22006/cs2_webradar"],
  ["探测失败回退", J({ hostname: "10.0.0.5", host: "10.0.0.5:5173" }), { ok: false, text: async () => "" }, "ws://10.0.0.5:22006/cs2_webradar"],
];

let fail = 0;
for (const [name, loc, probe, expect] of cases) {
  const fn = new Function(
    "window", "URLSearchParams", "fetch", "USE_LOCALHOST", "PORT", "RELAY_MARKER",
    `${fnSrc}; return resolveWebSocketURL();`
  );
  const url = await fn({ location: loc }, URLSearchParams, async () => probe, useLocalhost, port, marker);
  const ok = url === expect;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(24)} -> ${url}`);
}
console.log(fail ? `FAIL (${fail} case(s))` : `OK (${cases.length}/${cases.length} cases)`);
process.exit(fail ? 1 : 0);
