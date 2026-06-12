import { useState, useRef } from "react";
import { Mic, MicOff, Sparkles, Printer, Download, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

const prompts = [
  "戴帽子的小猫咪在草地玩耍",
  "彩虹独角兽在云朵跳舞",
  "小熊猫森林里喝下午茶",
  "宇宙飞船和外星朋友旅行",
  "小兔子的魔法蘑菇花园",
];

const imagePool = [
  { emoji: "🐱", desc: "戴帽子的小猫咪", bg: "linear-gradient(135deg, #fef3c7, #fed7aa)" },
  { emoji: "🦄", desc: "彩虹独角兽", bg: "linear-gradient(135deg, #fbcfe8, #ddd6fe)" },
  { emoji: "🐼", desc: "小熊猫下午茶", bg: "linear-gradient(135deg, #d1fae5, #a7f3d0)" },
  { emoji: "🚀", desc: "宇宙飞船冒险", bg: "linear-gradient(135deg, #dbeafe, #c7d2fe)" },
  { emoji: "🐰", desc: "魔法花园", bg: "linear-gradient(135deg, #fce7f3, #fbcfe8)" },
  { emoji: "🦊", desc: "森林小狐狸", bg: "linear-gradient(135deg, #fed7aa, #fecaca)" },
];

type GenImg = { emoji: string; desc: string; bg: string; id: string };

export default function VoiceChat({ onPrint }: { onPrint: (item: { emoji: string; desc: string; type: string }) => void }) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [generating, setGenerating] = useState(false);
  const [images, setImages] = useState<GenImg[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [printedIds, setPrintedIds] = useState<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const generateImages = () => {
    setGenerating(true);
    setTimeout(() => {
      const shuffled = [...imagePool].sort(() => Math.random() - 0.5);
      const picks: GenImg[] = shuffled.slice(0, 2).map((p, idx) => ({ ...p, id: Date.now() + "-" + idx }));
      setImages(picks);
      setGenerating(false);
    }, 1500);
  };

  const startListening = () => {
    setIsListening(true);
    setTranscript("");
    setImages([]);
    setSavedIds(new Set());
    setPrintedIds(new Set());
    const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];
    let i = 0;
    timerRef.current = setInterval(() => {
      i++;
      setTranscript(randomPrompt.slice(0, i));
      if (i >= randomPrompt.length) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setIsListening(false);
        setTimeout(() => generateImages(), 400);
      }
    }, 55);
  };

  const stopListening = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setIsListening(false);
    if (transcript) setTimeout(() => generateImages(), 400);
  };

  const handlePrint = (img: GenImg) => {
    onPrint({ emoji: img.emoji, desc: img.desc, type: "涂鸦" });
    setPrintedIds(prev => new Set(prev).add(img.id));
  };

  const handleSave = (img: GenImg) => {
    setSavedIds(prev => new Set(prev).add(img.id));
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex shrink-0 items-center gap-3 rounded-2xl px-4 py-3" style={{ background: "linear-gradient(135deg, #fdf4ff, #fce7f3)", border: "2px dashed rgba(192,132,252,0.3)" }}>
        <button type="button" onClick={isListening ? stopListening : startListening} disabled={generating} className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full shadow-lg transition-all active:scale-95" style={{ background: isListening ? "linear-gradient(135deg, #f43f5e, #ec4899)" : "linear-gradient(135deg, #a855f7, #c084fc)", border: "4px solid white" }}>
          {isListening && <span className="absolute inset-0 animate-ping rounded-full opacity-40" style={{ background: "#f43f5e" }} />}
          {isListening ? <MicOff size={22} color="white" /> : <Mic size={22} color="white" />}
        </button>
        <div className="min-w-0 flex-1">
          <div style={{ fontFamily: "Fredoka One, cursive", fontSize: 14, color: "#7e22ce" }}>🎨 语音涂鸦</div>
          {transcript ? (
            <div className="truncate" style={{ color: "#3d2a5a", fontFamily: "Nunito, sans-serif", fontSize: 12 }}>
              「{transcript}」{generating && " · AI 正在画..."}
            </div>
          ) : (
            <div style={{ color: "#a78bba", fontFamily: "Nunito, sans-serif", fontSize: 12 }}>
              {isListening ? "🎙️ 正在听你说话..." : generating ? "✨ AI 正在画两张图..." : "按下麦克风，说出你想画的内容 ✨"}
            </div>
          )}
        </div>
        {!generating && images.length > 0 && (
          <button type="button" onClick={generateImages} className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 transition-all active:scale-95" style={{ background: "white", border: "2px solid #c084fc", color: "#7e22ce", fontFamily: "Nunito, sans-serif", fontWeight: 700, fontSize: 12 }}>
            <Sparkles size={12} /> 再画
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-4">
        {generating && (
          <div className="flex flex-col items-center gap-2">
            <RefreshCw size={32} className="animate-spin" style={{ color: "#a855f7" }} />
            <span style={{ color: "#7c6a90", fontFamily: "Nunito, sans-serif", fontSize: 13 }}>AI 同时创作两个版本...</span>
          </div>
        )}
        {!generating && images.length === 0 && (
          <div className="flex flex-col items-center gap-2 opacity-60">
            <Sparkles size={36} style={{ color: "#c084fc" }} />
            <span style={{ color: "#a78bba", fontFamily: "Nunito, sans-serif", fontSize: 13 }}>说出你的想法，AI 一次画两张哦 🎨</span>
          </div>
        )}
        <AnimatePresence>
          {!generating &&
            images.map((img, idx) => (
              <motion.div key={img.id} initial={{ opacity: 0, y: 16, scale: 0.92 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: idx * 0.1 }} className="flex flex-col gap-2" style={{ flex: "1 1 0", minWidth: 0, maxWidth: "48%" }}>
                <div className="relative flex w-full flex-col items-center justify-center rounded-2xl" style={{ aspectRatio: "210 / 148", background: img.bg, border: "3px dashed rgba(168,85,247,0.3)", boxShadow: "0 8px 24px rgba(168,85,247,0.15)" }}>
                  <span className="absolute left-2 top-2 rounded-full px-2 py-0.5" style={{ background: "rgba(255,255,255,0.75)", color: "#7e22ce", fontFamily: "Nunito, sans-serif", fontSize: 9, fontWeight: 700 }}>
                    版本 {idx + 1}
                  </span>
                  <span style={{ fontSize: 72 }}>{img.emoji}</span>
                  <span style={{ color: "#5b21b6", fontFamily: "Fredoka One, cursive", fontSize: 13, marginTop: 4 }}>{img.desc}</span>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => handleSave(img)} className="flex flex-1 items-center justify-center gap-1 rounded-xl py-1.5 transition-all active:scale-95" style={{ background: savedIds.has(img.id) ? "#dcfce7" : "#f3e8ff", color: savedIds.has(img.id) ? "#15803d" : "#7e22ce", fontFamily: "Nunito, sans-serif", fontWeight: 700, fontSize: 11, border: "none" }}>
                    <Download size={12} />
                    {savedIds.has(img.id) ? "已保存" : "保存"}
                  </button>
                  <button type="button" onClick={() => handlePrint(img)} disabled={printedIds.has(img.id)} className="flex flex-1 items-center justify-center gap-1 rounded-xl py-1.5 transition-all active:scale-95" style={{ background: printedIds.has(img.id) ? "#dcfce7" : "linear-gradient(135deg, #a855f7, #ec4899)", color: printedIds.has(img.id) ? "#15803d" : "white", fontFamily: "Nunito, sans-serif", fontWeight: 700, fontSize: 11, border: "none" }}>
                    <Printer size={12} />
                    {printedIds.has(img.id) ? "已打印" : "打印"}
                  </button>
                </div>
              </motion.div>
            ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
