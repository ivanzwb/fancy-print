// Package types — IPC 共享类型
//
// 端侧各模块间共用的枚举与消息结构，
// 同时是 contracts/proto/edge_ipc.proto 的 Go 侧本地等价物。
// 独立包以消除 ipc ↔ audio / print / cloud / storage 间的包循环。
//
// 当 proto 生成代码移入 edgepb 独立包后，
// 此包仍保留作为内部模块间通信的领域类型。

package types

import "time"

// ============================================================
// 枚举
// ============================================================

type ContentMode int32

const (
	ContentModeUnspecified ContentMode = 0
	ContentModeAICreate    ContentMode = 1
	ContentModeColoring    ContentMode = 2
	ContentModeTemplate    ContentMode = 3
	ContentModeMyWorks     ContentMode = 4
)

func (m ContentMode) String() string {
	switch m {
	case ContentModeAICreate:
		return "ai_create"
	case ContentModeColoring:
		return "coloring"
	case ContentModeTemplate:
		return "template"
	case ContentModeMyWorks:
		return "my_works"
	default:
		return "unknown"
	}
}

type PrintJobStatus int32

const (
	PrintJobStatusUnspecified    PrintJobStatus = 0
	PrintJobStatusQueued         PrintJobStatus = 1
	PrintJobStatusPrinting       PrintJobStatus = 2
	PrintJobStatusCompleted      PrintJobStatus = 3
	PrintJobStatusFailed         PrintJobStatus = 4
	PrintJobStatusCancelled      PrintJobStatus = 5
	PrintJobStatusPendingConfirm PrintJobStatus = 6
)

type ErrorCode int32

const (
	ErrorCodeNone           ErrorCode = 0
	ErrorCodeNetwork        ErrorCode = 1
	ErrorCodeAuditReject    ErrorCode = 2
	ErrorCodePaperJam       ErrorCode = 3
	ErrorCodeOutOfPaper     ErrorCode = 4
	ErrorCodeOverheat       ErrorCode = 5
	ErrorCodePrinterBusy    ErrorCode = 6
	ErrorCodeInternal       ErrorCode = 7
	ErrorCodeNoAudio        ErrorCode = 8
	ErrorCodeTimeout        ErrorCode = 9
	ErrorCodeCancelled      ErrorCode = 10
)

type DeviceConnectionState int32

const (
	DeviceConnectionUnspecified DeviceConnectionState = 0
	DeviceConnectionOnline      DeviceConnectionState = 1
	DeviceConnectionOffline     DeviceConnectionState = 2
	DeviceConnectionWeak        DeviceConnectionState = 3
)

type AudioState int32

const (
	AudioStateIdle      AudioState = 0
	AudioStateRecording AudioState = 1
	AudioStatePlaying   AudioState = 2
)

// ============================================================
// 消息结构
// ============================================================

type DeviceInfo struct {
	DeviceID        string
	FirmwareVersion string
	HardwareModel   string
	UptimeSeconds   int64
	OSVersion       string
	BatteryPercent  int32
	StorageFreeMB   int32
}

type DeviceStatus struct {
	Connection       DeviceConnectionState
	BatteryPercent   int32
	StorageFreeMB    int32
	PrinterState     string
	QueueDepth       int32
	AudioState       AudioState
	ParentLockActive bool
	TemperatureC     int64
}

type PrintJob struct {
	JobID            string
	ContentMode      ContentMode
	Status           PrintJobStatus
	ErrorCode        ErrorCode
	ErrorMessage     string
	PreviewImageURL  string
	CloudJobID       string // 关联的云端任务 ID
	Copies           int32
	CreatedAtUnix    int64
	CompletedAtUnix  int64
	AutoConfirm      bool // PTT 等无 UI 确认流程的任务，预览就绪后自动入队列
}

type PrintJobEvent struct {
	JobID     string
	OldStatus PrintJobStatus
	NewStatus PrintJobStatus
	ErrorCode ErrorCode
}

type CreatePrintJobRequest struct {
	ContentMode     ContentMode
	PreviewImageURL string
	PreviewData     []byte
	Copies          int32
	AutoConfirm     bool // PTT=true, UI=false
}

type PrintResult struct {
	Success      bool
	JobID        string
	ErrorCode    ErrorCode
	ErrorMessage string
}

type RecordingResult struct {
	AudioPath  string
	DurationMs int32
	SampleRate int32
}

type PreviewData struct {
	JobID     string
	ImageURL  string
	Thumbnail []byte
	WidthPx   int32
	HeightPx  int32
}

type PreviewNotification struct {
	JobID     string
	ImageURL  string
	Ready     bool
	ErrorCode ErrorCode
}

type ParentLockStatus struct {
	Locked            bool
	PinSet            bool
	RemainingAttempts int32
	LockoutActive     bool
}

type Settings struct {
	WifiEnabled       bool
	WifiSSID          string
	WifiPassword      string
	VolumePercent     int32
	BrightnessPercent int32
	DefaultMode       ContentMode
	DeviceName        string
}

// DeviceConfig 设备基础配置
type DeviceConfig struct {
	DeviceName        string
	VolumePercent     int32
	BrightnessPercent int32
	DefaultMode       ContentMode
	WifiSSID          string
}

// StorageManager 持久化存储接口
type StorageManager interface {
	SavePrintJob(job *PrintJob) error
	UpdatePrintJobStatus(jobID string, status PrintJobStatus, errorCode ErrorCode, errMsg string) error
	UpdatePrintJobPreview(jobID, previewURL string) error
	LoadAllPrintJobs() ([]*PrintJob, error)
	SaveParentLockStatus(st *ParentLockStatus) error
	LoadParentLockStatus() (*ParentLockStatus, error)
	SaveDeviceConfig(cfg *DeviceConfig) error
	LoadDeviceConfig() (*DeviceConfig, error)
	SavePIN(pin string) error
	LoadPIN() (string, error)
	VerifyPIN(pin string) (bool, error)
	SaveSettings(st *Settings) error
	LoadSettings() (*Settings, error)
	Cleanup(jobMaxAge, audioMaxAge time.Duration) error
	Close() error
}

type WiFiNetwork struct {
	SSID           string
	SignalStrength int32 // 0-100
	Secured        bool
}

type CloudNotification struct {
	Type    string // "preview_ready", "policy_update", "ota_available"
	JobID   string
	Payload string // JSON
}
