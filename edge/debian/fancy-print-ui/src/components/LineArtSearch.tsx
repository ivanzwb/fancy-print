import { useState } from "react";
import { Search, Printer, Download, Sparkles, Mic } from "lucide-react";

const categories = ["动物", "植物", "交通", "食物", "城堡", "太空"];
const voicePromptsLine = ['可爱的小恐龙', '美人鱼公主', '魔法独角兽', '森林精灵小屋'];
const modes = [
  { id: "outline", label: "纯线稿", emoji: "✏️" },
  { id: "dots", label: "连点", emoji: "🔗" },
  { id: "numbers", label: "数字", emoji: "🔢" },
  { id: "letters", label: "字母", emoji: "🔤" },
] as const;
type ModeId = (typeof modes)[number]["id"];

const lineArtData: Record<string, { emoji: string; name: string; bg: string }[]> = {
  动物: [
    { emoji: "🐘", name: "大象", bg: "linear-gradient(135deg,#e0f2fe,#bae6fd)" },
    { emoji: "🦁", name: "狮子", bg: "linear-gradient(135deg,#fef9c3,#fde68a)" },
    { emoji: "🐧", name: "企鹅", bg: "linear-gradient(135deg,#e0e7ff,#c7d2fe)" },
    { emoji: "🦋", name: "蝴蝶", bg: "linear-gradient(135deg,#fce7f3,#fbcfe8)" },
    { emoji: "🐬", name: "海豚", bg: "linear-gradient(135deg,#cffafe,#a5f3fc)" },
    { emoji: "🦊", name: "狐狸", bg: "linear-gradient(135deg,#fed7aa,#fecaca)" },
  ],
  植物: [
    { emoji: "🌸", name: "樱花", bg: "linear-gradient(135deg,#fce7f3,#fbcfe8)" },
    { emoji: "🌵", name: "仙人掌", bg: "linear-gradient(135deg,#d1fae5,#a7f3d0)" },
    { emoji: "🌻", name: "向日葵", bg: "linear-gradient(135deg,#fef9c3,#fde68a)" },
    { emoji: "🍄", name: "蘑菇", bg: "linear-gradient(135deg,#fed7aa,#fecaca)" },
    { emoji: "🌿", name: "嫩芽", bg: "linear-gradient(135deg,#d1fae5,#bbf7d0)" },
    { emoji: "🌺", name: "木槿", bg: "linear-gradient(135deg,#fce7f3,#ddd6fe)" },
  ],
  交通: [
    { emoji: "🚂", name: "小火车", bg: "linear-gradient(135deg,#fee2e2,#fecaca)" },
    { emoji: "✈️", name: "飞机", bg: "linear-gradient(135deg,#dbeafe,#bfdbfe)" },
    { emoji: "🚀", name: "火箭", bg: "linear-gradient(135deg,#e0e7ff,#ddd6fe)" },
    { emoji: "🚢", name: "轮船", bg: "linear-gradient(135deg,#cffafe,#a5f3fc)" },
    { emoji: "🚁", name: "直升机", bg: "linear-gradient(135deg,#fef9c3,#fde68a)" },
    { emoji: "🛸", name: "飞碟", bg: "linear-gradient(135deg,#e0e7ff,#c7d2fe)" },
  ],
  食物: [
    { emoji: "🍕", name: "披萨", bg: "linear-gradient(135deg,#fed7aa,#fde68a)" },
    { emoji: "🍦", name: "冰淇淋", bg: "linear-gradient(135deg,#fce7f3,#fbcfe8)" },
    { emoji: "🎂", name: "蛋糕", bg: "linear-gradient(135deg,#ddd6fe,#c4b5fd)" },
    { emoji: "🍩", name: "甜甜圈", bg: "linear-gradient(135deg,#fecaca,#fca5a5)" },
    { emoji: "🍓", name: "草莓", bg: "linear-gradient(135deg,#fce7f3,#fbcfe8)" },
    { emoji: "🧁", name: "纸杯蛋糕", bg: "linear-gradient(135deg,#fce7f3,#ddd6fe)" },
  ],
  城堡: [
    { emoji: "🏰", name: "魔法城堡", bg: "linear-gradient(135deg,#ddd6fe,#c4b5fd)" },
    { emoji: "🗼", name: "塔楼", bg: "linear-gradient(135deg,#e0e7ff,#c7d2fe)" },
    { emoji: "⚔️", name: "骑士盾", bg: "linear-gradient(135deg,#fef9c3,#fde68a)" },
    { emoji: "🔮", name: "水晶球", bg: "linear-gradient(135deg,#e0e7ff,#ddd6fe)" },
    { emoji: "👑", name: "皇冠", bg: "linear-gradient(135deg,#fef9c3,#fed7aa)" },
    { emoji: "🧙", name: "巫师", bg: "linear-gradient(135deg,#ddd6fe,#fbcfe8)" },
  ],
  太空: [
    { emoji: "🌙", name: "月亮", bg: "linear-gradient(135deg,#fef9c3,#e0e7ff)" },
    { emoji: "⭐", name: "星星", bg: "linear-gradient(135deg,#fef9c3,#fde68a)" },
    { emoji: "🪐", name: "土星", bg: "linear-gradient(135deg,#e0e7ff,#ddd6fe)" },
    { emoji: "🌠", name: "流星", bg: "linear-gradient(135deg,#dbeafe,#ddd6fe)" },
    { emoji: "👾", name: "外星人", bg: "linear-gradient(135deg,#d1fae5,#a7f3d0)" },
    { emoji: "🔭", name: "望远镜", bg: "linear-gradient(135deg,#e0e7ff,#c7d2fe)" },
  ],
};

const allLineItems = () => Object.values(lineArtData).flat();

export default function LineArtSearch({ onPrint }: { onPrint: (item: { emoji: string; desc: string; type: string }) => void }) {
  const [selected, setSelected] = useState("动物");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<ModeId>("outline");
  const [preview, setPreview] = useState<{ emoji: string; name: string; bg: string } | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [printedIds, setPrintedIds] = useState<Set<string>>(new Set());
  const [listening, setListening] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [transcript, setTranscript] = useState("");

  const handleLineMic = () => {
    if (listening || generating) return;
    setListening(true);
    setTranscript("");
    const p = voicePromptsLine[Math.floor(Math.random() * voicePromptsLine.length)];
    let i = 0;
    const t = setInterval(() => {
      i++;
      setTranscript(p.slice(0, i));
      if (i >= p.length) {
        clearInterval(t);
        setListening(false);
        setGenerating(true);
        setTimeout(() => {
          const items = allLineItems();
          const picked = items[Math.floor(Math.random() * items.length)];
          setPreview(picked);
          setGenerating(false);
          setMode("outline");
        }, 1500);
      }
    }, 55);
  };

  const allItems = Object.values(lineArtData).flat();
  const filtered = search ? allItems.filter(i => i.name.includes(search)) : lineArtData[selected] || [];
  const key = preview ? `${preview.name}-${mode}` : "";

  const handleSave = () => {
    if (preview) setSavedIds(prev => new Set(prev).add(key));
  };

  const handlePrint = () => {
    if (!preview) return;
    onPrint({ emoji: preview.emoji, desc: `${preview.name} · ${modes.find(m => m.id === mode)!.label}`, type: "线稿" });
    setPrintedIds(prev => new Set(prev).add(key));
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4 overflow-hidden">
      {/* Voice mic bar */}
      <div className="flex shrink-0 items-center gap-3 rounded-2xl px-4 py-3" style={{ background: "linear-gradient(135deg,#fdf4ff,#fce7f3)", border: "2px dashed rgba(192,132,252,0.3)" }}>
        <button
          type="button"
          onClick={handleLineMic}
          className="flex size-12 shrink-0 items-center justify-center rounded-full border-[3px] border-white shadow-lg transition-all active:scale-95"
          style={{ background: listening ? "linear-gradient(135deg,#f43f5e,#ec4899)" : "linear-gradient(135deg,#a855f7,#c084fc)" }}
        >
          <Mic size={18} color="white" />
        </button>
        <div className="min-w-0 flex-1">
          <div style={{ fontFamily: "Fredoka One, cursive", fontSize: 14, color: "#7e22ce" }}>✏️ 语音生成线稿</div>
          {transcript ? (
            <div className="truncate" style={{ color: "#3d2a5a", fontFamily: "Nunito, sans-serif", fontSize: 12 }}>
              「{transcript}」{generating ? "· 生成中..." : ""}
            </div>
          ) : (
            <div style={{ color: "#a78bba", fontFamily: "Nunito, sans-serif", fontSize: 12 }}>
              {listening ? "🎙️ 正在听..." : generating ? "✨ AI 正在生成线稿..." : "说出你想要的线稿，或从下方挑选模板"}
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2" style={{ background: "#f3e8ff", border: "2px solid rgba(168,85,247,0.2)" }}>
        <Search size={13} style={{ color: "#a855f7" }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索线稿模板..." className="min-w-0 flex-1 bg-transparent outline-none" style={{ color: "#3d2a5a", fontFamily: "Nunito, sans-serif", fontSize: 12 }} />
      </div>

      {!search && (
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {categories.map(cat => (
            <button key={cat} type="button" onClick={() => setSelected(cat)} className="rounded-full px-3 py-1 transition-all active:scale-95" style={{ background: selected === cat ? "linear-gradient(135deg,#a855f7,#ec4899)" : "#f3e8ff", color: selected === cat ? "white" : "#7c6a90", fontFamily: "Nunito, sans-serif", fontWeight: 700, fontSize: 11, border: "none" }}>
              {cat}
            </button>
          ))}
        </div>
      )}

      <div className="grid flex-1 grid-cols-2 gap-2 overflow-y-auto pr-1 content-start">
        {filtered.map(item => (
          <div key={item.name} role="button" tabIndex={0} onClick={() => setPreview(item)} onKeyDown={e => (e.key === "Enter" || e.key === " ") && setPreview(item)} className="flex cursor-pointer flex-col gap-1 rounded-xl p-1.5 transition-all active:scale-95" style={{ background: preview?.name === item.name ? "linear-gradient(135deg,#fbcfe8,#ddd6fe)" : "white", border: preview?.name === item.name ? "2px solid #c084fc" : "2px solid rgba(168,85,247,0.15)", boxShadow: "0 2px 8px rgba(168,85,247,0.08)" }}>
            <div className="relative flex w-full items-center justify-center overflow-hidden rounded-lg" style={{ aspectRatio: "210 / 148", background: item.bg, filter: "grayscale(0.35)" }}>
              <span style={{ fontSize: 34 }}>{item.emoji}</span>
            </div>
            <span className="text-center" style={{ color: "#7c6a90", fontFamily: "Nunito, sans-serif", fontSize: 10 }}>{item.name}</span>
          </div>
        ))}
      </div>

      <div className="grid shrink-0 grid-cols-4 gap-1.5">
        {modes.map(m => (
          <button key={m.id} type="button" onClick={() => setMode(m.id)} className="flex flex-col items-center gap-0.5 rounded-xl py-1.5 transition-all active:scale-95" style={{ background: mode === m.id ? "linear-gradient(135deg,#a855f7,#ec4899)" : "#f3e8ff", color: mode === m.id ? "white" : "#7c6a90", fontFamily: "Nunito, sans-serif", fontWeight: 700, border: "none" }}>
            <span style={{ fontSize: 14 }}>{m.emoji}</span>
            <span style={{ fontSize: 10 }}>{m.label}</span>
          </button>
        ))}
      </div>

      {preview ? (
        <div className="relative flex w-full flex-col items-center justify-center rounded-2xl" style={{ aspectRatio: "210 / 148", background: preview.bg, border: "3px dashed rgba(168,85,247,0.35)", boxShadow: "0 8px 24px rgba(168,85,247,0.15)", filter: "grayscale(0.55)" }}>
          <span className="absolute right-2 top-2 rounded-full px-2 py-0.5" style={{ background: "rgba(255,255,255,0.88)", color: "#7e22ce", fontFamily: "Nunito, sans-serif", fontSize: 9, fontWeight: 700 }}>
            {modes.find(m => m.id === mode)?.emoji} {modes.find(m => m.id === mode)?.label}
          </span>
          <span style={{ fontSize: 56, opacity: 0.6 }}>{preview.emoji}</span>
          <span style={{ color: "#5b21b6", fontFamily: "Fredoka One, cursive", fontSize: 13, marginTop: 2 }}>{preview.name}</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 opacity-60">
          <Sparkles size={30} style={{ color: "#c084fc" }} />
          <span style={{ color: "#a78bba", fontFamily: "Nunito, sans-serif", fontSize: 12 }}>
            {generating ? "AI 正在生成线稿..." : listening ? "🎙️ 正在听你说话..." : "语音生成 或 从左边挑模板"}
          </span>
        </div>
      )}

      {preview && (
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={handleSave} className="flex flex-1 items-center justify-center gap-1 rounded-xl py-2 transition-all active:scale-95" style={{ background: savedIds.has(key) ? "#dcfce7" : "#f3e8ff", color: savedIds.has(key) ? "#15803d" : "#7e22ce", fontFamily: "Nunito, sans-serif", fontWeight: 700, fontSize: 12, border: "none" }}>
            <Download size={13} />
            {savedIds.has(key) ? "已保存" : "保存"}
          </button>
          <button type="button" onClick={handlePrint} disabled={printedIds.has(key)} className="flex flex-1 items-center justify-center gap-1 rounded-xl py-2 transition-all active:scale-95" style={{ background: printedIds.has(key) ? "#dcfce7" : "linear-gradient(135deg,#a855f7,#ec4899)", color: printedIds.has(key) ? "#15803d" : "white", fontFamily: "Nunito, sans-serif", fontWeight: 700, fontSize: 12, border: "none" }}>
            <Printer size={13} />
            {printedIds.has(key) ? "已打印" : "打印"}
          </button>
        </div>
      )}
    </div>
  );
}
