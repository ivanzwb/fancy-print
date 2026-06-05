// Package ipc — 模块接口定义
//
// 各模块（print, audio, gpio, cloud）实现这些接口，
// 由 EdgeDaemonService 组合调用。

package ipc

import (
	"github.com/fancy-print/edge-daemon/internal/types"
)

// PrintManager 打印队列管理器接口
type PrintManager interface {
	CreateJob(req *types.CreatePrintJobRequest) (*types.PrintJob, error)
	GetJob(jobID string) (*types.PrintJob, error)
	ListJobs(limit int, statusFilter types.PrintJobStatus) ([]*types.PrintJob, error)
	ConfirmPrint(jobID string, confirmed bool) (*types.PrintResult, error)
	CancelJob(jobID string) error
	WatchJobs() (<-chan *types.PrintJobEvent, error)
	UpdatePreviewURL(jobID, previewURL string) error
	AutoConfirmPending(jobID string) error
	QueueDepth() int32
	PrinterState() string
}

// AudioManager 音频管理器接口
type AudioManager interface {
	StartRecording() error
	StopRecording() (*types.RecordingResult, error)
	PlayAudio(path string, audioType string) error
	StopPlayback() error
	GetState() types.AudioState
}

// GPIOManager GPIO 管理器接口
type GPIOManager interface {
	Start() error
	Stop()
	SetLED(on bool) error
	PTTState() bool
	PTTEvent() <-chan bool
}

// CloudConnector 云连接器接口
type CloudConnector interface {
	Connect() error
	Disconnect()
	PublishTelemetry(status *types.DeviceStatus) error
	PublishTelemetryHTTPS(status *types.DeviceStatus) error
	CreateJob(contentMode types.ContentMode, audioPath string) (string, error)
	GetPreviewURL(jobID string) (string, error)
	ConnectionState() types.DeviceConnectionState
	WatchNotifications() (<-chan *types.CloudNotification, error)
}

// WiFiScanner WiFi 扫描器接口
type WiFiScanner interface {
	ScanNetworks() ([]types.WiFiNetwork, error)
}

// MockWiFiScanner 模拟 WiFi 扫描器（无实际硬件时使用）
type MockWiFiScanner struct{}

func (m *MockWiFiScanner) ScanNetworks() ([]types.WiFiNetwork, error) {
	return []types.WiFiNetwork{
		{SSID: "FancyPrint_Network", SignalStrength: 90, Secured: true},
		{SSID: "Home_WiFi_5G", SignalStrength: 80, Secured: true},
		{SSID: "访客网络", SignalStrength: 60, Secured: false},
		{SSID: "Xiaomi_ABCD", SignalStrength: 45, Secured: true},
		{SSID: "TP-LINK_1234", SignalStrength: 30, Secured: true},
	}, nil
}


