// edge-daemon — 奇想印印端侧核心守护进程
//
// 对应 doc/3 §2.1 进程模型、doc/2 §4 端侧应用架构
// 职责：打印队列、音频管理、GPIO/PTT、IPC 服务端（gRPC）
//
// 运行方式：
//   sudo ./edge-daemon -config /etc/fancy-print/config.yaml
//
// 打包部署：
//   go build -o edge-daemon ./cmd/edge-daemon/
//   交叉编译: GOOS=linux GOARCH=arm64 go build -o edge-daemon-arm64 ./cmd/edge-daemon/

package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/fancy-print/edge-daemon/internal/config"
	"github.com/fancy-print/edge-daemon/internal/ipc"
)

var (
	configPath = flag.String("config", "/etc/fancy-print/config.yaml", "配置文件路径")
	showVersion = flag.Bool("version", false, "显示版本号")
)

const version = "0.1.0"

func main() {
	flag.Parse()

	if *showVersion {
		fmt.Printf("edge-daemon version %s\n", version)
		os.Exit(0)
	}

	// 初始化结构化日志
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	slog.Info("starting edge-daemon", "version", version)

	// 加载配置
	cfg, err := config.Load(*configPath)
	if err != nil {
		slog.Error("failed to load config", "path", *configPath, "error", err)
		os.Exit(1)
	}
	slog.Info("config loaded", "device_id", cfg.DeviceID)

	// 启动 gRPC IPC 服务
	grpcServer, err := ipc.NewServer(cfg)
	if err != nil {
		slog.Error("failed to create IPC server", "error", err)
		os.Exit(1)
	}

	go func() {
		addr := fmt.Sprintf(":%d", cfg.GRPCPort)
		slog.Info("gRPC IPC server listening", "addr", addr)
		if err := grpcServer.Start(addr); err != nil {
			slog.Error("gRPC server error", "error", err)
			os.Exit(1)
		}
	}()

	// 等待退出信号
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT)
	sig := <-sigCh
	slog.Info("received signal, shutting down", "signal", sig.String())

	grpcServer.Stop()
	slog.Info("edge-daemon stopped")
}
