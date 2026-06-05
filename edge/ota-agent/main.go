// ota-agent — 奇想印印 OTA 更新检查与安装代理
//
// 由 systemd timer 每日触发，执行：
//  1. 向云端查询可用更新
//  2. 验证更新包 Ed25519 签名
//  3. 下载并调用系统脚本安装
//
// 对应 doc/3 §2.2 OTA 更新
//
// 运行方式：
//   ./ota-agent -config /etc/fancy-print/config.yaml
//
// 交叉编译：
//   GOOS=linux GOARCH=arm64 go build -o ota-agent-arm64 .

package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"

	"github.com/fancy-print/edge-daemon/ota-agent/internal/config"
	"github.com/fancy-print/edge-daemon/ota-agent/internal/updater"
)

var (
	configPath  = flag.String("config", "/etc/fancy-print/config.yaml", "配置文件路径")
	showVersion = flag.Bool("version", false, "显示版本号")
	checkOnly   = flag.Bool("check", false, "仅检查更新，不下载安装")
)

const version = "0.1.0"

func main() {
	flag.Parse()

	if *showVersion {
		fmt.Printf("ota-agent version %s\n", version)
		os.Exit(0)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	slog.Info("starting ota-agent", "version", version)

	cfg, err := config.Load(*configPath)
	if err != nil {
		slog.Error("failed to load config", "path", *configPath, "error", err)
		os.Exit(1)
	}

	if err := cfg.Validate(); err != nil {
		slog.Error("invalid config", "error", err)
		os.Exit(1)
	}

	slog.Info("config loaded", "device_id", cfg.DeviceID, "current_version", cfg.CurrentVersion)

	u := updater.New(cfg)

	// 检查更新
	result, err := u.Check()
	if err != nil {
		slog.Error("update check failed", "error", err)
		os.Exit(1)
	}

	if !result.UpdateAvailable {
		slog.Info("no update available; exiting")
		os.Exit(0)
	}

	slog.Info("update available",
		"version", result.Version,
		"size", result.PackageSize,
	)

	if *checkOnly {
		slog.Info("check-only mode; exiting")
		os.Exit(0)
	}

	// 验证签名
	if err := u.Verify(result); err != nil {
		slog.Error("signature verification failed", "error", err)
		os.Exit(1)
	}

	// 下载更新包
	packagePath, err := u.Download(result)
	if err != nil {
		slog.Error("download failed", "error", err)
		os.Exit(1)
	}

	// 应用更新
	if err := u.Apply(packagePath); err != nil {
		slog.Error("apply update failed", "error", err)
		os.Exit(1)
	}

	slog.Info("OTA update completed successfully", "version", result.Version)
}
