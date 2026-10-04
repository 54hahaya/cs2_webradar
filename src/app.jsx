import ReactDOM from "react-dom/client";
import { useEffect, useState } from "react";
import "./app.css";
import PlayerCard from "./components/playercard";
import Radar from "./components/radar";
import SettingsButton from "./components/settings";
import MaskedIcon from "./components/maskedicon";

const CONNECTION_TIMEOUT = 5000;

/* 改成 '1' 就只连本机 */
const USE_LOCALHOST = 0;

const PORT = 22006;

/* 中继地址解析（优先级从上到下）：
 *   1) URL 带 ?ip=xxx  —— 一个页面连任意地址，不用重新构建
 *        域名（隧道/反代，如 xxx.trycloudflare.com）-> wss://xxx/cs2_webradar（443 + TLS）
 *        IPv4（如 192.168.1.10）                     -> ws://192.168.1.10:22006/cs2_webradar
 *   2) 页面就是中继自己发的 —— 同源，复用当前 host，https 自动升级 wss
 *        判定方式：探测 ./__relay，中继会回固定标记。
 *        不能只看端口：隧道下浏览器地址是 https://xxx.trycloudflare.com，
 *        location.port 是空字符串，用端口判断会漏掉外网场景。
 *   3) 其它（Vite 开发服务器 :5173）—— 连同一台主机的 :22006
 *        局域网开发走这条（手机开 http://<PC-IP>:5173 自动生效）
 */
const RELAY_MARKER = "cs2_webradar-relay";
const RELAY_HOST_KEY = "radarRelayHost";     // 记住上次用过的 ?ip=

const buildWsUrl = (host, tls) => {
  const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  // 域名（隧道/反代）走 443 + TLS，不带端口；IPv4 走 22006 明文
  return isIPv4 ? `${tls}://${host}:${PORT}/cs2_webradar` : `wss://${host}/cs2_webradar`;
};

// 返回 { url, viaRemembered }
//   useRemembered=false 时跳过"上次记住的地址"（隧道地址每次重启都会变，
//   连不上几次之后就得丢掉，否则会一直对着一个失效域名重试）
const resolveWebSocketURL = async ({ useRemembered = true } = {}) => {
  if (USE_LOCALHOST) return { url: `ws://localhost:${PORT}/cs2_webradar`, viaRemembered: false };

  const tls = window.location.protocol === "https:" ? "wss" : "ws";

  const ipParam = new URLSearchParams(window.location.search).get("ip");
  if (ipParam) {
    try { localStorage.setItem(RELAY_HOST_KEY, ipParam); } catch { /* 隐私模式忽略 */ }
    return { url: buildWsUrl(ipParam, tls), viaRemembered: false };
  }

  if (useRemembered) {
    let remembered = null;
    try { remembered = localStorage.getItem(RELAY_HOST_KEY); } catch { /* ignore */ }
    if (remembered) return { url: buildWsUrl(remembered, tls), viaRemembered: true };
  }

  try {
    const res = await fetch("./__relay", { cache: "no-store" });
    if (res.ok && (await res.text()).trim() === RELAY_MARKER) {
      return { url: `${tls}://${window.location.host}/cs2_webradar`, viaRemembered: false };
    }
  } catch {
    /* 探测失败就按局域网规则走 */
  }

  return { url: `ws://${window.location.hostname}:${PORT}/cs2_webradar`, viaRemembered: false };
};

const DEFAULT_SETTINGS = {
  dotSize: 1,
  bombSize: 0.5,
};

const loadSettings = () => {
  const savedSettings = localStorage.getItem("radarSettings");
  return savedSettings ? JSON.parse(savedSettings) : DEFAULT_SETTINGS;
};

const App = () => {
  const [playerArray, setPlayerArray] = useState([]);
  const [mapData, setMapData] = useState();
  const [localTeam, setLocalTeam] = useState();
  const [bombData, setBombData] = useState();
  const [settings, setSettings] = useState(loadSettings());
  const [connState, setConnState] = useState("connecting");   // connecting | online | retrying
  const [connURL, setConnURL] = useState("");

  // Save settings to local storage whenever they change
  useEffect(() => {
    localStorage.setItem("radarSettings", JSON.stringify(settings));
  }, [settings]);

  // 手机端：首次点按/触摸时请求真全屏（隐藏浏览器地址栏与工具栏）
  //   注意：必须有用户手势才能进全屏；iOS Safari 不支持元素全屏，
  //   但配合上面的 apple-mobile-web-app-capable，加到主屏后打开即是全屏。
  useEffect(() => {
    const goFullscreen = () => {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) {
        el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
      }
    };
    window.addEventListener("touchend", goFullscreen, { once: true });
    window.addEventListener("click", goFullscreen, { once: true });
    return () => {
      window.removeEventListener("touchend", goFullscreen);
      window.removeEventListener("click", goFullscreen);
    };
  }, []);

  useEffect(() => {
    let ws = null;
    let timer = null;
    let stopped = false;
    let attempt = 0;            // 连续失败次数，成功连上就归零
    let rememberedFails = 0;    // "上次记住的地址"连续失败次数

    // 退避：1s -> 2s -> 4s -> 8s -> 封顶 10s
    const backoff = () => Math.min(1000 * 2 ** Math.max(0, attempt - 1), 10000);

    const connect = async () => {
      if (stopped) return;
      setConnState(attempt === 0 ? "connecting" : "retrying");

      // 记住的地址连不上 2 次以上就不再试它（隧道重启后地址会变）
      let url;
      let viaRemembered = false;
      try {
        const r = await resolveWebSocketURL({ useRemembered: rememberedFails < 2 });
        url = r.url;
        viaRemembered = r.viaRemembered;
      } catch {
        url = `ws://${window.location.hostname}:${PORT}/cs2_webradar`;
      }
      if (stopped) return;
      setConnURL(url);

      try {
        ws = new WebSocket(url);
      } catch {
        attempt += 1;
        if (viaRemembered) rememberedFails += 1;
        timer = setTimeout(connect, backoff());
        return;
      }

      // 握手看门狗：连不上就赶紧关掉走重连，别一直挂着
      const watchdog = setTimeout(() => { try { ws.close(); } catch { /* ignore */ } }, CONNECTION_TIMEOUT);

      ws.onopen = () => {
        clearTimeout(watchdog);
        attempt = 0;
        rememberedFails = 0;
        setConnState("online");
        console.info("[ws] connected", url);
      };

      ws.onclose = () => {
        clearTimeout(watchdog);
        if (stopped) return;
        attempt += 1;
        if (viaRemembered) rememberedFails += 1;
        if (rememberedFails >= 2) {
          try { localStorage.removeItem(RELAY_HOST_KEY); } catch { /* ignore */ }
        }
        setConnState("retrying");
        timer = setTimeout(connect, backoff());
      };

      // onerror 后面一定跟着 onclose，重连逻辑只写在 onclose 里，避免重复排程
      ws.onerror = () => { /* handled by onclose */ };

      ws.onmessage = async (event) => {
        let parsed;
        try { parsed = JSON.parse(await event.data.text()); } catch { return; }

        setPlayerArray(parsed.m_players || []);
        setLocalTeam(parsed.m_local_team);
        setBombData(parsed.m_bomb);

        const map = parsed.m_map;
        if (!map || map === "invalid") return;
        try {
          const info = await (await fetch(`data/${map}/data.json`)).json();
          setMapData({ ...info, name: map });
          document.body.style.backgroundImage = `url(./data/${map}/background.png)`;
        } catch { /* 地图资源缺失不致命 */ }
      };
    };

    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, []);

  return (
    <div className="w-screen h-[100dvh] flex flex-col"
      style={{
        background: `radial-gradient(50% 50% at 50% 50%, rgba(20, 40, 55, 0.95) 0%, rgba(7, 20, 30, 0.95) 100%)`,
        backdropFilter: `blur(7.5px)`,
      }}
    >
      <div className={`w-full h-full flex flex-col justify-center overflow-hidden relative`}>
        <div className={`absolute right-2.5 top-2.5 z-50`}>
          <SettingsButton settings={settings} onSettingsChange={setSettings} />
        </div>

        {/* 连接状态：断线时给个明确提示，而不是停在最后一帧骗人 */}
        {connState !== "online" && (
          <div
            className="absolute left-2.5 top-2.5 z-50 px-3 py-1.5 rounded-xl text-sm
                       bg-radar-panel/80 backdrop-blur border border-radar-secondary/20 text-radar-primary"
            title={connURL}
          >
            {connState === "connecting" ? "连接中…" : "已断开 · 重连中…"}
          </div>
        )}

        {bombData && bombData.m_blow_time > 0 && !bombData.m_is_defused && (
          <div className={`absolute left-1/2 top-2 flex-col items-center gap-1 z-50`}>
            <div className={`flex justify-center items-center gap-1`}>
              <MaskedIcon
                path={`./assets/icons/c4_sml.png`}
                height={32}
                color={
                  (bombData.m_is_defusing &&
                    bombData.m_blow_time - bombData.m_defuse_time > 0 &&
                    `bg-radar-green`) ||
                  (bombData.m_blow_time - bombData.m_defuse_time < 0 &&
                    `bg-radar-red`) ||
                  `bg-radar-secondary`
                }
              />
              <span>{`${bombData.m_blow_time.toFixed(1)}s ${(bombData.m_is_defusing &&
                `(${bombData.m_defuse_time.toFixed(1)}s)`) ||
                ""
                }`}</span>
            </div>
          </div>
        )}

        <div className={`flex items-center justify-evenly`}>
          <ul id="terrorist" className="lg:flex hidden flex-col gap-7 m-0 p-0">
            {playerArray
              .filter((player) => player.m_team == 2)
              .map((player) => (
                <PlayerCard
                  right={false}
                  key={player.m_idx}
                  playerData={player}
                />
              ))}
          </ul>

          {(playerArray.length > 0 && mapData && (
            <Radar
              playerArray={playerArray}
              radarImage={`./data/${mapData.name}/radar.png`}
              mapData={mapData}
              localTeam={localTeam}
              bombData={bombData}
              settings={settings}
            />
          )) || (
              <div id="radar" className={`relative overflow-hidden origin-center`}>
                <h1 className="radar_message">
                  {connState === "online"
                    ? "已连接中继，等待数据…（确认 CS2 已进入对局）"
                    : "正在连接中继…"}
                </h1>
              </div>
            )}

          <ul
            id="counterTerrorist"
            className="lg:flex hidden flex-col gap-7 m-0 p-0"
          >
            {playerArray
              .filter((player) => player.m_team == 3)
              .map((player) => (
                <PlayerCard
                  right={true}
                  key={player.m_idx}
                  playerData={player}
                  settings={settings}
                />
              ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default App;
