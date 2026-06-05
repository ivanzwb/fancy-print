// Package updater — OTA 更新检查与安装引擎
//
// 职责：
// - 向云端 OTA 服务查询可用更新
// - 验证更新包的 Ed25519 签名
// - 下载并应用更新（系统级别 + 应用级别）
// - 记录更新日志
//
// 对应 doc/3 §2.2 OTA 更新

package updater

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/fancy-print/edge-daemon/ota-agent/internal/config"
)

// State 更新状态
type State string

const (
	StateIdle        State = "idle"
	StateChecking    State = "checking"
	StateAvailable   State = "available"
	StateDownloading State = "downloading"
	StateVerifying   State = "verifying"
	StateReady       State = "ready"
	StateInstalling  State = "installing"
	StateCompleted   State = "completed"
	StateFailed      State = "failed"
)

// CheckResult OTA 检查结果
type CheckResult struct {
	UpdateAvailable bool   `json:"update_available"`
	Version         string `json:"version"`
	PackageURL      string `json:"package_url"`
	PackageHash     string `json:"package_hash"` // SHA-256
	Signature       string `json:"signature"`    // Ed25519 hex
	Changelog       string `json:"changelog"`
	PackageSize     int64  `json:"package_size"`
}

// Updater OTA 更新管理器
type Updater struct {
	cfg     *config.Config
	client  *http.Client
	state   State
	stateCh chan State
	result  *CheckResult
}

// New 创建 OTA 更新管理器
func New(cfg *config.Config) *Updater {
	return &Updater{
		cfg: cfg,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		state:   StateIdle,
		stateCh: make(chan State, 8),
	}
}

// State 返回当前状态
func (u *Updater) State() State {
	return u.state
}

// StateChan 返回状态变更通知 channel
func (u *Updater) StateChan() <-chan State {
	return u.stateCh
}

// setState 更新状态并通知
func (u *Updater) setState(s State) {
	u.state = s
	select {
	case u.stateCh <- s:
	default:
	}
}

// Check 向云端查询 OTA 更新（带重试）
func (u *Updater) Check() (*CheckResult, error) {
	u.setState(StateChecking)
	slog.Info("checking for OTA updates", "device_id", u.cfg.DeviceID)

	if u.cfg.OTAUpdateURL == "" {
		u.setState(StateIdle)
		return nil, fmt.Errorf("ota_update_url not configured")
	}

	reqBody := map[string]string{
		"device_id":       u.cfg.DeviceID,
		"current_version": u.cfg.CurrentVersion,
	}
	reqBytes, err := json.Marshal(reqBody)
	if err != nil {
		u.setState(StateIdle)
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			slog.Info("retrying OTA check", "attempt", attempt+1)
			time.Sleep(time.Duration(attempt*2) * time.Second)
		}

		result, err := u.doCheck(reqBytes)
		if err == nil {
			return result, nil
		}
		lastErr = err
	}

	u.setState(StateIdle)
	return nil, fmt.Errorf("ota check failed after retries: %w", lastErr)
}

// doCheck 执行单次 OTA 检查
func (u *Updater) doCheck(reqBody []byte) (*CheckResult, error) {
	resp, err := u.client.Post(u.cfg.OTAUpdateURL, "application/json",
		bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var result CheckResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	u.result = &result

	if result.UpdateAvailable {
		slog.Info("update available",
			"version", result.Version,
			"size", result.PackageSize,
		)
		u.setState(StateAvailable)
	} else {
		slog.Info("no update available", "current_version", u.cfg.CurrentVersion)
		u.setState(StateIdle)
	}

	return &result, nil
}

// Verify 验证更新包签名（Ed25519）
func (u *Updater) Verify(result *CheckResult) error {
	u.setState(StateVerifying)
	slog.Info("verifying update package signature", "version", result.Version)

	if u.cfg.OTAPublicKey == "" {
		return fmt.Errorf("ota_public_key not configured")
	}

	keyData, err := os.ReadFile(u.cfg.OTAPublicKey)
	if err != nil {
		u.setState(StateFailed)
		return fmt.Errorf("read public key: %w", err)
	}

	pubKey, err := hex.DecodeString(string(keyData))
	if err != nil {
		u.setState(StateFailed)
		return fmt.Errorf("decode public key: %w", err)
	}

	if len(pubKey) != ed25519.PublicKeySize {
		u.setState(StateFailed)
		return fmt.Errorf("invalid public key length: %d", len(pubKey))
	}

	sig, err := hex.DecodeString(result.Signature)
	if err != nil {
		u.setState(StateFailed)
		return fmt.Errorf("decode signature: %w", err)
	}

	hashBytes, err := hex.DecodeString(result.PackageHash)
	if err != nil {
		u.setState(StateFailed)
		return fmt.Errorf("decode package hash: %w", err)
	}

	if !ed25519.Verify(pubKey, hashBytes, sig) {
		u.setState(StateFailed)
		return fmt.Errorf("signature verification failed")
	}

	slog.Info("signature verified successfully")
	u.setState(StateReady)
	return nil
}

// Download 下载更新包到缓存目录
func (u *Updater) Download(result *CheckResult) (string, error) {
	u.setState(StateDownloading)
	slog.Info("downloading update package", "url", result.PackageURL)

	cachePath := filepath.Join(u.cfg.CacheDir, fmt.Sprintf("update-%s.pkg", result.Version))

	if info, err := os.Stat(cachePath); err == nil && info.Size() == result.PackageSize {
		slog.Info("package already cached", "path", cachePath)
		return cachePath, nil
	}

	resp, err := u.client.Get(result.PackageURL)
	if err != nil {
		u.setState(StateFailed)
		return "", fmt.Errorf("download package: %w", err)
	}
	defer resp.Body.Close()

	out, err := os.Create(cachePath)
	if err != nil {
		u.setState(StateFailed)
		return "", fmt.Errorf("create cache file: %w", err)
	}
	defer out.Close()

	written, err := io.Copy(out, resp.Body)
	if err != nil {
		u.setState(StateFailed)
		return "", fmt.Errorf("write package: %w", err)
	}

	slog.Info("download complete", "path", cachePath, "size", written)
	return cachePath, nil
}

// Apply 应用更新（调用系统更新脚本）
func (u *Updater) Apply(packagePath string) error {
	u.setState(StateInstalling)
	slog.Info("applying update", "path", packagePath)

	scriptPath := "/usr/lib/fancy-print/scripts/apply-update.sh"
	if _, err := os.Stat(scriptPath); os.IsNotExist(err) {
		u.setState(StateFailed)
		return fmt.Errorf("update script not found at %s; cannot apply %s", scriptPath, packagePath)
	}

	// 执行更新脚本
	cmd := exec.Command(scriptPath, packagePath, u.cfg.CurrentVersion)
	output, err := cmd.CombinedOutput()
	if err != nil {
		u.setState(StateFailed)
		return fmt.Errorf("update script failed: %w\noutput: %s", err, string(output))
	}

	slog.Info("update applied successfully", "output", string(output))
	u.setState(StateCompleted)
	return nil
}
