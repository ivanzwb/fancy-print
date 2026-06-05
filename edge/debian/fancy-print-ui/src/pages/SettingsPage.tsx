import React, { useState, useEffect, useCallback } from 'react';
import { useDaemon } from '../services/DaemonContext.js';
import { getSettings, updateSetting, factoryReset } from '../services/daemonClient.js';

interface Props {
  onBack: () => void;
}

const SettingsPage: React.FC<Props> = ({ onBack }) => {
  const [volume, setVolume] = useState(80);
  const [brightness, setBrightness] = useState(80);
  const [wifiSSID, setWifiSSID] = useState('FancyPrint_Network');
  const [loading, setLoading] = useState(true);
  const [deviceName, setDeviceName] = useState('奇想印印');

  const daemon = useDaemon();

  // 初始加载设置
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await getSettings(daemon);
        if (cancelled) return;
        setVolume(st.volumePercent);
        setBrightness(st.brightnessPercent);
        setWifiSSID(st.wifiSsid || 'FancyPrint_Network');
        setDeviceName(st.deviceName || '奇想印印');
      } catch (e) {
        console.error('load settings error:', e);
        // 使用默认值静默继续
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [daemon]);

  // 音量变化时持久化
  const handleVolumeChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setVolume(val);
    try {
      await updateSetting(daemon, 'volume_percent', String(val));
    } catch (err) {
      console.error('save volume error:', err);
    }
  }, [daemon]);

  // 亮度变化时持久化
  const handleBrightnessChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setBrightness(val);
    try {
      await updateSetting(daemon, 'brightness_percent', String(val));
    } catch (err) {
      console.error('save brightness error:', err);
    }
  }, [daemon]);

  // 恢复出厂设置
  const handleFactoryReset = useCallback(async () => {
    if (!confirm('确认恢复出厂设置？所有设置和 PIN 将被清除。')) return;
    try {
      const ok = await factoryReset(daemon);
      if (ok) {
        setVolume(80);
        setBrightness(80);
        setWifiSSID('FancyPrint_Network');
        setDeviceName('奇想印印');
      }
    } catch (err) {
      console.error('factory reset error:', err);
    }
  }, [daemon]);

  if (loading) {
    return (
      <div className="settings-page-loading">
        <p>加载设置...</p>
      </div>
    );
  }

  return (
    <>
      <header className="top-bar">
        <span className="device-name">{deviceName}</span>
        <span className="top-bar-center">设置</span>
        <span className="top-bar-right" />
      </header>

      <main className="settings-content">
        <div className="settings-list">
          {/* 音量 */}
          <div className="setting-item">
            <span className="setting-label">🔊 音量</span>
            <div className="setting-control">
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={handleVolumeChange}
                className="slider"
              />
              <span className="setting-value">{volume}%</span>
            </div>
          </div>

          {/* WiFi */}
          <div className="setting-item">
            <span className="setting-label">📶 WiFi</span>
            <div className="setting-control">
              <span className="setting-value">{wifiSSID}</span>
            </div>
          </div>

          {/* 亮度 */}
          <div className="setting-item">
            <span className="setting-label">☀️ 亮度</span>
            <div className="setting-control">
              <input type="range" min={10} max={100} value={brightness} onChange={handleBrightnessChange} className="slider" />
              <span className="setting-value">{brightness}%</span>
            </div>
          </div>

          {/* 设备信息 */}
          <div className="setting-item">
            <span className="setting-label">ℹ️ 设备信息</span>
            <div className="setting-control">
              <span className="setting-value">v0.1.0</span>
            </div>
          </div>

          {/* 恢复出厂 */}
          <div className="setting-item danger">
            <span className="setting-label">⚠️ 恢复出厂设置</span>
            <button className="danger-btn" onClick={handleFactoryReset}>
              重置
            </button>
          </div>
        </div>
      </main>

      <footer className="bottom-bar">
        <button className="action-btn primary" onClick={onBack}>
          返回首页
        </button>
      </footer>
    </>
  );
};

export default SettingsPage;
