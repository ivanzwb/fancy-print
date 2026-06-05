// Package print — CUPS 打印后端
//
// 通过 `lp` 命令或 libcups 提交打印作业。
// 适用于 Debian/Ubuntu 上 CUPS 已安装并配置打印机队列的场景。
//
// 对应 doc/2 §6 打印集成

package print

import (
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
)

// CUPSPrinter CUPS 打印后端
type CUPSPrinter struct {
	printerName string        // CUPS 队列名
	timeout     int           // 超时秒数
}

// NewCUPSPrinter 创建 CUPS 打印后端
func NewCUPSPrinter(printerName string, timeoutS int) *CUPSPrinter {
	return &CUPSPrinter{
		printerName: printerName,
		timeout:     timeoutS,
	}
}

// Print 通过 lp 命令打印图片
// imagePath 可以是本地文件路径或 LP 兼容的 URI
func (c *CUPSPrinter) Print(jobID string, imagePath string) error {
	if c.printerName == "" {
		return fmt.Errorf("CUPS printer not configured")
	}

	args := []string{
		"-d", c.printerName,
		"-t", fmt.Sprintf("fancy-print-%s", jobID),
		"-o", "media=A5",
		"-o", "fit-to-page",
		"-o", "print-quality=5", // 最高质量
	}

	// 添加图片路径
	args = append(args, imagePath)

	slog.Info("lp submit", "printer", c.printerName, "job", jobID, "file", imagePath)
	cmd := exec.Command("lp", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("lp failed: %w, output: %s", err, strings.TrimSpace(string(output)))
	}

	slog.Info("lp success", "job", jobID, "output", strings.TrimSpace(string(output)))
	return nil
}

// Cancel 通过 cancel 命令取消作业
func (c *CUPSPrinter) Cancel(jobID string) error {
	// CUPS job ID 通常是数字格式，这里接受自定义 jobID 过滤
	slog.Info("cancel print job", "job_id", jobID)
	cmd := exec.Command("cancel", "-x", jobID)
	output, err := cmd.CombinedOutput()
	if err != nil {
		// 可能任务已结束，非致命
		slog.Warn("cancel may have failed", "error", err, "output", string(output))
	}
	return nil
}

// State 返回打印机状态（通过 lpstat）
func (c *CUPSPrinter) State() string {
	cmd := exec.Command("lpstat", "-p", c.printerName)
	output, err := cmd.Output()
	if err != nil {
		return "offline"
	}

	outputStr := strings.ToLower(string(output))
	switch {
	case strings.Contains(outputStr, "idle"):
		return "ready"
	case strings.Contains(outputStr, "printing"):
		return "printing"
	case strings.Contains(outputStr, "disabled") || strings.Contains(outputStr, "error"):
		return "error"
	default:
		return "unknown"
	}
}

// MockPrinter 模拟打印机（无 CUPS 时用于开发）
type MockPrinter struct{}

func (m *MockPrinter) Print(jobID string, imagePath string) error {
	slog.Info("MOCK print", "job_id", jobID, "image", imagePath)
	return nil
}

func (m *MockPrinter) Cancel(jobID string) error {
	slog.Info("MOCK cancel", "job_id", jobID)
	return nil
}

func (m *MockPrinter) State() string {
	return "ready"
}
