import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useDaemon } from '../services/DaemonContext.js';
import type { ContentMode } from '../App';

interface Props {
  contentMode: ContentMode;
  onPreviewReady: (imageUrl: string, jobId: string) => void;
  onCancel: () => void;
}

// 内容模式 → proto ContentMode 枚举值
function modeToEnum(mode: ContentMode): number {
  switch (mode) {
    case 'ai_create': return 1;
    case 'coloring': return 2;
    case 'template': return 3;
    case 'my_works': return 4;
    default: return 1;
  }
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 30; // 60s 超时

const GeneratePage: React.FC<Props> = ({ contentMode, onPreviewReady, onCancel }) => {
  const daemon = useDaemon();
  const jobIdRef = useRef<string | null>(null);
  const pollCountRef = useRef(0);
  const [message, setMessage] = useState('正在识别语音...');
  const [error, setError] = useState<string | null>(null);

  const pollPreview = useCallback(async (jobId: string) => {
    try {
      const preview = await daemon.getPreview(jobId);
      if (preview.imageUrl) {
        onPreviewReady(preview.imageUrl, jobId);
        return true;
      }
    } catch {
      // preview not ready yet
    }
    return false;
  }, [daemon, onPreviewReady]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setMessage('正在识别语音...');

      // 1. 创建打印任务
      let job;
      try {
        job = await daemon.createPrintJob({
          contentMode: modeToEnum(contentMode),
          previewImageUrl: '',
          copies: 1,
        });
      } catch (e) {
        if (!cancelled) {
          setError('创建任务失败，请重试');
        }
        return;
      }

      const jid = job.jobId;
      jobIdRef.current = jid;
      setMessage('任务已提交，正在创作...');
      pollCountRef.current = 0;

      // 2. 轮询预览
      const interval = setInterval(async () => {
        if (cancelled) return;
        pollCountRef.current++;

        setMessage(
          pollCountRef.current < 5 ? '正在创作...' :
          pollCountRef.current < 15 ? '画面渲染中...' :
          '即将完成！'
        );

        const ready = await pollPreview(jid);
        if (ready) {
          clearInterval(interval);
          return;
        }

        if (pollCountRef.current >= MAX_POLLS) {
          clearInterval(interval);
          if (!cancelled) {
            setMessage('生成超时，请重试');
          }
        }
      }, POLL_INTERVAL_MS);
    };

    run();

    return () => { cancelled = true; };
  }, [daemon, contentMode, pollPreview]);

  return (
    <div className="generate-page">
      <div className="generate-content">
        <div className="generate-spinner" />
        <p className="generate-message">{error || message}</p>
        {!error && (
          <div className="progress-bar-container">
            <div className="progress-bar indeterminate" />
          </div>
        )}
        <p className="generate-hint">{error ? '' : '请稍候，马上就好...'}</p>
      </div>
      {/* 底栏 */}
      <footer className="bottom-bar">
        <button className="action-btn secondary" onClick={onCancel}>
          {error ? '返回' : '取消'}
        </button>
      </footer>
    </div>
  );
};

export default GeneratePage;
