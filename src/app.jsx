import ReactDOM from "react-dom/client";
import { useEffect, useState } from "react";
import "./App.css";
import PlayerCard from "./components/PlayerCard";
import Radar from "./components/Radar";
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

const resolveWebSocketURL = async () => {
  if (USE_LOCALHOST) return `ws://localhost:${PORT}/cs2_webradar`;

  const tls = window.location.protocol === "https:" ? "wss" : "ws";

  const ipParam = new URLSearchParams(window.location.search).get("ip");
  if (ipParam) {
    const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(ipParam);
    return isIPv4
      ? `${tls}://${ipParam}:${PORT}/cs2_webradar`
      : `wss://${ipParam}/cs2_webradar`;
  }

  try {
    const res = await fetch("./__relay", { cache: "no-store" });
    if (res.ok && (await res.text()).trim() === RELAY_MARKER) {
      return `${tls}://${window.location.host}/cs2_webradar`;
    }
  } catch {
    /* 探测失败就按局域网规则走 */
  }

  return `ws://${window.location.hostname}:${PORT}/cs2_webradar`;
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
    const fetchData = async () => {
      let connectionTimeout = null;

      const webSocketURL = await resolveWebSocketURL();
      let webSocket = null;

      try {
        webSocket = new WebSocket(webSocketURL);
      } catch (error) {
        document.getElementsByClassName(
          "radar_message"
        )[0].textContent = `${error}`;
        return;
      }

      connectionTimeout = setTimeout(() => {
        webSocket.close();
      }, CONNECTION_TIMEOUT);

      webSocket.onopen = async () => {
        clearTimeout(connectionTimeout);
        console.info("connected to the web socket");
      };

      webSocket.onclose = async () => {
        clearTimeout(connectionTimeout);
        console.error("disconnected from the web socket");
      };

      webSocket.onerror = async (error) => {
        clearTimeout(connectionTimeout);
        document.getElementsByClassName(
          "radar_message"
        )[0].textContent = `WebSocket connection to '${webSocketURL}' failed. Please check the IP address and try again`;
        console.error(error);
      };

      webSocket.onmessage = async (event) => {
        const parsedData = JSON.parse(await event.data.text());
        setPlayerArray(parsedData.m_players);
        setLocalTeam(parsedData.m_local_team);
        setBombData(parsedData.m_bomb);

        const map = parsedData.m_map;
        if (map !== "invalid") {
          setMapData({
            ...(await (await fetch(`data/${map}/data.json`)).json()),
            name: map,
          });
          document.body.style.backgroundImage = `url(./data/${map}/background.png)`;
        }
      };
    };

    fetchData();
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
                  Connected! Waiting for data from usermode
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
