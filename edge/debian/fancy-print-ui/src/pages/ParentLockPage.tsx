import React, { useState, useCallback } from 'react';
import { useDaemon } from '../services/DaemonContext.js';
import { validatePin, getParentLockStatus } from '../services/daemonClient.js';

interface Props {
  onSuccess: () => void;
  onCancel: () => void;
}

const ParentLockPage: React.FC<Props> = ({ onSuccess, onCancel }) => {
  const [pin, setPin] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [loading, setLoading] = useState(false);
  const maxAttempts = 5;

  const daemon = useDaemon();

  const handleDigit = useCallback(async (d: string) => {
    if (pin.length >= 4 || loading) return;
    const newPin = [...pin, d];
    setPin(newPin);

    if (newPin.length === 4) {
      const entered = newPin.join('');
      setLoading(true);
      try {
        // 检查家长锁状态（是否已锁定）
        const st = await getParentLockStatus(daemon);
        if (st.lockoutActive) {
          setError('尝试次数过多，请稍后再试');
          setPin([]);
          setLoading(false);
          return;
        }

        // 通过 daemon 验证 PIN
        const result = await validatePin(daemon, entered);
        if (result.valid) {
          onSuccess();
        } else {
          setPin([]);
          const newAttempts = attempts + 1;
          setAttempts(newAttempts);
          setLoading(false);
          if (st.lockoutActive || newAttempts >= maxAttempts) {
            setError('尝试次数过多，请稍后再试');
          } else {
            setError(`PIN 错误，还剩 ${maxAttempts - newAttempts} 次机会`);
          }
        }
      } catch (e) {
        console.error('validatePin error:', e);
        setError('验证失败，请重试');
        setPin([]);
        setLoading(false);
      }
    }
  }, [pin, loading, attempts, daemon, onSuccess]);

  const handleDelete = useCallback(() => {
    setPin(prev => prev.slice(0, -1));
    setError('');
  }, []);

  const handleClear = useCallback(() => {
    setPin([]);
    setError('');
  }, []);

  const dots = [0, 1, 2, 3].map(i => (
    <span key={i} className={`pin-dot ${pin.length > i ? 'filled' : ''}`} />
  ));

  const keys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['清除', '0', '⌫'],
  ];

  return (
    <div className="parent-lock-page">
      <div className="lock-container">
        <div className="lock-icon">🔒</div>
        <h2 className="lock-title">家长锁</h2>
        <p className="lock-hint">请输入 PIN 码进入设置</p>

        <div className="pin-dots">{dots}</div>

        {error && <p className="lock-error">{error}</p>}
        {loading && <p className="lock-loading">验证中...</p>}

        <div className="pin-pad">
          {keys.map((row, i) => (
            <div key={i} className="pin-row">
              {row.map(key => (
                <button
                  key={key}
                  className="pin-key"
                  onClick={() => {
                    if (key === '清除') {
                      handleClear();
                    } else if (key === '⌫') {
                      handleDelete();
                    } else {
                      handleDigit(key);
                    }
                  }}
                  disabled={loading || attempts >= maxAttempts}
                >
                  {key}
                </button>
              ))}
            </div>
          ))}
        </div>

        <button className="lock-cancel" onClick={onCancel} disabled={loading}>
          返回
        </button>
      </div>
    </div>
  );
};

export default ParentLockPage;
