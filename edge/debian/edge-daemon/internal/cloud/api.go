// Package cloud — HTTPS REST API 客户端
//
// 与云端 device-api 通信，对应 doc/4 §2.4.2 API 约定
//
// 接口：
//   POST /v1/devices/{device_id}/jobs   创建打印任务
//   GET  /v1/devices/{device_id}/jobs/{job_id}/preview  获取预览
//   POST /v1/devices/{device_id}/telemetry  上报遥测
//   POST /v1/auth/device/refresh  刷新令牌

package cloud

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fancy-print/edge-daemon/internal/types"
)

// APIClient HTTPS REST API 客户端
type APIClient struct {
	baseURL    string
	tokenPath  string
	token      string
	deviceID   string
	mu         sync.Mutex
	httpClient *http.Client
}

// NewAPIClient 创建 API 客户端
func NewAPIClient(baseURL, tokenPath string, deviceID string) *APIClient {
	return &APIClient{
		baseURL:   baseURL,
		tokenPath: tokenPath,
		deviceID:  deviceID,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        4,
				IdleConnTimeout:     90 * time.Second,
				DisableCompression:  false,
			},
		},
	}
}

// LoadToken 从文件加载设备令牌
func (c *APIClient) LoadToken() error {
	data, err := os.ReadFile(c.tokenPath)
	if err != nil {
		return fmt.Errorf("read token: %w", err)
	}
	c.token = string(bytes.TrimSpace(data))
	slog.Debug("token loaded", "path", c.tokenPath)
	return nil
}

// RefreshToken 刷新设备令牌 - 调用云端 /v1/auth/device/refresh
func (c *APIClient) RefreshToken() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	url := fmt.Sprintf("%s/v1/auth/device/refresh", c.baseURL)

	body := map[string]string{"device_id": c.deviceID}
	data, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal refresh body: %w", err)
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("create refresh request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("http refresh: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("refresh token API error %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Token     string `json:"token"`
		ExpiresIn int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return fmt.Errorf("decode refresh response: %w", err)
	}

	if result.Token == "" {
		return fmt.Errorf("refresh response missing token")
	}

	c.token = result.Token

	// 持久化新令牌
	if err := os.WriteFile(c.tokenPath, []byte(result.Token), 0600); err != nil {
		slog.Warn("failed to persist refreshed token", "error", err)
	}

	slog.Info("token refreshed successfully",
		"expires_in", result.ExpiresIn)
	return nil
}

// CreateJob 创建云端任务（上传音频）
func (c *APIClient) CreateJob(deviceID string, contentMode types.ContentMode, audioPath string) (string, error) {
	url := fmt.Sprintf("%s/v1/devices/%s/jobs", c.baseURL, deviceID)

	// 上传前校验 WAV 头部
	if audioPath != "" {
		if err := validateWAVHeader(audioPath); err != nil {
			return "", fmt.Errorf("invalid WAV file: %w", err)
		}
	}

	var b bytes.Buffer
	w := multipart.NewWriter(&b)

	// 添加音频文件
	if audioPath != "" {
		file, err := os.Open(audioPath)
		if err != nil {
			return "", fmt.Errorf("open audio file: %w", err)
		}
		defer file.Close()

		fw, err := w.CreateFormFile("audio", filepath.Base(audioPath))
		if err != nil {
			return "", fmt.Errorf("create form file: %w", err)
		}
		io.Copy(fw, file)
	}

	// 添加 content_mode 字段
	w.WriteField("content_mode", contentMode.String())
	w.Close()

	req, err := http.NewRequest("POST", url, &b)
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	c.setAuthHeader(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("http post: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		JobID string `json:"job_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}

	slog.Info("cloud job created", "job_id", result.JobID)
	return result.JobID, nil
}

// GetPreviewURL 获取预览 URL
func (c *APIClient) GetPreviewURL(deviceID, jobID string) (string, error) {
	url := fmt.Sprintf("%s/v1/devices/%s/jobs/%s/preview", c.baseURL, deviceID, jobID)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	c.setAuthHeader(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("http get: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		ImageURL string `json:"image_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}

	return result.ImageURL, nil
}

// PublishTelemetryHTTPS 通过 HTTPS 上报遥测（MQTT 断开时的兜底）
func (c *APIClient) PublishTelemetryHTTPS(deviceID string, status *types.DeviceStatus) error {
	url := fmt.Sprintf("%s/v1/devices/%s/telemetry", c.baseURL, deviceID)

	body := map[string]interface{}{
		"battery":     status.BatteryPercent,
		"storage_mb":  status.StorageFreeMB,
		"queue_depth": status.QueueDepth,
		"connection":  status.Connection,
	}
	data, _ := json.Marshal(body)

	req, err := http.NewRequest("POST", url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	c.setAuthHeader(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

func (c *APIClient) setAuthHeader(req *http.Request) {
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
}

// validateWAVHeader 校验 WAV 文件头部（RIFF + WAVE 标志）
func validateWAVHeader(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	// WAV 文件最小头部为 12 字节（RIFF header + WAVE ID）
	var header [12]byte
	if _, err := io.ReadFull(f, header[:]); err != nil {
		return fmt.Errorf("read header: %w", err)
	}

	if string(header[0:4]) != "RIFF" {
		return fmt.Errorf("missing RIFF magic number")
	}
	if string(header[8:12]) != "WAVE" {
		return fmt.Errorf("missing WAVE format ID")
	}

	return nil
}
