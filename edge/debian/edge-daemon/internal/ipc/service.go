// Package ipc — EdgeDaemonService 实现
//
// 组合各模块接口，提供 gRPC 服务端业务逻辑。
// 每个 handler 是薄委托层，业务逻辑在各模块内部。

package ipc

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/fancy-print/edge-daemon/internal/edgepb"
	"github.com/fancy-print/edge-daemon/internal/types"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// EdgeDaemonService 实现 edgepb.EdgeDaemonServiceServer gRPC 服务
type EdgeDaemonService struct {
	edgepb.UnimplementedEdgeDaemonServiceServer

	cfg           *ConfigAdapter
	printMgr      PrintManager
	audioMgr      AudioManager
	gpioMgr       GPIOManager
	cloudConn     CloudConnector
	storage       types.StorageManager
	wifiScanner   WiFiScanner

	startTime      time.Time
	deviceID       string
	mu             sync.RWMutex
	statusSubs     map[string]chan *types.DeviceStatus
	prevAudioSt    types.AudioState

	lastAudioPath   string        // UI 触发录音的最后路径
	lastAudioPathMu sync.Mutex

	cloudJobIDs   map[string]string // localJobID → cloudJobID
	cloudJobIDsMu sync.RWMutex
}

// ConfigAdapter 适配 config.Config 为 service 需要的字段
type ConfigAdapter struct {
	DeviceID      string
	DeviceName    string
	HardwareModel string
	OSVersion     string
	DataDir       string
}

// NewEdgeDaemonService 创建服务实例
func NewEdgeDaemonService(
	cfg *ConfigAdapter,
	printMgr PrintManager,
	audioMgr AudioManager,
	gpioMgr GPIOManager,
	cloudConn CloudConnector,
	storage types.StorageManager,
	wifiScanner WiFiScanner,
) *EdgeDaemonService {
	return &EdgeDaemonService{
		cfg:         cfg,
		printMgr:    printMgr,
		audioMgr:    audioMgr,
		gpioMgr:     gpioMgr,
		cloudConn:   cloudConn,
		storage:     storage,
		wifiScanner: wifiScanner,
		startTime:   time.Now(),
		deviceID:    cfg.DeviceID,
		statusSubs:  make(map[string]chan *types.DeviceStatus),
		cloudJobIDs: make(map[string]string),
	}
}

// Start 启动服务（连接云、GPIO 监听等）
func (s *EdgeDaemonService) Start() error {
	slog.Info("starting edge-daemon service")

	if s.gpioMgr != nil {
		if err := s.gpioMgr.Start(); err != nil {
			return fmt.Errorf("gpio start: %w", err)
		}
		go s.handlePTT()
	}

	if s.cloudConn != nil {
		if err := s.cloudConn.Connect(); err != nil {
			slog.Warn("cloud connect failed (will retry)", "error", err)
		}
		go s.handleCloudNotifications()
	}

	go s.broadcastStatus()

	return nil
}

// Stop 停止服务
func (s *EdgeDaemonService) Stop() {
	slog.Info("stopping edge-daemon service")

	if s.gpioMgr != nil {
		s.gpioMgr.Stop()
	}
	if s.cloudConn != nil {
		s.cloudConn.Disconnect()
	}
}

// ============================================================
// 辅助 — 内部类型 ↔  gRPC 类型转换
// ============================================================

func ipcToEdgepbDeviceInfo(d *types.DeviceInfo) *edgepb.DeviceInfo {
	if d == nil {
		return nil
	}
	return &edgepb.DeviceInfo{
		DeviceId:        d.DeviceID,
		FirmwareVersion: d.FirmwareVersion,
		HardwareModel:   d.HardwareModel,
		UptimeSeconds:   d.UptimeSeconds,
		OsVersion:       d.OSVersion,
		BatteryPercent:  d.BatteryPercent,
		StorageFreeMb:   d.StorageFreeMB,
	}
}

func edgepbToIpcCreateJobReq(r *edgepb.CreatePrintJobRequest) *types.CreatePrintJobRequest {
	return &types.CreatePrintJobRequest{
		ContentMode:     types.ContentMode(r.GetContentMode()),
		PreviewImageURL: r.GetPreviewImageUrl(),
		PreviewData:     r.GetPreviewImageData(),
		Copies:          r.GetCopies(),
	}
}

func ipcToEdgepbPrintJob(j *types.PrintJob) *edgepb.PrintJob {
	if j == nil {
		return nil
	}
	return &edgepb.PrintJob{
		JobId:           j.JobID,
		ContentMode:     edgepb.ContentMode(j.ContentMode),
		Status:          edgepb.PrintJobStatus(j.Status),
		ErrorCode:       edgepb.ErrorCode(j.ErrorCode),
		ErrorMessage:    j.ErrorMessage,
		PreviewImageUrl: j.PreviewImageURL,
		Copies:          j.Copies,
		CreatedAtUnix:   j.CreatedAtUnix,
		CompletedAtUnix: j.CompletedAtUnix,
	}
}

func ipcToEdgepbPrintResult(r *types.PrintResult) *edgepb.PrintResult {
	if r == nil {
		return nil
	}
	return &edgepb.PrintResult{
		Success:      r.Success,
		JobId:        r.JobID,
		ErrorCode:    edgepb.ErrorCode(r.ErrorCode),
		ErrorMessage: r.ErrorMessage,
	}
}

func ipcToEdgepbRecordingResult(r *types.RecordingResult) *edgepb.RecordingResult {
	if r == nil {
		return nil
	}
	return &edgepb.RecordingResult{
		AudioPath:  r.AudioPath,
		DurationMs: r.DurationMs,
		SampleRate: r.SampleRate,
	}
}

func ipcToEdgepbWiFiNetworks(nets []types.WiFiNetwork) []*edgepb.WiFiNetwork {
	pb := make([]*edgepb.WiFiNetwork, len(nets))
	for i, n := range nets {
		pb[i] = &edgepb.WiFiNetwork{
			Ssid:           n.SSID,
			SignalStrength: n.SignalStrength,
			Secured:        n.Secured,
		}
	}
	return pb
}

func ipcToEdgepbPreviewData(d *types.PreviewData) *edgepb.PreviewData {
	if d == nil {
		return nil
	}
	return &edgepb.PreviewData{
		JobId:     d.JobID,
		ImageUrl:  d.ImageURL,
		Thumbnail: d.Thumbnail,
		WidthPx:   d.WidthPx,
		HeightPx:  d.HeightPx,
	}
}

func ipcToEdgepbParentLockStatus(st *types.ParentLockStatus) *edgepb.ParentLockStatus {
	if st == nil {
		return nil
	}
	return &edgepb.ParentLockStatus{
		Locked:            st.Locked,
		PinSet:            st.PinSet,
		RemainingAttempts: st.RemainingAttempts,
		LockoutActive:     st.LockoutActive,
	}
}

func ipcToEdgepbSettings(st *types.Settings) *edgepb.Settings {
	if st == nil {
		return nil
	}
	return &edgepb.Settings{
		WifiEnabled:       st.WifiEnabled,
		WifiSsid:          st.WifiSSID,
		VolumePercent:     st.VolumePercent,
		BrightnessPercent: st.BrightnessPercent,
		DefaultMode:       edgepb.ContentMode(st.DefaultMode),
		DeviceName:        st.DeviceName,
	}
}

func ipcToEdgepbDeviceStatus(st *types.DeviceStatus) *edgepb.DeviceStatus {
	if st == nil {
		return nil
	}
	return &edgepb.DeviceStatus{
		Connection:         edgepb.DeviceConnectionState(st.Connection),
		BatteryPercent:     st.BatteryPercent,
		StorageFreeMb:      st.StorageFreeMB,
		PrinterState:       st.PrinterState,
		QueueDepth:         st.QueueDepth,
		AudioState:         edgepb.AudioState(st.AudioState),
		ParentLockActive:   st.ParentLockActive,
		TemperatureCelsius: st.TemperatureC,
	}
}

// ============================================================
// 设备信息
// ============================================================

func (s *EdgeDaemonService) GetDeviceInfo(ctx context.Context, req *edgepb.GetDeviceInfoRequest) (*edgepb.DeviceInfo, error) {
	di := &types.DeviceInfo{
		DeviceID:        s.deviceID,
		FirmwareVersion: "0.1.0",
		HardwareModel:   s.cfg.HardwareModel,
		UptimeSeconds:   int64(time.Since(s.startTime).Seconds()),
		OSVersion:       s.cfg.OSVersion,
		BatteryPercent:  readBatteryPercent(),
	}
	return ipcToEdgepbDeviceInfo(di), nil
}

func (s *EdgeDaemonService) WatchDeviceStatus(req *edgepb.WatchDeviceStatusRequest, stream edgepb.EdgeDaemonService_WatchDeviceStatusServer) error {
	subID := fmt.Sprintf("watch-%d", time.Now().UnixNano())
	ch := s.SubscribeStatus(subID)
	defer s.UnsubscribeStatus(subID)

	for {
		select {
		case st, ok := <-ch:
			if !ok {
				return nil
			}
			if err := stream.Send(ipcToEdgepbDeviceStatus(st)); err != nil {
				return err
			}
		case <-stream.Context().Done():
			return stream.Context().Err()
		}
	}
}

// ============================================================
// 打印
// ============================================================

func (s *EdgeDaemonService) CreatePrintJob(ctx context.Context, req *edgepb.CreatePrintJobRequest) (*edgepb.PrintJob, error) {
	if s.printMgr == nil {
		return nil, status.Error(codes.Unavailable, "print manager not available")
	}
	job, err := s.printMgr.CreateJob(edgepbToIpcCreateJobReq(req))
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	// 如果有待处理的录音，上传云端并记录 cloud_job_id
	s.lastAudioPathMu.Lock()
	audioPath := s.lastAudioPath
	s.lastAudioPath = ""
	s.lastAudioPathMu.Unlock()

	if audioPath != "" && s.cloudConn != nil {
		go func(localJobID string, mode types.ContentMode, path string) {
			cloudJobID, err := s.cloudConn.CreateJob(mode, path)
			if err != nil {
				slog.Error("cloud create job (from UI recording)", "error", err)
				return
			}
			slog.Info("cloud job created from UI recording", "local_job", localJobID, "cloud_job", cloudJobID)
			s.cloudJobIDsMu.Lock()
			s.cloudJobIDs[localJobID] = cloudJobID
			s.cloudJobIDsMu.Unlock()
		}(job.JobID, job.ContentMode, audioPath)
	}

	return ipcToEdgepbPrintJob(job), nil
}

func (s *EdgeDaemonService) GetPrintJob(ctx context.Context, req *edgepb.GetPrintJobRequest) (*edgepb.PrintJob, error) {
	if s.printMgr == nil {
		return nil, status.Error(codes.Unavailable, "print manager not available")
	}
	job, err := s.printMgr.GetJob(req.GetJobId())
	if err != nil {
		return nil, status.Error(codes.NotFound, err.Error())
	}
	return ipcToEdgepbPrintJob(job), nil
}

func (s *EdgeDaemonService) ListPrintJobs(ctx context.Context, req *edgepb.ListPrintJobsRequest) (*edgepb.ListPrintJobsResponse, error) {
	if s.printMgr == nil {
		return nil, status.Error(codes.Unavailable, "print manager not available")
	}
	jobs, err := s.printMgr.ListJobs(int(req.GetLimit()), types.PrintJobStatus(req.GetStatusFilter()))
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	pbJobs := make([]*edgepb.PrintJob, 0, len(jobs))
	for _, j := range jobs {
		pbJobs = append(pbJobs, ipcToEdgepbPrintJob(j))
	}
	return &edgepb.ListPrintJobsResponse{Jobs: pbJobs}, nil
}

func (s *EdgeDaemonService) ConfirmPrint(ctx context.Context, req *edgepb.ConfirmPrintRequest) (*edgepb.PrintResult, error) {
	if s.printMgr == nil {
		return nil, status.Error(codes.Unavailable, "print manager not available")
	}
	result, err := s.printMgr.ConfirmPrint(req.GetJobId(), req.GetConfirmed())
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	return ipcToEdgepbPrintResult(result), nil
}

func (s *EdgeDaemonService) CancelPrintJob(ctx context.Context, req *edgepb.CancelPrintJobRequest) (*edgepb.CancelPrintJobResponse, error) {
	if s.printMgr == nil {
		return nil, status.Error(codes.Unavailable, "print manager not available")
	}
	err := s.printMgr.CancelJob(req.GetJobId())
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	return &edgepb.CancelPrintJobResponse{
		Success: true,
		JobId:   req.GetJobId(),
	}, nil
}

func (s *EdgeDaemonService) WatchPrintJobs(req *edgepb.WatchPrintJobsRequest, stream edgepb.EdgeDaemonService_WatchPrintJobsServer) error {
	if s.printMgr == nil {
		return status.Error(codes.Unavailable, "print manager not available")
	}
	events, err := s.printMgr.WatchJobs()
	if err != nil {
		return status.Error(codes.Internal, err.Error())
	}
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				return nil
			}
			pbEv := &edgepb.PrintJobEvent{
				JobId:     ev.JobID,
				OldStatus: edgepb.PrintJobStatus(ev.OldStatus),
				NewStatus: edgepb.PrintJobStatus(ev.NewStatus),
				ErrorCode: edgepb.ErrorCode(ev.ErrorCode),
			}
			if err := stream.Send(pbEv); err != nil {
				return err
			}
		case <-stream.Context().Done():
			return stream.Context().Err()
		}
	}
}

// ============================================================
// 音频
// ============================================================

func (s *EdgeDaemonService) StartRecording(ctx context.Context, req *edgepb.StartRecordingRequest) (*edgepb.RecordingStatus, error) {
	if s.audioMgr == nil {
		return nil, status.Error(codes.Unavailable, "audio manager not available")
	}
	err := s.audioMgr.StartRecording()
	if err != nil {
		return &edgepb.RecordingStatus{
			Started:      false,
			ErrorMessage: err.Error(),
		}, nil
	}
	s.updateLED()
	return &edgepb.RecordingStatus{Started: true}, nil
}

func (s *EdgeDaemonService) StopRecording(ctx context.Context, req *edgepb.StopRecordingRequest) (*edgepb.RecordingResult, error) {
	if s.audioMgr == nil {
		return nil, status.Error(codes.Unavailable, "audio manager not available")
	}
	result, err := s.audioMgr.StopRecording()
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	if result.AudioPath == "" {
		return nil, status.Error(codes.FailedPrecondition, "no audio recorded")
	}
	// 保存录音路径供后续 CreatePrintJob 上传云端
	s.lastAudioPathMu.Lock()
	s.lastAudioPath = result.AudioPath
	s.lastAudioPathMu.Unlock()
	s.updateLED()
	return ipcToEdgepbRecordingResult(result), nil
}

func (s *EdgeDaemonService) PlayAudio(ctx context.Context, req *edgepb.PlayAudioRequest) (*edgepb.PlayAudioResponse, error) {
	if s.audioMgr == nil {
		return nil, status.Error(codes.Unavailable, "audio manager not available")
	}
	audioType := req.GetAudioType().String()
	err := s.audioMgr.PlayAudio(req.GetAudioPath(), audioType)
	if err != nil {
		return &edgepb.PlayAudioResponse{Started: false}, nil
	}
	return &edgepb.PlayAudioResponse{Started: true}, nil
}

func (s *EdgeDaemonService) StopPlayback(ctx context.Context, req *edgepb.StopPlaybackRequest) (*edgepb.StopPlaybackResponse, error) {
	if s.audioMgr == nil {
		return nil, status.Error(codes.Unavailable, "audio manager not available")
	}
	err := s.audioMgr.StopPlayback()
	if err != nil {
		return &edgepb.StopPlaybackResponse{Stopped: false}, nil
	}
	return &edgepb.StopPlaybackResponse{Stopped: true}, nil
}

// ============================================================
// 预览（云端图片）
// ============================================================

func (s *EdgeDaemonService) GetPreview(ctx context.Context, req *edgepb.GetPreviewRequest) (*edgepb.PreviewData, error) {
	jobID := req.GetJobId()
	if s.cloudConn == nil {
		return nil, status.Error(codes.Unavailable, "cloud connector not available")
	}

	// 优先查本地 job（可能已有云端回填的 previewURL）
	if s.printMgr != nil {
		if job, err := s.printMgr.GetJob(jobID); err == nil && job.PreviewImageURL != "" {
			return &edgepb.PreviewData{JobId: jobID, ImageUrl: job.PreviewImageURL}, nil
		}
	}

	// 通过 cloud_job_id 查询云端预览
	s.cloudJobIDsMu.RLock()
	cloudJobID, hasCloudID := s.cloudJobIDs[jobID]
	s.cloudJobIDsMu.RUnlock()

	if hasCloudID {
		previewURL, err := s.cloudConn.GetPreviewURL(cloudJobID)
		if err != nil {
			return nil, status.Error(codes.Internal, err.Error())
		}
		return &edgepb.PreviewData{
			JobId:   jobID,
			ImageUrl: previewURL,
		}, nil
	}

	return nil, status.Error(codes.NotFound, "no preview available for this job")
}

func (s *EdgeDaemonService) WatchPreview(req *edgepb.WatchPreviewRequest, stream edgepb.EdgeDaemonService_WatchPreviewServer) error {
	if s.cloudConn == nil {
		return status.Error(codes.Unavailable, "cloud connector not available")
	}
	notifs, err := s.cloudConn.WatchNotifications()
	if err != nil {
		return status.Error(codes.Internal, err.Error())
	}
	for {
		select {
		case n, ok := <-notifs:
			if !ok {
				return nil
			}
			if req.GetJobId() != "" && n.JobID != req.GetJobId() {
				continue
			}
			isPreviewReady := n.Type == "preview_ready"
			pbEv := &edgepb.PreviewNotification{
				JobId:   n.JobID,
				Ready:   isPreviewReady,
			}
			if isPreviewReady && n.Payload != "" {
				pbEv.ImageUrl = n.Payload
			}
			if err := stream.Send(pbEv); err != nil {
				return err
			}
		case <-stream.Context().Done():
			return stream.Context().Err()
		}
	}
}

// ============================================================
// 家长锁
// ============================================================

func (s *EdgeDaemonService) GetParentLockStatus(ctx context.Context, req *edgepb.GetParentLockStatusRequest) (*edgepb.ParentLockStatus, error) {
	st, err := s.loadParentLockStatus()
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	return ipcToEdgepbParentLockStatus(st), nil
}

func (s *EdgeDaemonService) ValidatePin(ctx context.Context, req *edgepb.ValidatePinRequest) (*edgepb.ValidatePinResponse, error) {
	st, err := s.loadParentLockStatus()
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	if st.LockoutActive {
		return &edgepb.ValidatePinResponse{
			Valid:            false,
			RemainingAttempts: 0,
		}, nil
	}

	valid, err := s.verifyPin(req.GetPin())
	if err != nil {
		st.RemainingAttempts--
		s.saveParentLockStatus(st)
		return &edgepb.ValidatePinResponse{
			Valid:             false,
			RemainingAttempts: st.RemainingAttempts,
		}, nil
	}
	if !valid {
		st.RemainingAttempts--
		if st.RemainingAttempts <= 0 {
			st.LockoutActive = true
		}
		s.saveParentLockStatus(st)
	}
	return &edgepb.ValidatePinResponse{
		Valid:            valid,
		RemainingAttempts: st.RemainingAttempts,
	}, nil
}

func (s *EdgeDaemonService) SetPin(ctx context.Context, req *edgepb.SetPinRequest) (*edgepb.SetPinResponse, error) {
	// 首次设置：old_pin 为空
	oldPIN := req.GetOldPin()
	if oldPIN != "" {
		ok, err := s.verifyPin(oldPIN)
		if err != nil || !ok {
			return &edgepb.SetPinResponse{
				Success:      false,
				ErrorMessage: "old PIN does not match",
			}, nil
		}
	}
	if err := s.savePin(req.GetNewPin()); err != nil {
		return &edgepb.SetPinResponse{
			Success:      false,
			ErrorMessage: err.Error(),
		}, nil
	}
	// 重置家长锁状态
	st := &types.ParentLockStatus{
		Locked:            true,
		PinSet:            true,
		RemainingAttempts: 5,
	}
	s.saveParentLockStatus(st)
	return &edgepb.SetPinResponse{Success: true}, nil
}

func (s *EdgeDaemonService) UnlockDevice(ctx context.Context, req *edgepb.UnlockDeviceRequest) (*edgepb.UnlockDeviceResponse, error) {
	ok, err := s.verifyPin(req.GetPin())
	if ok && err == nil {
		st, _ := s.loadParentLockStatus()
		st.Locked = false
		st.RemainingAttempts = 5
		st.LockoutActive = false
		s.saveParentLockStatus(st)
		return &edgepb.UnlockDeviceResponse{Unlocked: true}, nil
	}
	return &edgepb.UnlockDeviceResponse{Unlocked: false}, nil
}

// ============================================================
// 设置
// ============================================================

func (s *EdgeDaemonService) GetSettings(ctx context.Context, req *edgepb.GetSettingsRequest) (*edgepb.Settings, error) {
	st, err := s.loadSettings()
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	return ipcToEdgepbSettings(st), nil
}

func (s *EdgeDaemonService) UpdateSetting(ctx context.Context, req *edgepb.UpdateSettingRequest) (*edgepb.UpdateSettingResponse, error) {
	st, err := s.loadSettings()
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	switch req.GetKey() {
	case "wifi_enabled":
		st.WifiEnabled = req.GetValue() == "true"
	case "wifi_ssid":
		st.WifiSSID = req.GetValue()
	case "wifi_password":
		st.WifiPassword = req.GetValue()
	case "volume_percent":
		st.VolumePercent = parseInt32(req.GetValue())
	case "brightness_percent":
		st.BrightnessPercent = parseInt32(req.GetValue())
	case "default_mode":
		st.DefaultMode = types.ContentMode(parseInt32(req.GetValue()))
	case "device_name":
		st.DeviceName = req.GetValue()
	default:
		return &edgepb.UpdateSettingResponse{
			Success:      false,
			ErrorMessage: fmt.Sprintf("unknown setting key: %s", req.GetKey()),
		}, nil
	}

	if err := s.saveSettings(st); err != nil {
		return &edgepb.UpdateSettingResponse{
			Success:      false,
			ErrorMessage: err.Error(),
		}, nil
	}
	return &edgepb.UpdateSettingResponse{Success: true}, nil
}

func (s *EdgeDaemonService) FactoryReset(ctx context.Context, req *edgepb.FactoryResetRequest) (*edgepb.FactoryResetResponse, error) {
	// 重置设置到出厂默认值
	if err := s.saveSettings(defaultSettings()); err != nil {
		return &edgepb.FactoryResetResponse{Success: false}, nil
	}
	// 清除 PIN
	_ = s.savePin("")
	// 重置家长锁
	_ = s.saveParentLockStatus(&types.ParentLockStatus{
		Locked:            false,
		PinSet:            false,
		RemainingAttempts: 5,
	})
	return &edgepb.FactoryResetResponse{Success: true}, nil
}

// ============================================================
// WiFi 扫描
// ============================================================

func (s *EdgeDaemonService) ListWiFiNetworks(ctx context.Context, req *edgepb.ListWiFiNetworksRequest) (*edgepb.ListWiFiNetworksResponse, error) {
	if s.wifiScanner == nil {
		// 无 WiFi 模块时返回空列表
		return &edgepb.ListWiFiNetworksResponse{}, nil
	}

	networks, err := s.wifiScanner.ScanNetworks()
	if err != nil {
		slog.Error("wifi scan failed", "error", err)
		return nil, status.Error(codes.Internal, "wifi scan failed")
	}

	return &edgepb.ListWiFiNetworksResponse{
		Networks: ipcToEdgepbWiFiNetworks(networks),
	}, nil
}

// ============================================================
// GPIO - LED 状态指示
// ============================================================

// updateLED 根据当前设备状态设置 LED
func (s *EdgeDaemonService) updateLED() {
	if s.gpioMgr == nil {
		return
	}
	audioState := s.audioMgr.GetState()
	ledOn := false
	switch audioState {
	case types.AudioStateRecording, types.AudioStatePlaying:
		ledOn = true
	default:
		if s.printMgr != nil && s.printMgr.QueueDepth() > 0 {
			ledOn = true
		}
	}
	if err := s.gpioMgr.SetLED(ledOn); err != nil {
		slog.Warn("set LED failed", "on", ledOn, "error", err)
	}
}

// ============================================================
// GPIO - PTT 按键处理
// ============================================================

func (s *EdgeDaemonService) handlePTT() {
	if s.gpioMgr == nil {
		return
	}
	events := s.gpioMgr.PTTEvent()
	for pressed := range events {
		if pressed {
			slog.Info("PTT pressed")
			if s.audioMgr != nil {
				s.audioMgr.StartRecording()
				s.updateLED()
			}
		} else {
			slog.Info("PTT released")
			if s.audioMgr == nil {
				continue
			}
			result, err := s.audioMgr.StopRecording()
			if err != nil {
				slog.Error("stop recording error", "error", err)
				continue
			}
			slog.Info("recording saved", "path", result.AudioPath, "duration_ms", result.DurationMs)
			s.updateLED()

			// 1. 创建本地 PrintJob（auto-confirm：PTT 无 UI 确认步骤）
			localJob, err := s.printMgr.CreateJob(&types.CreatePrintJobRequest{
				ContentMode: types.ContentModeAICreate,
				Copies:      1,
				AutoConfirm: true,
			})
			if err != nil {
				slog.Error("create local print job failed", "error", err)
				continue
			}
			slog.Info("local print job created (GPIO)", "job_id", localJob.JobID)

			// 2. 上传音频到云端并关联 localJobID
			if s.cloudConn != nil {
				go func(localJobID, audioPath string, mode types.ContentMode) {
					cloudJobID, err := s.cloudConn.CreateJob(mode, audioPath)
					if err != nil {
						slog.Error("cloud create job (GPIO)", "error", err)
						return
					}
					slog.Info("cloud job created (GPIO)", "local_job", localJobID, "cloud_job", cloudJobID)
					s.cloudJobIDsMu.Lock()
					s.cloudJobIDs[localJobID] = cloudJobID
					s.cloudJobIDsMu.Unlock()
				}(localJob.JobID, result.AudioPath, types.ContentModeAICreate)
			}
		}
	}
}

// ============================================================
// 云端通知处理
// ============================================================

// handlePreviewReady 当云端通知 preview_ready 时将预览 URL 回填到本地 job
func (s *EdgeDaemonService) handlePreviewReady(cloudJobID string) {
	// 反向查找 localJobID
	s.cloudJobIDsMu.RLock()
	var localJobID string
	for k, v := range s.cloudJobIDs {
		if v == cloudJobID {
			localJobID = k
			break
		}
	}
	s.cloudJobIDsMu.RUnlock()

	if localJobID == "" {
		slog.Warn("preview_ready: no local job for cloud job", "cloud_job_id", cloudJobID)
		return
	}

	previewURL, err := s.cloudConn.GetPreviewURL(cloudJobID)
	if err != nil {
		slog.Error("preview_ready: GetPreviewURL failed", "cloud_job_id", cloudJobID, "error", err)
		return
	}

	if s.printMgr != nil {
		if err := s.printMgr.UpdatePreviewURL(localJobID, previewURL); err != nil {
			slog.Error("preview_ready: UpdatePreviewURL failed", "local_job_id", localJobID, "error", err)
			return
		}
		// PTT 等无 UI 确认的任务，预览就绪后自动入队列
		if err := s.printMgr.AutoConfirmPending(localJobID); err != nil {
			slog.Warn("preview_ready: AutoConfirmPending", "local_job_id", localJobID, "error", err)
		}
	}
}

func (s *EdgeDaemonService) handleCloudNotifications() {
	if s.cloudConn == nil {
		return
	}
	notifs, err := s.cloudConn.WatchNotifications()
	if err != nil {
		slog.Error("watch notifications error", "error", err)
		return
	}
	for n := range notifs {
		slog.Info("cloud notification", "type", n.Type, "job_id", n.JobID)
		switch n.Type {
		case "preview_ready":
			slog.Info("preview ready for job", "job_id", n.JobID)
			s.handlePreviewReady(n.JobID)
		case "ota_available":
			slog.Info("OTA update available", "payload", n.Payload)
		}
	}
}

// ============================================================
// 状态广播
// ============================================================

func (s *EdgeDaemonService) broadcastStatus() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		status := s.collectDeviceStatus()
		s.updateLED()
		s.mu.RLock()
		for id, ch := range s.statusSubs {
			select {
			case ch <- status:
			default:
				slog.Warn("status subscriber slow, dropping", "subscriber", id)
			}
		}
		s.mu.RUnlock()

		if s.cloudConn != nil {
			// MQTT 在线时走 MQTT，否则 fallback 到 HTTPS
			if s.cloudConn.ConnectionState() == types.DeviceConnectionOnline {
				s.cloudConn.PublishTelemetry(status)
			} else {
				if err := s.cloudConn.PublishTelemetryHTTPS(status); err != nil {
					slog.Warn("telemetry HTTPS fallback failed", "error", err)
				}
			}
		}
	}
}

func (s *EdgeDaemonService) collectDeviceStatus() *types.DeviceStatus {
	status := &types.DeviceStatus{
		AudioState:     s.audioMgr.GetState(),
		BatteryPercent: readBatteryPercent(),
	}

	if s.cloudConn != nil {
		status.Connection = s.cloudConn.ConnectionState()
	} else {
		status.Connection = types.DeviceConnectionOffline
	}

	// QueueDepth
	if s.printMgr != nil {
		status.QueueDepth = s.printMgr.QueueDepth()
	}

	// StorageFreeMB
	status.StorageFreeMB = readStorageFreeMB(s.cfg.DataDir)

	// PrinterState
	if s.printMgr != nil {
		status.PrinterState = s.printMgr.PrinterState()
	}

	// ParentLockActive
	st, _ := s.loadParentLockStatus()
	status.ParentLockActive = st.Locked

	// TemperatureC
	status.TemperatureC = readTemperatureC()

	return status
}

// SubscribeStatus 注册状态订阅（返回 channel，由调用方消费）
func (s *EdgeDaemonService) SubscribeStatus(subscriberID string) chan *types.DeviceStatus {
	ch := make(chan *types.DeviceStatus, 4)
	s.mu.Lock()
	s.statusSubs[subscriberID] = ch
	s.mu.Unlock()
	return ch
}

// UnsubscribeStatus 取消状态订阅
func (s *EdgeDaemonService) UnsubscribeStatus(subscriberID string) {
	s.mu.Lock()
	if ch, ok := s.statusSubs[subscriberID]; ok {
		close(ch)
		delete(s.statusSubs, subscriberID)
	}
	s.mu.Unlock()
}

// ============================================================
// 存储辅助 — 委托至 storage.StorageManager
// ============================================================

// readBatteryPercent 从 sysfs 读取电池电量百分比
func readBatteryPercent() int32 {
	// 常见 sysfs 路径：BAT0 / BAT1
	for _, name := range []string{"BAT0", "BAT1", "axp20x-battery"} {
		path := filepath.Join("/sys/class/power_supply", name, "capacity")
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		val, err := strconv.Atoi(strings.TrimSpace(string(data)))
		if err != nil {
			continue
		}
		return int32(val)
	}
	return 0
}

// readStorageFreeMB 读取数据目录所在文件系统的剩余空间（MB）
func readStorageFreeMB(path string) int32 {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0
	}
	// Bsize 是块大小，Bavail 是可用块数
	freeBytes := stat.Bavail * uint64(stat.Bsize)
	return int32(freeBytes / (1024 * 1024))
}

// readTemperatureC 从 sysfs 读取 SoC 温度（毫度 → 摄氏度）
func readTemperatureC() int64 {
	for _, path := range []string{
		"/sys/class/thermal/thermal_zone0/temp",
		"/sys/class/thermal/thermal_zone1/temp",
	} {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		val, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
		if err != nil {
			continue
		}
		// sysfs 返回毫度（如 45000 = 45°C），除以 1000
		return val / 1000
	}
	return 0
}

func (s *EdgeDaemonService) loadParentLockStatus() (*types.ParentLockStatus, error) {
	if s.storage == nil {
		return &types.ParentLockStatus{PinSet: false, RemainingAttempts: 5}, nil
	}
	st, err := s.storage.LoadParentLockStatus()
	if err != nil {
		// 未设置时返回默认值而非报错
		return &types.ParentLockStatus{PinSet: false, RemainingAttempts: 5}, nil
	}
	return st, nil
}

func (s *EdgeDaemonService) saveParentLockStatus(st *types.ParentLockStatus) error {
	if s.storage == nil {
		return nil
	}
	return s.storage.SaveParentLockStatus(st)
}

func (s *EdgeDaemonService) loadPin() (string, error) {
	if s.storage == nil {
		return "", fmt.Errorf("no PIN set")
	}
	return s.storage.LoadPIN()
}

func (s *EdgeDaemonService) verifyPin(pin string) (bool, error) {
	if s.storage == nil {
		return false, fmt.Errorf("storage not available")
	}
	return s.storage.VerifyPIN(pin)
}

func (s *EdgeDaemonService) savePin(pin string) error {
	if s.storage == nil {
		return nil
	}
	return s.storage.SavePIN(pin)
}

func (s *EdgeDaemonService) loadSettings() (*types.Settings, error) {
	if s.storage == nil {
		return defaultSettings(), nil
	}
	st, err := s.storage.LoadSettings()
	if err != nil {
		return defaultSettings(), nil
	}
	return st, nil
}

func (s *EdgeDaemonService) saveSettings(st *types.Settings) error {
	if s.storage == nil {
		return nil
	}
	return s.storage.SaveSettings(st)
}

func defaultSettings() *types.Settings {
	return &types.Settings{
		WifiEnabled:       false,
		WifiSSID:          "",
		WifiPassword:      "",
		VolumePercent:     80,
		BrightnessPercent: 80,
		DefaultMode:       types.ContentModeAICreate,
		DeviceName:        "奇想印印",
	}
}

func parseInt32(s string) int32 {
	var v int32
	for _, c := range s {
		if c < '0' || c > '9' {
			break
		}
		v = v*10 + int32(c-'0')
	}
	return v
}
