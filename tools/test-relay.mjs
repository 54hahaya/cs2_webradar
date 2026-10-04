// 中继连通性回归：两个客户端，A 发 B 收。
// 需要先起中继：node ws/app.js   然后 node tools/test-relay.mjs
import { WebSocket } from "ws";

const URL = "ws://127.0.0.1:22006/cs2_webradar";
const t0 = Date.now();
let done = false;

const fin = (ok, msg) => {
  if (done) return;
  done = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}  (${Date.now() - t0}ms)`);
  process.exit(ok ? 0 : 1);
};

const a = new WebSocket(URL);
const b = new WebSocket(URL);

a.on("open", () => console.log("client A open"));
b.on("open", () => {
  console.log("client B open");
  setTimeout(() => a.send(JSON.stringify({ m_map: "de_dust2", m_players: [{ m_idx: 1 }] })), 300);
});
b.on("message", (m) => {
  console.log("B received:", m.toString());
  fin(true, "relay broadcast works");
});
a.on("error", (e) => fin(false, "A error " + e.message));
b.on("error", (e) => fin(false, "B error " + e.message));
setTimeout(() => fin(false, "timeout: no broadcast received"), 4000);
