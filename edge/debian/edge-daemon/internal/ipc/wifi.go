// Package ipc — WiFi 扫描器实现（nmcli 后端）
//
// 依赖：NetworkManager（nmcli）
// 对应 doc/3 §2.1 进程模型、doc/2 §6 网络

package ipc

import (
	"os/exec"
	"strings"

	"github.com/fancy-print/edge-daemon/internal/types"
)

// RealWiFiScanner 使用 nmcli 扫描真实 WiFi 网络
type RealWiFiScanner struct{}

// ScanNetworks 执行 nmcli WiFi 扫描并返回结果
func (r *RealWiFiScanner) ScanNetworks() ([]types.WiFiNetwork, error) {
	// nmcli -t 模式：字段用 : 分隔，特殊字符用 \: 转义
	// 输出: SSID:SIGNAL:SECURITY
	out, err := exec.Command(
		"nmcli", "-t", "-f", "SSID,SIGNAL,SECURITY", "dev", "wifi", "list",
	).Output()
	if err != nil {
		return nil, err
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	networks := make([]types.WiFiNetwork, 0, len(lines))

	for _, line := range lines {
		if line == "" {
			continue
		}

		// 解析 terse 格式：用 : 分割，但处理 \: 转义
		fields := splitNMCLITerse(line)
		if len(fields) < 2 {
			continue
		}

		ssid := fields[0]
		if ssid == "" || ssid == "--" {
			continue // 隐藏网络
		}

		signalStr := fields[1]
		signal := parseInt32(signalStr)

		secured := len(fields) >= 3 && fields[2] != ""

		networks = append(networks, types.WiFiNetwork{
			SSID:           ssid,
			SignalStrength: signal,
			Secured:        secured,
		})
	}

	return networks, nil
}

// splitNMCLITerse 分割 nmcli -t 输出的一行，处理 \: 转义
func splitNMCLITerse(line string) []string {
	var fields []string
	var current strings.Builder
	escaped := false

	for _, ch := range line {
		if escaped {
			current.WriteRune(ch)
			escaped = false
			continue
		}
		if ch == '\\' {
			escaped = true
			continue
		}
		if ch == ':' {
			fields = append(fields, current.String())
			current.Reset()
			continue
		}
		current.WriteRune(ch)
	}
	fields = append(fields, current.String())

	return fields
}

// hasNMCLI 检测系统是否安装了 nmcli
func hasNMCLI() bool {
	err := exec.Command("which", "nmcli").Run()
	return err == nil
}
