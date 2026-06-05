// Package cloud — 云连接器
//
// 组合 MQTT + HTTPS 客户端，实现 CloudConnector 接口。
// 对应 doc/4 §2.4 端云边界、doc/3 §2.1 进程模型
//
// 职责：
// - MQTT：遥测上报、任务状态通知订阅
// - HTTPS：创建 Job、获取预览、上传音频
// - 令牌生命周期管理
// - 自动重连与背压

package cloud

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/fancy-print/edge-daemon/internal/types"
)

// Connector 云连接器（CloudConnector 接口实现）
type Connector struct {
	cfg       *Config
	mqtt      *MQTTClient
	api       *APIClient
	connState types.DeviceConnectionState
	stateMu   sync.RWMutex
	notifCh   chan *types.CloudNotification
	stopCh    chan struct{}
	wg        sync.WaitGroup

	notifSubs   map[int64]chan *types.CloudNotification
	notifSubsMu sync.Mutex
	notifSubID  int64
}

// Config 云连接器配置
type Config struct {
	MQTTBrokerURL string // MQTT 代理地址
	MQTTClientID  string // MQTT 客户端 ID
	APIBaseURL    string // HTTPS API 基础 URL
	TokenPath     string // 设备令牌文件路径
	DeviceID      string // 设备 ID
}

// NewConnector 创建云连接器
func NewConnector(cfg *Config) *Connector {
	mqttClient := NewMQTTClient(cfg.MQTTBrokerURL, cfg.MQTTClientID)
	apiClient := NewAPIClient(cfg.APIBaseURL, cfg.TokenPath, cfg.DeviceID)

	return &Connector{
		cfg:       cfg,
		mqtt:      mqttClient,
		api:       apiClient,
		connState: types.DeviceConnectionOffline,
		notifCh:   make(chan *types.CloudNotification, 64),
		stopCh:    make(chan struct{}),
		notifSubs: make(map[int64]chan *types.CloudNotification),
	}
}

// Connect 建立云连接（MQTT + 令牌加载）
func (c *Connector) Connect() error {
	slog.Info("connecting to cloud", "mqtt", c.cfg.MQTTBrokerURL, "api", c.cfg.APIBaseURL)

	// 加载设备令牌
	tokenLoaded := true
	if err := c.api.LoadToken(); err != nil {
		slog.Warn("token not available, continuing with HTTP auth retry", "error", err)
		tokenLoaded = false
	}

	// 连接 MQTT
	mqttConnected := true
	if err := c.mqtt.Connect(); err != nil {
		slog.Warn("mqtt connect failed, falling back to HTTPS-only", "error", err)
		mqttConnected = false
	}

	if mqttConnected {
		c.setState(types.DeviceConnectionOnline)
		slog.Info("cloud connected (MQTT + HTTPS)")

		// 订阅云端通知（MQTT → notifCh）
		go c.handleMessages()
		// 通知分发（notifCh → 所有 subscriber）
		go c.fanOutNotifications()
	} else if tokenLoaded {
		c.setState(types.DeviceConnectionWeak)
		slog.Warn("cloud connected (HTTPS only, MQTT unavailable)")
	} else {
		c.setState(types.DeviceConnectionOffline)
	}

	// MQTT 连接状态监控（自动更新 Weak ↔ Online）
	go c.connectionMonitor()
	// 定期刷新令牌
	go c.tokenRefreshLoop()

	return nil
}

// Disconnect 断开云连接
func (c *Connector) Disconnect() {
	slog.Info("disconnecting cloud")
	close(c.stopCh)
	c.mqtt.Disconnect()
	// 关闭所有 subscriber channel
	c.notifSubsMu.Lock()
	for id, ch := range c.notifSubs {
		close(ch)
		delete(c.notifSubs, id)
	}
	c.notifSubsMu.Unlock()
	c.wg.Wait()
}

// PublishTelemetry 发布设备遥测（MQTT）
func (c *Connector) PublishTelemetry(status *types.DeviceStatus) error {
	return c.mqtt.PublishTelemetry(c.cfg.DeviceID, status)
}

// PublishTelemetryHTTPS 通过 HTTPS 上报遥测（MQTT 断开时的兜底）
func (c *Connector) PublishTelemetryHTTPS(status *types.DeviceStatus) error {
	return c.api.PublishTelemetryHTTPS(c.cfg.DeviceID, status)
}

// CreateJob 创建云端任务（上传音频 → 获取 job_id）
func (c *Connector) CreateJob(contentMode types.ContentMode, audioPath string) (string, error) {
	return c.api.CreateJob(c.cfg.DeviceID, contentMode, audioPath)
}

// GetPreviewURL 获取预览 URL
func (c *Connector) GetPreviewURL(jobID string) (string, error) {
	return c.api.GetPreviewURL(c.cfg.DeviceID, jobID)
}

// ConnectionState 返回当前连接状态
func (c *Connector) ConnectionState() types.DeviceConnectionState {
	c.stateMu.RLock()
	defer c.stateMu.RUnlock()
	return c.connState
}

// WatchNotifications 注册一个新的通知订阅，每次调用返回独立的 channel
func (c *Connector) WatchNotifications() (<-chan *types.CloudNotification, error) {
	c.notifSubsMu.Lock()
	defer c.notifSubsMu.Unlock()

	c.notifSubID++
	ch := make(chan *types.CloudNotification, 8)
	c.notifSubs[c.notifSubID] = ch
	slog.Debug("notification subscriber registered", "id", c.notifSubID)
	return ch, nil
}

// ============================================================
// 内部方法
// ============================================================

func (c *Connector) setState(state types.DeviceConnectionState) {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	c.connState = state
}

// fanOutNotifications 从 notifCh 读取通知并广播到所有 subscriber
func (c *Connector) fanOutNotifications() {
	c.wg.Add(1)
	defer c.wg.Done()

	for {
		select {
		case <-c.stopCh:
			return
		case n, ok := <-c.notifCh:
			if !ok {
				return
			}
			c.notifSubsMu.Lock()
			for id, ch := range c.notifSubs {
				select {
				case ch <- n:
				default:
					// subscriber 消费过慢，移除
					slog.Warn("notification subscriber slow, removing", "id", id)
					close(ch)
					delete(c.notifSubs, id)
				}
			}
			c.notifSubsMu.Unlock()
		}
	}
}

func (c *Connector) handleMessages() {
	c.wg.Add(1)
	defer c.wg.Done()

	msgCh := c.mqtt.Subscribe()
	for msg := range msgCh {
		select {
		case <-c.stopCh:
			return
		default:
		}

		slog.Debug("MQTT message received", "topic", msg.Topic)

		notif := &types.CloudNotification{
			Type:    msg.Topic,
			Payload: string(msg.Payload),
		}

		switch {
		case msg.Topic == fmt.Sprintf("devices/%s/preview", c.cfg.DeviceID):
			notif.Type = "preview_ready"
			// 解析 payload 中的 job_id
			var previewMsg struct {
				JobID    string `json:"job_id"`
				ImageURL string `json:"image_url"`
			}
			if err := json.Unmarshal(msg.Payload, &previewMsg); err == nil {
				notif.JobID = previewMsg.JobID
				notif.Payload = previewMsg.ImageURL // 复用 Payload 字段传递 image_url
			}
		case msg.Topic == fmt.Sprintf("devices/%s/ota", c.cfg.DeviceID):
			notif.Type = "ota_available"
		case msg.Topic == fmt.Sprintf("devices/%s/policy", c.cfg.DeviceID):
			notif.Type = "policy_update"
		}

		select {
		case c.notifCh <- notif:
		default:
			slog.Warn("notification channel full, dropping", "type", notif.Type)
		}
	}
}

// connectionMonitor 监测 MQTT 连接状态，自动更新 connState
func (c *Connector) connectionMonitor() {
	c.wg.Add(1)
	defer c.wg.Done()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-c.stopCh:
			return
		case <-ticker.C:
			mqttOnline := c.mqtt != nil && c.mqtt.IsConnected()
			// 如果 MQTT 恢复连接而状态是 Weak，切回 Online
			if mqttOnline && c.ConnectionState() != types.DeviceConnectionOnline {
				slog.Info("MQTT reconnected, restoring full connectivity")
				c.setState(types.DeviceConnectionOnline)
			}
			// 如果 MQTT 断连而状态是 Online，切回 Weak（API 仍可用）
			if !mqttOnline && c.ConnectionState() == types.DeviceConnectionOnline {
				slog.Warn("MQTT disconnected, falling back to HTTPS-only")
				c.setState(types.DeviceConnectionWeak)
			}
		}
	}
}

func (c *Connector) tokenRefreshLoop() {
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-c.stopCh:
			return
		case <-ticker.C:
			if err := c.api.RefreshToken(); err != nil {
				slog.Warn("token refresh failed", "error", err)
			}
		}
	}
}
