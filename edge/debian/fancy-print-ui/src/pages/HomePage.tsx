import React, { useCallback, useRef } from 'react';
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

const modeConfig: { mode: ContentMode; icon: string; label: string }[] = [
  { mode: 'ai_create', icon: '✨', label: 'AI 创作' },
  { mode: 'coloring', icon: '🎨', label: '涂色乐园' },
  { mode: 'template', icon: '📐', label: '趣味模板' },
  { mode: 'my_works', icon: '🖼️', label: '我的作品' },
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
  const currentMode = modeConfig.find(m => m.mode === contentMode);

  // PTT 按下 → 开始录音
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

  // PTT 松开 → 停止录音 → 进入生成
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

  return (
    <>
      {/* 顶栏 */}
      <header className="top-bar">
        <span className="device-name">奇想印印</span>
        <span className="top-bar-center">{currentMode?.label}</span>
        <span className="top-bar-right">
          <span className={`status-icon ${daemonOnline ? 'wifi' : 'wifi-off'}`} title={daemonOnline ? '已连接' : '离线'} />
          <span className="status-label">{batteryPercent > 0 ? `${batteryPercent}%` : ''}</span>
        </span>
      </header>

      {/* 主体 */}
      <main className="main-content">
        {/* 左侧：模式导航 */}
        <nav className="mode-nav">
          {modeConfig.map(m => (
            <button
              key={m.mode}
              className={`mode-btn ${contentMode === m.mode ? 'active' : ''}`}
              onClick={() => onModeChange(m.mode)}
            >
              <span className="mode-icon">{m.icon}</span>
              <span className="mode-label">{m.label}</span>
            </button>
          ))}
        </nav>

        {/* 中央 PTT 区域 */}
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
            <p className="ptt-hint-sub">选择模式 → 按住说话 → 生成打印</p>
          </div>
        </section>

        {/* 右侧工具栏 */}
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

      {/* 底栏 */}
      <footer className="bottom-bar">
        <button className="action-btn primary" disabled>
          {statusMessage}
        </button>
        <button className="action-btn secondary" onClick={onOpenSettings}>
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
  <button className={`tool-btn ${active ? 'active' : ''}`}>
    <span className="tool-icon">{icon}</span>
    <span className="tool-label">{label}</span>
  </button>
);

export default HomePage;
