import React, { useCallback, useRef, useState } from 'react';
import { ContentMode } from '../App';
import { useDaemon } from '../services/DaemonContext.js';

import iconColorPainting from '../assets/icon-color-painting.png';
import iconLineArt from '../assets/icon-line-art.png';
import iconQuietBook from '../assets/icon-quiet-book.png';
import iconAlbum from '../assets/icon-album.png';
import iconSettings from '../assets/icon-settings.png';

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
  icon: string;
}[] = [
  {
    mode: 'ai_create',
    titleZh: '变彩画',
    titleEn: 'COLOR PAINTING',
    icon: iconColorPainting,
  },
  {
    mode: 'coloring',
    titleZh: '变线稿',
    titleEn: 'LINE ART',
    icon: iconLineArt,
  },
  {
    mode: 'template',
    titleZh: '安静书',
    titleEn: 'QUIET BOOK',
    icon: iconQuietBook,
  },
  {
    mode: 'my_works',
    titleZh: '小相册',
    titleEn: 'MINI PHOTO ALBUM',
    icon: iconAlbum,
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
                  className="home-feature-card"
                  onClick={() => enterMode(card.mode)}
                >
                  <span className="home-feature-card__icon" aria-hidden>
                  <img src={card.icon} alt="" width="80" height="80" />
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
              <img src={iconSettings} alt="" width="28" height="28" />
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
                <img src={m.icon} alt="" width="32" height="32" />
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
