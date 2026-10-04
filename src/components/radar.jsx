import { useRef } from "react";
import Player from "./player";
import Bomb from "./bomb";

const Radar = ({
  playerArray,
  radarImage,
  mapData,
  localTeam,
  bombData,
  settings
}) => {
  const radarImageRef = useRef();

  // 容器自己"适应视口"，不再依赖父级 flex 行的宽度：
  //   宽  <= 95vw（留一点边距）
  //   高  <= 70dvh（手机竖屏时给上下 UI 留位置）
  //   保持 1:1（radar.png 都是 1024x1024 的正方形）
  // 这样无论手机/PC/横竖屏，整张地图永远完整可见。
  return (
    <div
      id="radar"
      className={`relative overflow-visible origin-center min-w-0
                  w-[min(95vw,70dvh)] h-[min(95vw,70dvh)]`}
    >
      <img
        ref={radarImageRef}
        className={`block w-full h-full object-contain select-none`}
        src={radarImage}
        draggable={false}
      />

      {playerArray.map((player) => (
        <Player
          key={player.m_idx}
          playerData={player}
          mapData={mapData}
          radarImage={radarImageRef.current}
          localTeam={localTeam}
          settings={settings}
        />
      ))}

      {bombData && (
        <Bomb
          bombData={bombData}
          mapData={mapData}
          radarImage={radarImageRef.current}
          localTeam={localTeam}
          settings={settings}
        />
       )}
    </div>
  );
};

export default Radar;
