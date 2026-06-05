import React, { useState, useCallback, useEffect, useRef } from 'react';
import { DaemonProvider, useDaemon } from './services/DaemonContext.js';
import HomePage from './pages/HomePage';
import GeneratePage from './pages/GeneratePage';
import PreviewPage from './pages/PreviewPage';
import ParentLockPage from './pages/ParentLockPage';
import SettingsPage from './pages/SettingsPage';
import SetupPage from './pages/SetupPage';

export type Page = 'setup' | 'home' | 'generating' | 'preview' | 'parent_lock' | 'settings';
export type ContentMode = 'ai_create' | 'coloring' | 'template' | 'my_works';

export interface AppState {
  currentPage: Page;
  contentMode: ContentMode;
  previewImageUrl: string | null;
  jobId: string | null;
  locked: boolean;
  statusMessage: string;
  setupComplete: boolean;
  daemonOnline: boolean;
  batteryPercent: number;
  jobErrorCode: number;
}

const STATUS_POLL_MS = 5000;

const AppInner: React.FC = () => {
  const daemon = useDaemon();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [state, setState] = useState<AppState>({
    currentPage: 'setup',
    contentMode: 'ai_create',
    previewImageUrl: null,
    jobId: null,
    locked: false,
    statusMessage: '按住 PTT 键说话',
    setupComplete: false,
    daemonOnline: false,
    batteryPercent: 0,
    jobErrorCode: 0,
  });

  // 每 5 秒轮询 daemon 状态
  useEffect(() => {
    const poll = async () => {
      try {
        const status = await daemon.getDeviceStatus();
        setState(prev => ({
          ...prev,
          daemonOnline: status.connection === 1,
          batteryPercent: status.batteryPercent,
        }));
      } catch {
        setState(prev => ({ ...prev, daemonOnline: false }));
      }
    };
    poll();
    pollingRef.current = setInterval(poll, STATUS_POLL_MS);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [daemon]);

  const navigateTo = useCallback((page: Page) => {
    setState(prev => ({ ...prev, currentPage: page }));
  }, []);

  const setContentMode = useCallback((mode: ContentMode) => {
    setState(prev => ({ ...prev, contentMode: mode }));
  }, []);

  // 录音完成 → 进入生成页，GeneratePage 负责 CreatePrintJob + 轮询预览
  const startGenerating = useCallback((_audioPath?: string) => {
    setState(prev => ({
      ...prev,
      currentPage: 'generating',
      statusMessage: '生成中...',
      jobId: null,
      previewImageUrl: null,
      jobErrorCode: 0,
    }));
  }, []);

  // 预览就绪 → 展示预览页
  const previewReady = useCallback((imageUrl: string, jobId: string) => {
    setState(prev => ({
      ...prev,
      currentPage: 'preview',
      previewImageUrl: imageUrl,
      jobId,
      statusMessage: '看看效果吧！',
    }));
  }, []);

  // 确认打印 → 调 daemon ConfirmPrint
  const confirmPrint = useCallback(async () => {
    if (!state.jobId) return;
    try {
      const result = await daemon.confirmPrint({ jobId: state.jobId, confirmed: true });
      const errMsg = result.success ? '' : daemon.errorCodeToMessage(result.errorCode);
      setState(prev => ({
        ...prev,
        currentPage: 'home',
        statusMessage: result.success ? '打印完成！' : (errMsg || '打印失败'),
        jobErrorCode: result.success ? 0 : result.errorCode,
      }));
    } catch (e) {
      setState(prev => ({
        ...prev,
        currentPage: 'home',
        statusMessage: '打印失败，请重试',
      }));
    }
  }, [daemon, state.jobId]);

  // 取消/放弃打印
  const cancelPrint = useCallback(async () => {
    if (state.jobId) {
      try {
        await daemon.cancelPrintJob({ jobId: state.jobId });
      } catch {
        // 忽略取消失败
      }
    }
    setState(prev => ({
      ...prev,
      currentPage: 'home',
      previewImageUrl: null,
      jobId: null,
      statusMessage: '已取消',
    }));
  }, [daemon, state.jobId]);

  const setupComplete = useCallback(() => {
    setState(prev => ({ ...prev, currentPage: 'home', setupComplete: true }));
  }, []);

  const unlockSuccess = useCallback(() => {
    setState(prev => ({ ...prev, locked: false, currentPage: 'settings' }));
  }, []);

  const renderPage = () => {
    switch (state.currentPage) {
      case 'setup':
        return <SetupPage onComplete={setupComplete} />;
      case 'home':
        return (
          <HomePage
            contentMode={state.contentMode}
            onModeChange={setContentMode}
            onStartRecording={startGenerating}
            statusMessage={state.statusMessage}
            daemonOnline={state.daemonOnline}
            batteryPercent={state.batteryPercent}
            onOpenSettings={() => navigateTo('parent_lock')}
          />
        );
      case 'generating':
        return (
          <GeneratePage
            contentMode={state.contentMode}
            onPreviewReady={previewReady}
            onCancel={cancelPrint}
          />
        );
      case 'preview':
        return (
          <PreviewPage
            imageUrl={state.previewImageUrl}
            onConfirm={confirmPrint}
            onCancel={cancelPrint}
          />
        );
      case 'parent_lock':
        return <ParentLockPage onSuccess={unlockSuccess} onCancel={() => navigateTo('home')} />;
      case 'settings':
        return <SettingsPage onBack={() => navigateTo('home')} />;
      default:
        return null;
    }
  };

  return <div className="app-container">{renderPage()}</div>;
};

const App: React.FC = () => {
  return (
    <DaemonProvider>
      <AppInner />
    </DaemonProvider>
  );
};

export default App;
