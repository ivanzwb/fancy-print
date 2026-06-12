import { Printer, Trash2, Star } from "lucide-react";

interface WorkItem {
  id: string;
  emoji: string;
  desc: string;
  type: string;
  date: string;
  starred: boolean;
}

interface MyWorksProps {
  works: WorkItem[];
  onDelete: (id: string) => void;
  onToggleStar: (id: string) => void;
  onPrintAgain: (item: WorkItem) => void;
}

export default function MyWorks({ works, onDelete, onToggleStar, onPrintAgain }: MyWorksProps) {
  if (works.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <span style={{ fontSize: 64 }}>🎨</span>
        <h3 style={{ fontFamily: "Fredoka One, cursive", color: "#3d2a5a", fontSize: 20, textAlign: "center" }}>还没有作品哦！</h3>
        <p className="text-center text-xs" style={{ color: "#7c6a90", fontFamily: "Nunito, sans-serif", lineHeight: 1.8 }}>
          去语音互动、搜索线稿或生成安静书，打印后就能在这里看到啦 ✨
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: "#7c6a90", fontFamily: "Nunito, sans-serif" }}>
          共 {works.length} 件作品
        </span>
      </div>
      {works.map(work => (
        <div key={work.id} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: "white", border: "2px solid rgba(168,85,247,0.12)", boxShadow: "0 2px 12px rgba(168,85,247,0.07)" }}>
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: "#f3e8ff" }}>
            <span style={{ fontSize: 26 }}>{work.emoji}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm" style={{ color: "#3d2a5a", fontFamily: "Nunito, sans-serif", fontWeight: 700 }}>
              {work.desc}
            </p>
            <div className="mt-0.5 flex items-center gap-1">
              <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: "#f3e8ff", color: "#a855f7", fontFamily: "Nunito, sans-serif", fontWeight: 700 }}>
                {work.type}
              </span>
              <span className="text-xs" style={{ color: "#c4b5d4", fontFamily: "Nunito, sans-serif" }}>
                {work.date}
              </span>
            </div>
          </div>
          <div className="flex flex-shrink-0 flex-col gap-1">
            <button type="button" onClick={() => onToggleStar(work.id)} className="rounded-lg p-1.5 transition-all active:scale-90" style={{ background: work.starred ? "#fef3c7" : "#f8f4ff", border: "none" }}>
              <Star size={14} fill={work.starred ? "#f59e0b" : "none"} style={{ color: work.starred ? "#f59e0b" : "#c4b5d4" }} />
            </button>
            <button type="button" onClick={() => onPrintAgain(work)} className="rounded-lg p-1.5 transition-all active:scale-90" style={{ background: "#f3e8ff", border: "none" }}>
              <Printer size={14} style={{ color: "#a855f7" }} />
            </button>
            <button type="button" onClick={() => onDelete(work.id)} className="rounded-lg p-1.5 transition-all active:scale-90" style={{ background: "#fff1f2", border: "none" }}>
              <Trash2 size={14} style={{ color: "#f43f5e" }} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
