// SetupPage — 首次引导 / 联网页
//
// 开箱时展示：WiFi 选择 → 绑定码 → 完成
// 对应 doc/3 §2.3 功能列表「首次引导/联网」

import React, { useState, useCallback, useEffect } from 'react';
import { useDaemon } from '../services/DaemonContext.js';
import { updateSetting, listWiFiNetworks } from '../services/daemonClient.js';
import type { WiFiNetwork } from '../gen/edge_ipc_pb.js';

interface Props {
  onComplete: () => void;
}

type Step = 'wifi_select' | 'wifi_password' | 'connecting' | 'binding' | 'complete';

const SetupPage: React.FC<Props> = ({ onComplete }) => {
  const [step, setStep] = useState<Step>('wifi_select');
  const [networks, setNetworks] = useState<WiFiNetwork[]>([]);
  const [scanning, setScanning] = useState(true);
  const [selectedSSID, setSelectedSSID] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [bindingCode] = useState(() => {
    return Math.floor(100000 + Math.random() * 900000).toString();
  });

  const daemon = useDaemon();

  // 扫描 WiFi 网络
  useEffect(() => {
    (async () => {
      try {
        const nets = await listWiFiNetworks(daemon);
        setNetworks(nets);
      } catch {
        // 扫描失败时保持空列表
      } finally {
        setScanning(false);
      }
    })();
  }, [daemon]);

  // 选择 WiFi
  const handleSelectNetwork = useCallback((ssid: string, secured: boolean) => {
    setSelectedSSID(ssid);
    setError('');
    if (secured) {
      setStep('wifi_password');
    } else {
      // 开放网络直接连接
      connectToWiFi(ssid, '');
    }
  }, []);

  // 提交密码
  const handleSubmitPassword = useCallback(() => {
    if (!password.trim()) {
      setError('请输入 WiFi 密码');
      return;
    }
    connectToWiFi(selectedSSID, password);
  }, [selectedSSID, password]);

  // 连接 WiFi
  const connectToWiFi = useCallback(async (ssid: string, pwd: string) => {
    setStep('connecting');
    setError('');
    try {
      // 通过 daemon 保存 WiFi 设置
      await updateSetting(daemon, 'wifi_ssid', ssid);
      if (pwd) {
        await updateSetting(daemon, 'wifi_password', pwd);
      }
      // 模拟连接耗时
      await new Promise(resolve => setTimeout(resolve, 2000));
      setStep('binding');
    } catch (e) {
      console.error('WiFi connect error:', e);
      setError('连接失败，请重试');
      setStep('wifi_select');
    }
  }, [daemon]);

  // 完成设置
  const handleComplete = useCallback(async () => {
    setStep('complete');
    // 短暂展示完成状态后跳转
    setTimeout(() => {
      onComplete();
    }, 1500);
  }, [onComplete]);

  // === 渲染 WiFi 选择 ===
  if (step === 'wifi_select') {
    return (
      <div className="setup-page">
        <header className="top-bar">
          <span className="device-name">奇想印印</span>
          <span className="top-bar-center">初次设置</span>
          <span className="top-bar-right" />
        </header>

        <main className="setup-content">
          <div className="setup-welcome">
            <div className="setup-icon">📶</div>
            <h2>选择 WiFi 网络</h2>
            <p className="setup-hint">请选择一个 WiFi 网络以连接互联网</p>
          </div>

          <div className="wifi-list">
            {scanning ? (
              <div className="setup-welcome">
                <div className="setup-spinner" />
                <p className="setup-hint">正在扫描 WiFi 网络...</p>
              </div>
            ) : networks.length === 0 ? (
              <p className="setup-hint setup-error">未找到 WiFi 网络</p>
            ) : (networks.map(net => (
              <button
                key={net.ssid}
                className="wifi-item"
                onClick={() => handleSelectNetwork(net.ssid, net.secured)}
              >
                <span className="wifi-icon">
                  📶
                </span>
                <span className="wifi-name">{net.ssid}</span>
                <span className="wifi-lock">{net.secured ? '🔒' : '🔓'}</span>
                <span className="wifi-strength">{net.signalStrength}%</span>
              </button>
            )))}
          </div>

          {error && <p className="setup-error">{error}</p>}
        </main>
      </div>
    );
  }

  // === 渲染 WiFi 密码输入 ===
  if (step === 'wifi_password') {
    return (
      <div className="setup-page">
        <header className="top-bar">
          <span className="device-name">奇想印印</span>
          <span className="top-bar-center">输入密码</span>
          <span className="top-bar-right" />
        </header>

        <main className="setup-content">
          <div className="setup-welcome">
            <div className="setup-icon">🔒</div>
            <h2>{selectedSSID}</h2>
            <p className="setup-hint">请输入 WiFi 密码</p>
          </div>

          <div className="wifi-password-input">
            <div className="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleSubmitPassword()}
                placeholder="输入 WiFi 密码"
                className="setup-input"
                autoFocus
              />
              <button
                className="toggle-password"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
            {error && <p className="setup-error">{error}</p>}
          </div>

          <div className="setup-actions">
            <button className="action-btn primary" onClick={handleSubmitPassword}>
              连接
            </button>
            <button className="action-btn secondary" onClick={() => { setStep('wifi_select'); setError(''); }}>
              返回
            </button>
          </div>
        </main>
      </div>
    );
  }

  // === 渲染连接中 ===
  if (step === 'connecting') {
    return (
      <div className="setup-page">
        <main className="setup-content">
          <div className="setup-welcome">
            <div className="setup-spinner" />
            <h2>正在连接 WiFi...</h2>
            <p className="setup-hint">{selectedSSID}</p>
            {error && <p className="setup-error">{error}</p>}
          </div>
        </main>
      </div>
    );
  }

  // === 渲染绑定码 ===
  if (step === 'binding') {
    return (
      <div className="setup-page">
        <header className="top-bar">
          <span className="device-name">奇想印印</span>
          <span className="top-bar-center">绑定设备</span>
          <span className="top-bar-right" />
        </header>

        <main className="setup-content">
          <div className="setup-welcome">
            <div className="setup-icon">✅</div>
            <h2>WiFi 已连接</h2>
            <p className="setup-hint">
              请在家长端 App 中输入下方绑定码完成配对
            </p>
          </div>

          <div className="binding-code-container">
            <div className="binding-code-label">绑定码</div>
            <div className="binding-code">
              {bindingCode.split('').map((d, i) => (
                <span key={i} className="binding-digit">{d}</span>
              ))}
            </div>
            <p className="binding-hint">绑定码 10 分钟内有效</p>
          </div>

          <div className="setup-actions">
            <button className="action-btn primary" onClick={handleComplete}>
              完成设置
            </button>
          </div>
        </main>
      </div>
    );
  }

  // === 渲染完成 ===
  return (
    <div className="setup-page">
      <main className="setup-content">
        <div className="setup-welcome">
          <div className="setup-icon">🎉</div>
          <h2>设置完成！</h2>
          <p className="setup-hint">正在进入主界面...</p>
        </div>
      </main>
    </div>
  );
};

export default SetupPage;
