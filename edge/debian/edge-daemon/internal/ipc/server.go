// Package ipc — gRPC IPC 服务端
//
// 实现 contracts/proto/edge_ipc.proto 定义的 EdgeDaemonService
// 对应 doc/3 §3 IPC 契约
//
// 支持 gRPC 与 gRPC-web 双协议（via connect-go），UI 可用 connect-es 直连

package ipc

import (
	"fmt"
	"log/slog"
	"net"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	"github.com/fancy-print/edge-daemon/internal/audio"
	"github.com/fancy-print/edge-daemon/internal/cloud"
	"github.com/fancy-print/edge-daemon/internal/config"
	"github.com/fancy-print/edge-daemon/internal/edgepb"
	"github.com/fancy-print/edge-daemon/internal/gpio"
	"github.com/fancy-print/edge-daemon/internal/print"
	"github.com/fancy-print/edge-daemon/internal/storage"
)

// Server gRPC IPC 服务端
type Server struct {
	grpcServer  *grpc.Server
	cfg         *config.Config
	svc         *EdgeDaemonService
	wg          sync.WaitGroup
	store       *storage.FileStore
	storeStopCh chan struct{}
}

// NewServer 创建 IPC 服务端及所有模块
func NewServer(cfg *config.Config) (*Server, error) {
	s := &Server{cfg: cfg}

	// === 初始化各模块 ===

	// 存储（JSON 文件）
	store, err := storage.NewFileStore(cfg.DataDir)
	if err != nil {
		return nil, fmt.Errorf("init store: %w", err)
	}
	s.store = store
	// 启动定期清理（24h 检查，job 保留 7d，音频保留 1d）
	storeStopCh := make(chan struct{})
	s.storeStopCh = storeStopCh
	go store.CleanupLoop(24*time.Hour, 7*24*time.Hour, 24*time.Hour, storeStopCh)
	slog.Info("storage cleanup loop started", "interval", "24h", "job_max_age", "7d", "audio_max_age", "1d")

	// 打印管理器（CUPS 或 Mock）
	var printerBackend print.PrinterBackend
	if cfg.PrinterDriver == "cups" && cfg.PrinterName != "" {
		printerBackend = print.NewCUPSPrinter(cfg.PrinterName, cfg.PrintTimeoutS)
		slog.Info("using CUPS printer", "name", cfg.PrinterName)
	} else {
		printerBackend = &print.MockPrinter{}
		slog.Warn("no CUPS printer configured, using mock printer")
	}
	printMgr := print.NewManager(printerBackend, store)
	printMgr.Start()

	// 音频管理器（ALSA）
	audioMgr := audio.NewManager(
		cfg.AudioInputDevice,
		cfg.AudioOutputDevice,
		cfg.SampleRate,
		cfg.AudioDir,
		cfg.MaxAudioDurationS,
	)

	// GPIO 管理器
	gpioMgr := gpio.NewManager(cfg.PTTGPIO, cfg.LEDGPIO)

	// 云连接器
	var cloudConn CloudConnector
	if cfg.MQTTBrokerURL != "" {
		cloudConn = cloud.NewConnector(&cloud.Config{
			MQTTBrokerURL: cfg.MQTTBrokerURL,
			MQTTClientID:  cfg.MQTTClientID,
			APIBaseURL:    cfg.APIBaseURL,
			TokenPath:     cfg.TokenPath,
			DeviceID:      cfg.DeviceID,
		})
		slog.Info("cloud connector initialized", "mqtt", cfg.MQTTBrokerURL)
	} else {
		slog.Warn("no MQTT broker configured, cloud features disabled")
	}

	// WiFi 扫描器（优先 nmcli，回退 mock）
	var wifiScanner WiFiScanner
	if hasNMCLI() {
		wifiScanner = &RealWiFiScanner{}
		slog.Info("using real WiFi scanner (nmcli)")
	} else {
		wifiScanner = &MockWiFiScanner{}
		slog.Warn("nmcli not found, using mock WiFi scanner")
	}

	// 创建服务实例
	svc := NewEdgeDaemonService(
		&ConfigAdapter{
			DeviceID:      cfg.DeviceID,
			DeviceName:    cfg.DeviceName,
			HardwareModel: "RK3568 K1 MINI",
			OSVersion:     "Debian 12 Bookworm",
			DataDir:       cfg.DataDir,
		},
		printMgr,
		audioMgr,
		gpioMgr,
		cloudConn,
		store,
		wifiScanner,
	)
	s.svc = svc

	// 启动后台任务（GPIO、云连接、状态广播）
	if err := svc.Start(); err != nil {
		return nil, fmt.Errorf("service start: %w", err)
	}

	// gRPC 服务端
	s.grpcServer = grpc.NewServer(
		grpc.MaxRecvMsgSize(16 * 1024 * 1024),
		grpc.MaxSendMsgSize(16 * 1024 * 1024),
	)

	// 注册 gRPC 服务
	edgepb.RegisterEdgeDaemonServiceServer(s.grpcServer, s.svc)
	slog.Info("gRPC service registered")

	reflection.Register(s.grpcServer)

	return s, nil
}

// Start 启动 gRPC 监听
func (s *Server) Start(addr string) error {
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", addr, err)
	}

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		slog.Info("gRPC server listening", "addr", addr)
		if err := s.grpcServer.Serve(lis); err != nil {
			slog.Error("gRPC serve error", "error", err)
		}
	}()

	return nil
}

// Stop 优雅停止
func (s *Server) Stop() {
	slog.Info("stopping gRPC server")
	if s.storeStopCh != nil {
		close(s.storeStopCh)
	}
	s.svc.Stop()
	s.grpcServer.GracefulStop()
	s.wg.Wait()
	slog.Info("gRPC server stopped")
}
