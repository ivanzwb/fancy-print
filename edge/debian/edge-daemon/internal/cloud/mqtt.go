// Package cloud — MQTT 客户端
//
// Eclipse Paho MQTT 客户端，支持 QoS 1、自动重连、遗嘱消息。
// 对应 doc/4 §5 MQTT 约定

package cloud

import (
	"fmt"
	"log/slog"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"

	"github.com/fancy-print/edge-daemon/internal/types"
)

// MQTTMessage MQTT 消息
type MQTTMessage struct {
	Topic   string
	Payload []byte
}

// MQTTClient MQTT 客户端
type MQTTClient struct {
	brokerURL string
	clientID  string
	client    mqtt.Client
	msgCh     chan *MQTTMessage
	subTopics []string
}

// NewMQTTClient 创建 MQTT 客户端
func NewMQTTClient(brokerURL, clientID string) *MQTTClient {
	return &MQTTClient{
		brokerURL: brokerURL,
		clientID:  clientID,
		msgCh:     make(chan *MQTTMessage, 256),
	}
}

// Connect 连接 MQTT Broker 并订阅主题
func (m *MQTTClient) Connect() error {
	opts := mqtt.NewClientOptions().
		AddBroker(m.brokerURL).
		SetClientID(m.clientID).
		SetCleanSession(true).
		SetAutoReconnect(true).
		SetConnectRetry(true).
		SetConnectRetryInterval(10 * time.Second).
		SetMaxReconnectInterval(60 * time.Second).
		SetKeepAlive(60 * time.Second).
		SetPingTimeout(10 * time.Second).
		SetOrderMatters(false).
		SetDefaultPublishHandler(m.onMessage).
		SetConnectionLostHandler(m.onConnectionLost).
		SetOnConnectHandler(m.onConnected)

	// 遗嘱消息
	opts.SetWill(
		fmt.Sprintf("devices/%s/status", m.clientID),
		`{"online":false}`,
		1,
		false,
	)

	client := mqtt.NewClient(opts)
	token := client.Connect()
	if token.Wait() && token.Error() != nil {
		return fmt.Errorf("mqtt connect: %w", token.Error())
	}

	m.client = client
	return nil
}

// Disconnect 断开连接
func (m *MQTTClient) Disconnect() {
	if m.client != nil && m.client.IsConnected() {
		m.client.Disconnect(250)
	}
}

// IsConnected 返回 MQTT 是否已连接
func (m *MQTTClient) IsConnected() bool {
	return m.client != nil && m.client.IsConnected()
}

// Subscribe 返回消息 channel
func (m *MQTTClient) Subscribe() <-chan *MQTTMessage {
	// 订阅设备相关主题
	topics := []string{
		fmt.Sprintf("devices/%s/preview", m.clientID),
		fmt.Sprintf("devices/%s/ota", m.clientID),
		fmt.Sprintf("devices/%s/policy", m.clientID),
	}

	for _, topic := range topics {
		token := m.client.Subscribe(topic, 1, nil)
		token.Wait()
		if token.Error() != nil {
			slog.Warn("MQTT subscribe failed", "topic", topic, "error", token.Error())
		} else {
			slog.Info("MQTT subscribed", "topic", topic)
		}
	}

	return m.msgCh
}

// PublishTelemetry 发布设备遥测
func (m *MQTTClient) PublishTelemetry(deviceID string, status *types.DeviceStatus) error {
	if m.client == nil || !m.client.IsConnected() {
		return fmt.Errorf("MQTT not connected")
	}

	payload := fmt.Sprintf(
		`{"device_id":"%s","battery":%d,"storage_mb":%d,"queue_depth":%d,"audio_state":%d,"connection":%d}`,
		deviceID, status.BatteryPercent, status.StorageFreeMB,
		status.QueueDepth, status.AudioState, status.Connection,
	)

	topic := fmt.Sprintf("devices/%s/telemetry", deviceID)
	token := m.client.Publish(topic, 1, false, []byte(payload))
	token.Wait()
	return token.Error()
}

// ============================================================
// Handlers
// ============================================================

func (m *MQTTClient) onMessage(client mqtt.Client, msg mqtt.Message) {
	select {
	case m.msgCh <- &MQTTMessage{
		Topic:   msg.Topic(),
		Payload: msg.Payload(),
	}:
	default:
		slog.Warn("MQTT message channel full, dropping", "topic", msg.Topic())
	}
}

func (m *MQTTClient) onConnected(client mqtt.Client) {
	slog.Info("MQTT connected")

	// 发布上线遗嘱
	if m.clientID != "" {
		token := client.Publish(
			fmt.Sprintf("devices/%s/status", m.clientID),
			1, false,
			[]byte(`{"online":true}`),
		)
		go func() {
			token.Wait()
		}()
	}
}

func (m *MQTTClient) onConnectionLost(client mqtt.Client, err error) {
	slog.Warn("MQTT connection lost", "error", err)
}
