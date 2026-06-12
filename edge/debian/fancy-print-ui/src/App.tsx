import { useState, type ReactNode, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, Wifi, BatteryFull, VolumeX, Settings } from "lucide-react";
import VoiceChat from "./components/VoiceChat";
import LineArtSearch from "./components/LineArtSearch";
import QuietBook from "./components/QuietBook";
import MyWorks from "./components/MyWorks";
import { DaemonProvider, useDaemon } from "./services/DaemonContext";

interface WorkItem {
  id: string;
  emoji: string;
  desc: string;
  type: string;
  date: string;
  starred: boolean;
}

type TabId = "voice" | "search" | "book" | "works";
export type ContentMode = "ai_create" | "coloring" | "template" | "my_works";

const tabs: {
  id: TabId;
  emoji: string;
  label: string;
  subtitle: string;
  gradient: string;
  ring: string;
}[] = [
  { id: "voice", emoji: "🎨", label: "涂鸦", subtitle: "说出心愿，AI 画给你", gradient: "linear-gradient(135deg, #fbcfe8, #c084fc)", ring: "#d8b4fe" },
  { id: "search", emoji: "✏️", label: "线稿", subtitle: "挑一张喜欢的来涂色", gradient: "linear-gradient(135deg, #fde68a, #fbcfe8)", ring: "#fcd34d" },
  { id: "book", emoji: "📖", label: "安静书", subtitle: "生成专属故事书", gradient: "linear-gradient(135deg, #a7f3d0, #c4b5fd)", ring: "#a5b4fc" },
  { id: "works", emoji: "🖼️", label: "相册", subtitle: "回看打印过的宝贝", gradient: "linear-gradient(135deg, #c4b5fd, #f9a8d4)", ring: "#f472b6" },
];

function modeToEnumByType(type: string): number {
  switch (type) {
    case "线稿":
      return 2;
    case "安静书":
      return 3;
    default:
      return 1;
  }
}

function StatusPill({ icon, label, tint, bg }: { icon: ReactNode; label: string; tint: string; bg: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{ background: bg, color: tint, fontFamily: "Nunito, sans-serif", fontSize: 12, fontWeight: 700 }}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

function AppInner() {
  const daemon = useDaemon();
  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [works, setWorks] = useState<WorkItem[]>([]);
  const [printToast, setPrintToast] = useState<{ emoji: string; desc: string } | null>(null);
  const [daemonOnline, setDaemonOnline] = useState(false);
  const [batteryPercent, setBatteryPercent] = useState(0);
  const [statusLabel, setStatusLabel] = useState("安静模式");

  useEffect(() => {
    const poll = async () => {
      try {
        const status = await daemon.getDeviceStatus();
        setDaemonOnline(status.connection === 1);
        setBatteryPercent(status.batteryPercent);
      } catch {
        setDaemonOnline(false);
      }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
  }, [daemon]);

  const runPrintFlow = async (type: string) => {
    const modeNum = modeToEnumByType(type);
    const job = await daemon.createPrintJob({
      contentMode: modeNum,
      previewImageUrl: "",
      copies: 1,
    });

    const MAX_POLLS = 30;
    const POLL_MS = 2000;
    let previewReady = false;
    for (let i = 0; i < MAX_POLLS; i++) {
      try {
        const preview = await daemon.getPreview(job.jobId);
        if (preview.imageUrl) {
          previewReady = true;
          break;
        }
      } catch {
        // preview 未就绪继续轮询
      }
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }

    if (!previewReady) {
      setStatusLabel("生成超时，待重试");
      return;
    }

    const result = await daemon.confirmPrint({ jobId: job.jobId, confirmed: true });
    setStatusLabel(result.success ? "打印中" : daemon.errorCodeToMessage(result.errorCode) || "打印失败");
  };

  const handlePrint = async (item: { emoji: string; desc: string; type: string }) => {
    const newWork: WorkItem = {
      id: Date.now().toString(),
      emoji: item.emoji,
      desc: item.desc,
      type: item.type,
      date: new Date().toLocaleDateString("zh-CN", { month: "short", day: "numeric" }),
      starred: false,
    };
    setWorks(prev => [newWork, ...prev]);
    setPrintToast({ emoji: item.emoji, desc: item.desc });
    setTimeout(() => setPrintToast(null), 3000);

    try {
      setStatusLabel("创作中...");
      await runPrintFlow(item.type);
    } catch {
      setStatusLabel("打印链路待对接");
    }
  };

  const handleDelete = (id: string) => setWorks(prev => prev.filter(w => w.id !== id));
  const handleToggleStar = (id: string) => setWorks(prev => prev.map(w => (w.id === id ? { ...w, starred: !w.starred } : w)));
  const handlePrintAgain = (item: WorkItem) => {
    setPrintToast({ emoji: item.emoji, desc: item.desc });
    setTimeout(() => setPrintToast(null), 3000);
    setStatusLabel("创作中...");
    runPrintFlow(item.type).catch(() => {
      setStatusLabel("打印链路待对接");
    });
  };

  const activeTabMeta = tabs.find(t => t.id === activeTab);

  return (
    <div className="relative flex size-full flex-col overflow-hidden" style={{ background: "linear-gradient(135deg, #fef6ff 0%, #fdf2ff 30%, #f0e8ff 60%, #fce7f3 100%)", fontFamily: "Nunito, sans-serif" }}>
      <div className="flex items-center justify-between px-6 py-3" style={{ background: "linear-gradient(90deg, rgba(243,232,255,0.95), rgba(252,231,243,0.95))", borderBottom: "2px solid rgba(192,132,252,0.18)" }}>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: "linear-gradient(135deg, #a855f7, #ec4899)" }}><span style={{ fontSize: 22 }}>🧸</span></div>
          <div className="flex flex-col leading-tight">
            <span style={{ fontFamily: "Fredoka One, cursive", fontSize: 22, color: "#7e22ce", letterSpacing: 1 }}>奇想印印</span>
            <span style={{ fontFamily: "Nunito, sans-serif", fontSize: 11, color: "#a78bba" }}>儿童打印站 ✨</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <StatusPill icon={<Wifi size={14} />} label={daemonOnline ? "Wi-Fi 已连接" : "离线"} tint={daemonOnline ? "#a855f7" : "#ef4444"} bg={daemonOnline ? "#f3e8ff" : "#fee2e2"} />
          <StatusPill icon={<BatteryFull size={14} />} label={`${batteryPercent}%`} tint={batteryPercent < 20 ? "#dc2626" : "#16a34a"} bg={batteryPercent < 20 ? "#fee2e2" : "#dcfce7"} />
          <StatusPill icon={<VolumeX size={14} />} label={statusLabel} tint="#db2777" bg="#fce7f3" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col py-4">
        <div className="flex flex-1 items-center justify-center px-8">
          <div className="grid w-full max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
            {tabs.map(tab => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className="flex flex-col items-center gap-3" style={{ background: "transparent", border: "none", cursor: "pointer" }}>
                <div className="relative flex items-center justify-center rounded-full" style={{ width: 130, height: 130, background: tab.gradient, border: `5px solid ${tab.ring}` }}>
                  <span style={{ fontSize: 64 }}>{tab.emoji}</span>
                </div>
                <div className="flex flex-col items-center">
                  <span style={{ fontFamily: "Fredoka One, cursive", fontSize: 22, color: "#7e22ce" }}>{tab.label}</span>
                  <span style={{ fontFamily: "Nunito, sans-serif", fontSize: 12, color: "#a78bba", marginTop: 2 }}>{tab.subtitle}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between px-6 py-3" style={{ background: "linear-gradient(90deg, rgba(252,231,243,0.9), rgba(243,232,255,0.9))", borderTop: "2px solid rgba(192,132,252,0.18)" }}>
        <div className="flex items-center gap-2" style={{ fontFamily: "Nunito, sans-serif", fontSize: 11, color: "#a78bba" }}>
          <span style={{ fontSize: 16 }}>🐻</span>
          <span>陪你一起创作的小伙伴</span>
        </div>
        <button type="button" onClick={() => setShowSettings(true)} className="flex items-center gap-2 rounded-full px-4 py-2" style={{ background: "white", border: "2px solid rgba(192,132,252,0.3)", color: "#7e22ce" }}>
          <Settings size={16} />
          <span>设置</span>
        </button>
      </div>
      <AnimatePresence>
        {activeTab && activeTabMeta && !showSettings && (
          <motion.div initial={{ opacity: 0, x: 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 60 }} className="absolute inset-0 z-20 flex flex-col" style={{ background: "linear-gradient(180deg, #faf5ff 0%, #fef3f9 100%)" }}>
            <div className="flex items-center gap-3 px-6 py-3" style={{ background: activeTabMeta.gradient, color: "white", borderBottom: `3px solid ${activeTabMeta.ring}` }}>
              <button type="button" onClick={() => setActiveTab(null)} className="flex items-center gap-2 rounded-full px-3 py-2" style={{ background: "rgba(255,255,255,0.32)", border: "none", color: "white" }}>
                <ArrowLeft size={18} />
                <span>返回</span>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {activeTab === "voice" && <VoiceChat onPrint={handlePrint} />}
              {activeTab === "search" && <LineArtSearch onPrint={handlePrint} />}
              {activeTab === "book" && <QuietBook onPrint={handlePrint} />}
              {activeTab === "works" && <MyWorks works={works} onDelete={handleDelete} onToggleStar={handleToggleStar} onPrintAgain={handlePrintAgain} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {printToast && (
          <motion.div initial={{ opacity: 0, y: 40, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 40, scale: 0.9 }} className="absolute bottom-20 left-1/2 z-30 flex max-w-[340px] -translate-x-1/2 items-center gap-3 rounded-2xl px-5 py-3 shadow-xl" style={{ background: "linear-gradient(135deg, #a855f7, #ec4899)", color: "white" }}>
            <span style={{ fontSize: 28 }}>{printToast.emoji}</span>
            <div className="flex flex-col">
              <span style={{ fontFamily: "Fredoka One, cursive", fontSize: 14 }}>正在打印中... 🖨️</span>
              <span style={{ fontFamily: "Nunito, sans-serif", fontSize: 11, opacity: 0.85 }}>{printToast.desc}</span>
            </div>
            <button type="button" onClick={() => setPrintToast(null)} className="ml-auto border-none bg-transparent text-white opacity-70 hover:opacity-100" style={{ fontFamily: "Nunito, sans-serif", fontSize: 18, cursor: "pointer" }}>×</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <DaemonProvider>
      <AppInner />
    </DaemonProvider>
  );
}
