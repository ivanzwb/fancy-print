import React, { useState } from 'react';

interface Props {
  imageUrl: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const PreviewPage: React.FC<Props> = ({ imageUrl, onConfirm, onCancel }) => {
  const [confirming, setConfirming] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  const handleConfirm = async () => {
    setConfirming(true);
    setErrMsg('');
    try {
      await onConfirm();
    } catch {
      setErrMsg('打印失败，请重试');
      setConfirming(false);
    }
  };

  const handleCancel = () => {
    if (confirming) return;
    onCancel();
  };

  return (
    <>
      {/* 顶栏 */}
      <header className="top-bar">
        <span className="device-name">奇想印印</span>
        <span className="top-bar-center">确认打印</span>
        <span className="top-bar-right" />
      </header>

      {/* 预览主体 */}
      <main className="main-content">
        <section className="preview-area full-preview">
          {imageUrl ? (
            <div className="preview-image-container">
              <div className="preview-frame">
                <img
                  src={imageUrl}
                  alt="A5 预览图"
                  className="preview-image"
                  onError={() => setErrMsg('图片加载失败')}
                />
              </div>
              <p className="preview-size-hint">A5 尺寸 · ZINK 纸</p>
            </div>
          ) : (
            <div className="preview-placeholder">
              <p>暂无预览</p>
            </div>
          )}
        </section>

        {/* 右侧：操作说明 */}
        <aside className="toolbar preview-toolbar">
          <p className="toolbar-title">预览</p>
          <div className="preview-info">
            <p>📄 A5 幅面</p>
            <p>🎨 全彩 ZINK</p>
            <p>⚡ 约 30 秒</p>
          </div>
        </aside>
      </main>

      {/* 底栏 */}
      <footer className="bottom-bar">
        {errMsg && <p className="preview-error">{errMsg}</p>}
        <button
          className="action-btn confirm"
          onClick={handleConfirm}
          disabled={confirming}
        >
          {confirming ? '打印中...' : '✅ 确认打印'}
        </button>
        <button
          className="action-btn cancel"
          onClick={handleCancel}
          disabled={confirming}
        >
          ❌ 重新制作
        </button>
      </footer>
    </>
  );
};

export default PreviewPage;
