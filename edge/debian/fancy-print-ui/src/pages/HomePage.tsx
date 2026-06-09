import React, { useCallback, useRef, useState } from 'react';
import { ContentMode } from '../App';
import { useDaemon } from '../services/DaemonContext.js';

interface Props {
  contentMode: ContentMode;
  onModeChange: (mode: ContentMode) => void;
  onStartRecording: (audioPath?: string) => void;
  statusMessage: string;
  daemonOnline: boolean;
  batteryPercent: number;
  onOpenSettings: () => void;
}

type HomePhase = 'launcher' | 'workspace';

const featureCards: {
  mode: ContentMode;
  titleZh: string;
  titleEn: string;
  tint: string;
  Icon: React.FC;
}[] = [
  {
    mode: 'ai_create',
    titleZh: '变彩画',
    titleEn: 'COLOR PAINTING',
    tint: 'blue',
    Icon: IconColorPainting,
  },
  {
    mode: 'coloring',
    titleZh: '变线稿',
    titleEn: 'LINE ART',
    tint: 'purple',
    Icon: IconLineArt,
  },
  {
    mode: 'template',
    titleZh: '安静书',
    titleEn: 'QUIET BOOK',
    tint: 'green',
    Icon: IconQuietBook,
  },
  {
    mode: 'my_works',
    titleZh: '小相册',
    titleEn: 'MINI PHOTO ALBUM',
    tint: 'yellow',
    Icon: IconAlbum,
  },
];

const HomePage: React.FC<Props> = ({
  contentMode,
  onModeChange,
  onStartRecording,
  statusMessage,
  daemonOnline,
  batteryPercent,
  onOpenSettings,
}) => {
  const daemon = useDaemon();
  const recordingRef = useRef(false);
  const [phase, setPhase] = useState<HomePhase>('launcher');
  const currentCard = featureCards.find(m => m.mode === contentMode);

  const handlePointerDown = useCallback(async () => {
    if (recordingRef.current) return;
    recordingRef.current = true;
    try {
      const result = await daemon.startRecording();
      if (!result.started) {
        recordingRef.current = false;
      }
    } catch {
      recordingRef.current = false;
    }
  }, [daemon]);

  const handlePointerUp = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    try {
      const result = await daemon.stopRecording();
      onStartRecording(result.audioPath);
    } catch {
      onStartRecording(undefined);
    }
  }, [daemon, onStartRecording]);

  const enterMode = (mode: ContentMode) => {
    onModeChange(mode);
    setPhase('workspace');
  };

  if (phase === 'launcher') {
    return (
      <div className="home-launcher">
        <div className="home-launcher-bg" aria-hidden />
        <div className="home-launcher-decor" aria-hidden>
          <span className="home-cloud home-cloud-1" />
          <span className="home-cloud home-cloud-2" />
          <span className="home-cloud home-cloud-3" />
          <span className="home-star home-star-1">✦</span>
          <span className="home-star home-star-2">✧</span>
          <span className="home-star home-star-3">✦</span>
          <span className="home-rainbow" aria-hidden />
        </div>

        <div className="home-launcher-inner">
          <div className="home-feature-grid">
            {featureCards.map(card => (
              <button
                key={card.mode}
                type="button"
                className={`home-feature-card home-feature-card--${card.tint}`}
                onClick={() => enterMode(card.mode)}
              >
                <span className="home-feature-card__glass" />
                <span className="home-feature-card__icon" aria-hidden>
                  <card.Icon />
                </span>
                <span className="home-feature-card__titles">
                  <span className="home-feature-card__zh">{card.titleZh}</span>
                  <span className="home-feature-card__en">{card.titleEn}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="home-launcher-footer">
          <RabbitPeek aria-hidden />
          <button type="button" className="home-settings-btn" onClick={onOpenSettings}>
            <span className="home-settings-gear" aria-hidden>
              <IconGear />
            </span>
            <span className="home-settings-label">设置</span>
          </button>
        </div>
      </div>
    );
  }

  /* —— 工作区：原有 PTT 流程 —— */
  return (
    <>
      <header className="top-bar">
        <span className="top-bar-left-group">
          <button type="button" className="home-back-to-launcher" onClick={() => setPhase('launcher')}>
            ← 主页
          </button>
          <span className="device-name">奇想印印</span>
        </span>
        <span className="top-bar-center">{currentCard?.titleZh}</span>
        <span className="top-bar-right">
          <span className={`status-icon ${daemonOnline ? 'wifi' : 'wifi-off'}`} title={daemonOnline ? '已连接' : '离线'} />
          <span className="status-label">{batteryPercent > 0 ? `${batteryPercent}%` : ''}</span>
        </span>
      </header>

      <main className="main-content">
        <nav className="mode-nav">
          {featureCards.map(m => (
            <button
              key={m.mode}
              type="button"
              className={`mode-btn ${contentMode === m.mode ? 'active' : ''}`}
              onClick={() => onModeChange(m.mode)}
            >
              <span className="mode-icon">
                <m.Icon />
              </span>
              <span className="mode-label">{m.titleZh}</span>
            </button>
          ))}
        </nav>

        <section
          className={`preview-area ${daemonOnline ? '' : 'offline'}`}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          style={{ touchAction: 'none' }}
        >
          <div className="preview-placeholder">
            <div className="ptt-hint-icon">🎤</div>
            <p className="ptt-hint-text">{statusMessage}</p>
            <p className="ptt-hint-sub">按住说话 → 生成打印</p>
          </div>
        </section>

        <aside className="toolbar">
          {contentMode === 'coloring' && (
            <>
              <ToolButton icon="✏️" label="线稿" active />
              <ToolButton icon="🖌️" label="画笔" />
              <ToolButton icon="🎨" label="填色" />
              <ToolButton icon="🧹" label="橡皮" />
            </>
          )}
          {contentMode === 'ai_create' && (
            <>
              <ToolButton icon="🖼️" label="风格" active />
              <ToolButton icon="📏" label="比例" />
            </>
          )}
          {contentMode === 'template' && <ToolButton icon="📋" label="模板" active />}
          {contentMode === 'my_works' && <ToolButton icon="🖼️" label="作品" active />}
        </aside>
      </main>

      <footer className="bottom-bar">
        <button type="button" className="action-btn primary" disabled>
          {statusMessage}
        </button>
        <button type="button" className="action-btn secondary" onClick={onOpenSettings}>
          ⚙️
        </button>
      </footer>
    </>
  );
};

const ToolButton: React.FC<{ icon: string; label: string; active?: boolean }> = ({
  icon,
  label,
  active,
}) => (
  <button type="button" className={`tool-btn ${active ? 'active' : ''}`}>
    <span className="tool-icon">{icon}</span>
    <span className="tool-label">{label}</span>
  </button>
);

function IconColorPainting() {
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="22" cy="40" rx="14" ry="10" fill="#d4a574" stroke="#b8956a" strokeWidth="1.5" />
      <circle cx="16" cy="36" r="4" fill="#f472b6" />
      <circle cx="22" cy="34" r="4" fill="#60a5fa" />
      <circle cx="28" cy="38" r="4" fill="#fbbf24" />
      <path d="M38 28 L52 14 L56 18 L42 32 Z" fill="#fef3c7" stroke="#e5c07a" strokeWidth="1.2" />
      <path d="M38 28 L42 32 L36 38 Z" fill="#94a3b8" />
    </svg>
  );
}

function IconLineArt() {
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 44 L20 20 L32 36 L44 16 L52 44 Z"
        stroke="#8b5cf6"
        strokeWidth="2.5"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="24" cy="26" r="3" stroke="#8b5cf6" strokeWidth="2" fill="none" />
      <path d="M40 42 L54 26" stroke="#f472b6" strokeWidth="4" strokeLinecap="round" />
      <path d="M40 38 L54 22" stroke="#fbbf24" strokeWidth="3" strokeLinecap="round" />
      <path d="M40 34 L54 18" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function IconQuietBook() {
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 14 H46 Q50 14 50 18 V50 Q50 54 46 54 H18 Q14 54 14 50 V18 Q14 14 18 14 Z" fill="#fef9c3" stroke="#d97706" strokeWidth="1.5" />
      <path d="M32 14 V54" stroke="#d97706" strokeWidth="1.2" />
      <rect x="20" y="22" width="10" height="10" rx="2" fill="#fca5a5" opacity="0.9" />
      <polygon points="38,22 46,26 38,30" fill="#93c5fd" />
      <path d="M22 38 H30 M22 42 H28" stroke="#78716c" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M38 38 L44 44 M38 44 L44 38" stroke="#a78bfa" strokeWidth="1.5" />
      <path d="M48 12 L52 8 L56 14 L50 18 Z" fill="#fde047" stroke="#ca8a04" strokeWidth="0.8" />
    </svg>
  );
}

function IconAlbum() {
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="18" width="20" height="24" rx="2" fill="#fff" stroke="#94a3b8" strokeWidth="1.5" />
      <rect x="14" y="22" width="12" height="10" rx="1" fill="#bfdbfe" />
      <circle cx="20" cy="38" r="3" fill="#fca5a5" />
      <rect x="34" y="22" width="20" height="24" rx="2" fill="#fff" stroke="#94a3b8" strokeWidth="1.5" transform="rotate(-6 44 34)" />
      <rect x="38" y="26" width="12" height="10" rx="1" fill="#fde68a" transform="rotate(-6 44 34)" />
      <circle cx="44" cy="42" r="3" fill="#86efac" transform="rotate(-6 44 34)" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RabbitPeek(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      className="home-rabbit-svg"
      viewBox="0 0 120 100"
      width="100"
      height="84"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <ellipse cx="60" cy="88" rx="40" ry="12" fill="rgba(255,255,255,0.35)" />
      <path
        d="M28 70 Q28 48 48 42 Q60 38 72 42 Q92 48 92 70 Q92 82 60 88 Q28 82 28 70 Z"
        fill="#fefefe"
        stroke="#e8e0f0"
        strokeWidth="2"
      />
      <ellipse cx="42" cy="38" rx="10" ry="28" fill="#fefefe" stroke="#e8e0f0" strokeWidth="2" transform="rotate(-15 42 38)" />
      <ellipse cx="78" cy="38" rx="10" ry="28" fill="#fefefe" stroke="#e8e0f0" strokeWidth="2" transform="rotate(15 78 38)" />
      <ellipse cx="52" cy="58" rx="4" ry="5" fill="#2d2a32" />
      <ellipse cx="68" cy="58" rx="4" ry="5" fill="#2d2a32" />
      <ellipse cx="60" cy="68" rx="5" ry="3" fill="#ffb7c5" />
      <path
        d="M52 52 Q60 48 68 52"
        stroke="#2d2a32"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M48 22 L54 14 L60 18 L54 26 Z"
        fill="#fde047"
        stroke="#ca8a04"
        strokeWidth="0.8"
      />
      <circle cx="54" cy="18" r="3" fill="#fde68a" />
    </svg>
  );
}

export default HomePage;
