import { useState } from "react";

const themes = [
  { id: "farm", label: "农场生活", emoji: "🌾", scene: "🚜🌾🌳", color: "linear-gradient(135deg,#d1fae5,#fef3c7)" },
  { id: "ocean", label: "海洋世界", emoji: "🌊", scene: "🐚🌊🪸", color: "linear-gradient(135deg,#dbeafe,#cffafe)" },
  { id: "forest", label: "神秘森林", emoji: "🌲", scene: "🌲🍄🌿", color: "linear-gradient(135deg,#d1fae5,#bbf7d0)" },
  { id: "space", label: "宇宙探险", emoji: "🚀", scene: "🌌⭐🪐", color: "linear-gradient(135deg,#e0e7ff,#ddd6fe)" },
  { id: "city", label: "城市冒险", emoji: "🏙️", scene: "🏙️🚦🌳", color: "linear-gradient(135deg,#fed7aa,#fde68a)" },
];

const palette: Record<string, { characters: { emoji: string; name: string }[]; items: { emoji: string; name: string }[] }> = {
  farm: {
    characters: [{ emoji: "👩‍🌾", name: "农场主" }, { emoji: "🧒", name: "小孩" }, { emoji: "🐄", name: "奶牛" }, { emoji: "🐔", name: "小鸡" }, { emoji: "🐷", name: "小猪" }, { emoji: "🐑", name: "绵羊" }],
    items: [{ emoji: "🌽", name: "玉米" }, { emoji: "🍎", name: "苹果" }, { emoji: "🥕", name: "胡萝卜" }, { emoji: "🍓", name: "草莓" }, { emoji: "🥚", name: "鸡蛋" }, { emoji: "🌻", name: "向日葵" }],
  },
  ocean: {
    characters: [{ emoji: "🧜‍♀️", name: "美人鱼" }, { emoji: "🤿", name: "潜水员" }, { emoji: "🐠", name: "热带鱼" }, { emoji: "🐙", name: "章鱼" }, { emoji: "🐢", name: "海龟" }, { emoji: "🦀", name: "螃蟹" }],
    items: [{ emoji: "🐚", name: "贝壳" }, { emoji: "🪸", name: "珊瑚" }, { emoji: "⚓", name: "船锚" }, { emoji: "🏝️", name: "小岛" }, { emoji: "💎", name: "宝石" }, { emoji: "🌊", name: "海浪" }],
  },
  forest: {
    characters: [{ emoji: "🧚", name: "小精灵" }, { emoji: "🧙", name: "巫师" }, { emoji: "🦊", name: "狐狸" }, { emoji: "🦔", name: "刺猬" }, { emoji: "🐿️", name: "松鼠" }, { emoji: "🦉", name: "猫头鹰" }],
    items: [{ emoji: "🍄", name: "蘑菇" }, { emoji: "🌳", name: "大树" }, { emoji: "🍁", name: "枫叶" }, { emoji: "🌸", name: "樱花" }, { emoji: "🌰", name: "栗子" }, { emoji: "🎋", name: "竹子" }],
  },
  space: {
    characters: [{ emoji: "👨‍🚀", name: "宇航员" }, { emoji: "👽", name: "外星人" }, { emoji: "🤖", name: "机器人" }, { emoji: "🪐", name: "土星" }, { emoji: "🛸", name: "飞碟" }, { emoji: "☄️", name: "彗星" }],
    items: [{ emoji: "⭐", name: "星星" }, { emoji: "🌙", name: "月亮" }, { emoji: "🌠", name: "流星" }, { emoji: "🚀", name: "火箭" }, { emoji: "🛰️", name: "卫星" }, { emoji: "💫", name: "星光" }],
  },
  city: {
    characters: [{ emoji: "👨‍🚒", name: "消防员" }, { emoji: "👮", name: "警察" }, { emoji: "🧑", name: "市民" }, { emoji: "🐕", name: "小狗" }, { emoji: "🐈", name: "小猫" }, { emoji: "🚌", name: "公交车" }],
    items: [{ emoji: "🚦", name: "红绿灯" }, { emoji: "🏠", name: "小屋" }, { emoji: "🏢", name: "大楼" }, { emoji: "🌳", name: "大树" }, { emoji: "🍦", name: "冰淇淋" }, { emoji: "🎈", name: "气球" }],
  },
};

const tabLabels: Record<string, string> = { scene: "🎨 场景", characters: "👫 人物", items: "🎁 物品" };

interface PlacedSticker {
  id: string;
  emoji: string;
  name: string;
  x: number;
  y: number;
  size: number;
}

export default function QuietBook({ onPrint }: { onPrint: (item: { emoji: string; desc: string; type: string }) => void }) {
  const [btab, setBtab] = useState("scene"); // "scene" | "characters" | "items"
  const [themeId, setThemeId] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedSticker[]>([]);
  const [saved, setSaved] = useState(false);
  const [printed, setPrinted] = useState<Record<string, boolean>>({});

  const st = themeId ? themes.find(t => t.id === themeId) ?? null : null;
  const pal = themeId ? palette[themeId] : null;

  const themeSelected = themeId != null;

  // ── ── ── ── ── ──
  // Voice bar
  // ── ── ── ── ── ──
  const voiceSub = btab === "scene" ? "场景" : btab === "characters" ? "人物" : "物品";

  // ── ── ── ── ── ──
  // Main tabs
  // ── ── ── ── ── ──
  const mainTabs = (["scene", "characters", "items"] as const).map(tid => {
    const active = btab === tid;
    const ic = tid === "scene" ? "🎨" : tid === "characters" ? "👫" : "🎁";
    const tx = tid === "scene" ? "场景" : tid === "characters" ? "人物" : "物品";
    return (
      <button
        key={tid}
        type="button"
        onClick={() => setBtab(tid)}
        className="py-2 rounded-xl flex flex-col items-center gap-0.5 font-nunito font-bold text-[11px] border-none active:scale-95"
        style={{
          background: active ? "linear-gradient(135deg,#a855f7,#ec4899)" : "#f3e8ff",
          color: active ? "white" : "#7c6a90",
        }}
      >
        <span style={{ fontSize: 16 }}>{ic}</span>
        <span>{tx}</span>
      </button>
    );
  });

  // ── ── ── ── ── ──
  // Left scrollable content
  // ── ── ── ── ── ──
  let scrollInner: React.ReactNode;

  if (btab === "scene") {
    scrollInner = (
      <div className="flex flex-col gap-2">
        {themes.map(theme => {
          const sel = theme.id === themeId;
          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => { setThemeId(theme.id); setSaved(false); }}
              className="w-full rounded-2xl px-3 py-2.5 flex items-center gap-3 font-nunito font-bold text-[13px] border-none active:scale-95 text-left"
              style={{
                background: sel ? "linear-gradient(135deg,#a855f7,#ec4899)" : theme.color,
                color: sel ? "white" : "#3d2a5a",
                border: sel ? "2px solid #c084fc" : "2px solid rgba(168,85,247,0.15)",
              }}
            >
              <span style={{ fontSize: 26 }}>{theme.emoji}</span>
              <div className="flex flex-col items-start min-w-0 flex-1">
                <span>{theme.label}</span>
                <span style={{ fontSize: 18, lineHeight: 1, opacity: 0.8 }}>{theme.scene}</span>
              </div>
              {sel && <span className="text-sm shrink-0">✓</span>}
            </button>
          );
        })}
        {!themeId && (
          <p className="text-center mt-1 font-nunito text-[11px]" style={{ color: "#a78bba" }}>
            点选一个场景开始创作 ✨
          </p>
        )}
      </div>
    );
  } else if (!themeSelected) {
    scrollInner = (
      <div className="flex flex-col items-center justify-center gap-2 opacity-60 py-8">
        <span style={{ fontSize: 32 }}>👈</span>
        <span className="font-nunito text-xs text-center px-2" style={{ color: "#a78bba" }}>
          先在「场景」tab 选一个主题
        </span>
      </div>
    );
  } else {
    const list = btab === "characters" ? pal!.characters : pal!.items;
    scrollInner = (
      <div className="grid grid-cols-3 gap-2">
        {list.map(item => (
          <button
            key={item.name}
            type="button"
            onClick={() => {
              setPlaced(prev => [...prev, {
                id: String(Date.now()) + "-" + Math.random(),
                emoji: item.emoji,
                name: item.name,
                x: 15 + Math.random() * 70,
                y: 20 + Math.random() * 55,
                size: 28 + Math.random() * 12,
              }]);
            }}
            className="rounded-xl flex flex-col items-center justify-center gap-0.5 p-2 border-none active:scale-90"
            style={{ background: "white", border: "2px solid rgba(168,85,247,0.18)", boxShadow: "0 2px 6px rgba(168,85,247,0.08)", aspectRatio: "1" }}
          >
            <span style={{ fontSize: 28 }}>{item.emoji}</span>
            <span className="font-nunito text-[10px]" style={{ color: "#7c6a90" }}>{item.name}</span>
          </button>
        ))}
      </div>
    );
  }

  // ── ── ── ── ── ──
  // Placed elements list
  // ── ── ── ── ── ──
  let placedListHtml: React.ReactNode = null;
  if ((btab === "characters" || btab === "items") && placed.length > 0) {
    placedListHtml = (
      <div className="rounded-xl p-2 shrink-0 flex flex-col gap-1 font-nunito" style={{ background: "#faf5ff", border: "2px solid rgba(192,132,252,0.2)", maxHeight: 100, overflowY: "auto" }}>
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[10px] font-bold" style={{ color: "#7e22ce" }}>已加入 {placed.length} 个</span>
          <button type="button" onClick={() => setPlaced([])} className="flex items-center gap-0.5 border-none bg-transparent font-nunito text-[10px] font-bold active:scale-95" style={{ color: "#f43f5e" }}>
            🔄 清空
          </button>
        </div>
        {[...placed].slice(-4).reverse().map(p => {
          const pe = printed[p.name];
          return (
            <div key={p.id} className="flex items-center gap-1.5">
              <span style={{ fontSize: 14 }}>{p.emoji}</span>
              <span className="text-[10px] flex-1 truncate" style={{ color: "#5b21b6" }}>{p.name}</span>
              <button
                type="button"
                onClick={() => { onPrint({ emoji: p.emoji, desc: p.name, type: "安静书" }); setPrinted(prev => ({ ...prev, [p.name]: true })); }}
                className="px-1.5 py-0.5 rounded-full border-none font-nunito text-[9px] active:scale-95"
                style={{ background: pe ? "#dcfce7" : "#a855f7", color: pe ? "#15803d" : "white" }}
              >
                {pe ? "✓" : "⎙"}
              </button>
              <button type="button" onClick={() => setPlaced(prev => prev.filter(x => x.id !== p.id))} className="border-none bg-transparent text-[14px] leading-none cursor-pointer px-0.5" style={{ color: "#d1d5db" }}>
                ×
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  // ── ── ── ── ── ──
  // Scene preview
  // ── ── ── ── ── ──
  let previewHtml: React.ReactNode;
  if (st) {
    previewHtml = (
      <div
        className="rounded-2xl relative overflow-hidden w-full"
        style={{
          aspectRatio: "210 / 148",
          maxHeight: "100%",
          background: st.color,
          border: "3px dashed rgba(168,85,247,0.3)",
          boxShadow: "0 8px 24px rgba(168,85,247,0.15)",
        }}
      >
        <div className="absolute inset-0 flex items-end justify-center pb-6 pointer-events-none select-none" style={{ opacity: 0.2 }}>
          <span style={{ fontSize: 80 }}>{st.scene}</span>
        </div>
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full font-nunito text-[9px] font-bold" style={{ background: "rgba(255,255,255,0.85)", color: "#7e22ce" }}>
          {st.emoji} {st.label}
        </div>
        {placed.length > 0 && (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full font-nunito text-[9px] font-bold" style={{ background: "rgba(255,255,255,0.85)", color: "#7e22ce" }}>
            {placed.length} 个元素
          </div>
        )}
        {placed.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPlaced(prev => prev.filter(x => x.id !== p.id))}
            className="absolute border-none bg-transparent cursor-pointer"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              transform: "translate(-50%, -50%)",
              fontSize: p.size,
              filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.18))",
            }}
            title="点击移除"
          >
            {p.emoji}
          </button>
        ))}
        {placed.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none font-nunito text-xs" style={{ color: "#7e22ce", opacity: 0.45 }}>
            从左边选人物或物品加入场景 ✨
          </div>
        )}
      </div>
    );
  } else {
    previewHtml = (
      <div
        className="rounded-2xl flex flex-col items-center justify-center w-full"
        style={{
          aspectRatio: "210 / 148",
          maxHeight: "100%",
          background: "linear-gradient(135deg,#faf5ff,#fce7f3)",
          border: "3px dashed rgba(192,132,252,0.3)",
        }}
      >
        <span style={{ fontSize: 36, color: "#d8b4fe", marginBottom: 8 }}>✨</span>
        <span className="font-fredoka text-base" style={{ color: "#c084fc" }}>选一个场景开始创作</span>
        <span className="font-nunito text-xs mt-1" style={{ color: "#a78bba" }}>先用左边的 tab 选一个场景主题 🎙️</span>
      </div>
    );
  }

  // ── ── ── ── ── ──
  // Bottom buttons
  // ── ── ── ── ── ──
  const dis = !themeSelected;
  const btnBase = "flex-1 min-w-[88px] py-2 rounded-xl flex items-center justify-center gap-1 font-nunito font-bold text-xs border-none active:scale-95";

  return (
    <div className="flex flex-col h-full p-4 gap-3 overflow-hidden min-h-0">
      {/* Voice bar */}
      <div className="flex items-center gap-3 rounded-2xl px-4 py-3 shrink-0" style={{ background: "linear-gradient(135deg,#fdf4ff,#fce7f3)", border: "2px dashed rgba(192,132,252,0.3)" }}>
        <div className="relative w-12 h-12 rounded-full flex items-center justify-center shadow-lg shrink-0 border-[3px] border-white" style={{ background: "linear-gradient(135deg,#a855f7,#c084fc)" }}>
          <span style={{ fontSize: 18 }}>🎙️</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-fredoka text-sm" style={{ color: "#7e22ce" }}>📖 语音生成{voiceSub}</div>
          <div className="font-nunito text-xs" style={{ color: "#a78bba" }}>说出你想要的{tabLabels[btab]}，AI 帮你生成 ✨</div>
        </div>
      </div>

      {/* Body */}
      <div className="flex gap-4 flex-1 min-h-0 flex-col sm:flex-row overflow-hidden">
        {/* Left panel (34%) */}
        <div className="w-full sm:w-[34%] flex flex-col gap-2 min-h-0 shrink-0">
          {/* Three main tabs */}
          <div className="grid grid-cols-3 gap-1.5 shrink-0">
            {mainTabs}
          </div>

          {/* Scrollable content */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
            {scrollInner}
          </div>

          {/* Placed elements list */}
          {placedListHtml}
        </div>

        {/* Right panel: preview + buttons */}
        <div className="flex-1 flex flex-col gap-2 min-h-0 min-w-0">
          <div className="flex-1 flex items-center justify-center min-h-0 overflow-hidden">
            {previewHtml}
          </div>

          {/* Bottom buttons */}
          <div className="flex gap-2 shrink-0 flex-wrap">
            {/* Save */}
            <button
              type="button"
              onClick={() => setSaved(true)}
              disabled={dis}
              className={btnBase}
              style={dis ? { opacity: 0.4, cursor: "not-allowed", background: "#f3e8ff", color: "#a78bba" } : { background: saved ? "#dcfce7" : "#f3e8ff", color: saved ? "#15803d" : "#7e22ce" }}
            >
              💾 {saved ? "已保存" : "保存"}
            </button>

            {/* Print scene */}
            <button
              type="button"
              onClick={() => { onPrint({ emoji: st?.emoji ?? "", desc: `${st?.label ?? ""} · 背景场景`, type: "安静书" }); setPrinted(prev => ({ ...prev, scene: true })); }}
              disabled={dis}
              className={btnBase}
              style={dis ? { opacity: 0.4, cursor: "not-allowed", background: "#f3e8ff", color: "#a78bba" } : { background: printed.scene ? "#dcfce7" : "#f3e8ff", color: printed.scene ? "#15803d" : "#7e22ce" }}
            >
              🖨️ 打印场景
            </button>

            {/* Print full */}
            <button
              type="button"
              onClick={() => { onPrint({ emoji: st?.emoji ?? "", desc: `${st?.label ?? ""} · 完整画面`, type: "安静书" }); setPrinted(prev => ({ ...prev, full: true })); }}
              disabled={dis}
              className={btnBase}
              style={dis ? { opacity: 0.4, cursor: "not-allowed", background: "#e9d5ff", color: "#a78bba" } : { background: "linear-gradient(135deg,#a855f7,#ec4899)", color: "white" }}
            >
              🖨️ 打印全图
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
