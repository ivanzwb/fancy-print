// Package storage — 持久化存储
//
// JSON 文件存储，目录 /var/lib/fancy-print/
// 支持：打印任务持久化、任务列表查询、状态更新
//
// 对应 doc/3 §5 数据缓存与配置

package storage

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fancy-print/edge-daemon/internal/types"
)

// FileStore 基于 JSON 文件的持久化存储
type FileStore struct {
	dataDir string
	mu      sync.RWMutex
}

// NewFileStore 创建文件存储
func NewFileStore(dataDir string) (*FileStore, error) {
	dirs := []string{
		dataDir,
		filepath.Join(dataDir, "jobs"),
		filepath.Join(dataDir, "audio"),
		filepath.Join(dataDir, "cache"),
	}

	for _, d := range dirs {
		if err := os.MkdirAll(d, 0755); err != nil {
			return nil, fmt.Errorf("create dir %s: %w", d, err)
		}
	}

	return &FileStore{dataDir: dataDir}, nil
}

// jobPath 返回任务文件路径
func (s *FileStore) jobPath(jobID string) string {
	return filepath.Join(s.dataDir, "jobs", jobID+".json")
}

func (s *FileStore) SavePrintJob(job *types.PrintJob) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.MarshalIndent(job, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal job: %w", err)
	}

	path := s.jobPath(job.JobID)
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("write job file: %w", err)
	}

	slog.Debug("print job saved", "job_id", job.JobID, "path", path)
	return nil
}

func (s *FileStore) GetPrintJob(jobID string) (*types.PrintJob, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := os.ReadFile(s.jobPath(jobID))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("job not found: %s", jobID)
		}
		return nil, fmt.Errorf("read job file: %w", err)
	}

	var job types.PrintJob
	if err := json.Unmarshal(data, &job); err != nil {
		return nil, fmt.Errorf("unmarshal job: %w", err)
	}

	return &job, nil
}

func (s *FileStore) ListPrintJobs(limit int, statusFilter types.PrintJobStatus) ([]*types.PrintJob, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entries, err := os.ReadDir(filepath.Join(s.dataDir, "jobs"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("list jobs: %w", err)
	}

	var result []*types.PrintJob
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		job, err := s.GetPrintJob(strings.TrimSuffix(e.Name(), ".json"))
		if err != nil {
			continue
		}
		if statusFilter != types.PrintJobStatusUnspecified && job.Status != statusFilter {
			continue
		}
		result = append(result, job)
		if limit > 0 && len(result) >= limit {
			break
		}
	}
	return result, nil
}

// LoadAllPrintJobs 加载所有本地持久化的打印任务
func (s *FileStore) LoadAllPrintJobs() ([]*types.PrintJob, error) {
	return s.ListPrintJobs(0, types.PrintJobStatusUnspecified)
}

// SaveParentLock 持久化家长锁 hash+salt
func (s *FileStore) SaveParentLock(hash, salt string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := json.MarshalIndent(map[string]string{"hash": hash, "salt": salt}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.parentLockPath(), data, 0600)
}

// LoadParentLock 读取家长锁 hash+salt
func (s *FileStore) LoadParentLock() (hash string, salt string, err error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	data, err := os.ReadFile(s.parentLockPath())
	if err != nil {
		return "", "", err
	}
	var m map[string]string
	if err := json.Unmarshal(data, &m); err != nil {
		return "", "", err
	}
	return m["hash"], m["salt"], nil
}

func (s *FileStore) UpdatePrintJobStatus(jobID string, status types.PrintJobStatus, errorCode types.ErrorCode, errMsg string) error {
	job, err := s.GetPrintJob(jobID)
	if err != nil {
		return err
	}

	job.Status = status
	job.ErrorCode = errorCode
	job.ErrorMessage = errMsg

	return s.SavePrintJob(job)
}

func (s *FileStore) UpdatePrintJobPreview(jobID, previewURL string) error {
	job, err := s.GetPrintJob(jobID)
	if err != nil {
		return err
	}
	job.PreviewImageURL = previewURL
	return s.SavePrintJob(job)
}

// Close 关闭存储（FileStore 为文件存储，无需清理资源）
func (s *FileStore) Close() error { return nil }

// Cleanup 清理过期文件：jobMaxAge 之前的 job 文件、audioMaxAge 之前的音频文件
func (s *FileStore) Cleanup(jobMaxAge, audioMaxAge time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	var errs []string

	// 清理过期 job 文件
	jobsDir := filepath.Join(s.dataDir, "jobs")
	entries, err := os.ReadDir(jobsDir)
	if err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			if now.Sub(info.ModTime()) > jobMaxAge {
				path := filepath.Join(jobsDir, e.Name())
				if err := os.Remove(path); err != nil {
					errs = append(errs, fmt.Sprintf("remove job %s: %v", e.Name(), err))
				} else {
					slog.Debug("cleaned up old job file", "path", e.Name())
				}
			}
		}
	}

	// 清理过期音频文件
	audioDir := filepath.Join(s.dataDir, "audio")
	audioEntries, err := os.ReadDir(audioDir)
	if err == nil {
		for _, e := range audioEntries {
			if e.IsDir() {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			if now.Sub(info.ModTime()) > audioMaxAge {
				path := filepath.Join(audioDir, e.Name())
				if err := os.Remove(path); err != nil {
					errs = append(errs, fmt.Sprintf("remove audio %s: %v", e.Name(), err))
				} else {
					slog.Debug("cleaned up old audio file", "path", e.Name())
				}
			}
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("cleanup errors: %s", strings.Join(errs, "; "))
	}
	return nil
}

// CleanupLoop 定期执行清理，每 interval 运行一次，直到 stopCh 被关闭
func (s *FileStore) CleanupLoop(interval, jobMaxAge, audioMaxAge time.Duration, stopCh <-chan struct{}) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	slog.Info("cleanup loop started", "interval", interval, "job_max_age", jobMaxAge, "audio_max_age", audioMaxAge)

	// 启动时立即执行一次
	if err := s.Cleanup(jobMaxAge, audioMaxAge); err != nil {
		slog.Warn("initial cleanup failed", "error", err)
	}

	for {
		select {
		case <-stopCh:
			slog.Info("cleanup loop stopped")
			return
		case <-ticker.C:
			if err := s.Cleanup(jobMaxAge, audioMaxAge); err != nil {
				slog.Warn("cleanup failed", "error", err)
			}
		}
	}
}

func (s *FileStore) SaveDeviceConfig(cfg *types.DeviceConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal device config: %w", err)
	}
	return os.WriteFile(filepath.Join(s.dataDir, "device_config.json"), data, 0644)
}

func (s *FileStore) LoadDeviceConfig() (*types.DeviceConfig, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	data, err := os.ReadFile(filepath.Join(s.dataDir, "device_config.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read device config: %w", err)
	}
	var cfg types.DeviceConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal device config: %w", err)
	}
	return &cfg, nil
}

// ============================================================
// 设置持久化
// ============================================================

func (s *FileStore) settingsPath() string {
	return filepath.Join(s.dataDir, "settings.json")
}

func (s *FileStore) SaveSettings(st *types.Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal settings: %w", err)
	}
	return os.WriteFile(s.settingsPath(), data, 0644)
}

func (s *FileStore) LoadSettings() (*types.Settings, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := os.ReadFile(s.settingsPath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("settings not found")
		}
		return nil, fmt.Errorf("read settings: %w", err)
	}

	var st types.Settings
	if err := json.Unmarshal(data, &st); err != nil {
		return nil, fmt.Errorf("unmarshal settings: %w", err)
	}
	return &st, nil
}

// ============================================================
// PIN 持久化
// ============================================================

func (s *FileStore) pinPath() string {
	return filepath.Join(s.dataDir, "pin.json")
}

type pinData struct {
	Hash string `json:"hash"` // hex(sha256(salt+pin))
	Salt string `json:"salt"` // hex(random 16 bytes)
}

// hashPIN 对明文 PIN 进行 SHA-256+salt 哈希，返回 "hex_salt:hex_hash"
func hashPIN(pin string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate salt: %w", err)
	}
	saltHex := hex.EncodeToString(salt)

	h := sha256.New()
	h.Write(salt)
	h.Write([]byte(pin))
	hashHex := hex.EncodeToString(h.Sum(nil))

	return saltHex + ":" + hashHex, nil
}

// verifyPIN 验证明文 PIN 是否匹配存储的 "salt:hash" 值
func verifyPIN(stored, pin string) bool {
	parts := strings.SplitN(stored, ":", 2)
	if len(parts) != 2 {
		return false
	}
	salt, err := hex.DecodeString(parts[0])
	if err != nil {
		return false
	}
	expectedHash, err := hex.DecodeString(parts[1])
	if err != nil {
		return false
	}

	h := sha256.New()
	h.Write(salt)
	h.Write([]byte(pin))
	return string(h.Sum(nil)) == string(expectedHash)
}

func (s *FileStore) SavePIN(pin string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	stored, err := hashPIN(pin)
	if err != nil {
		return fmt.Errorf("hash pin: %w", err)
	}
	data, err := json.MarshalIndent(pinData{Hash: stored}, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal pin: %w", err)
	}
	return os.WriteFile(s.pinPath(), data, 0600)
}

func (s *FileStore) LoadPIN() (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := os.ReadFile(s.pinPath())
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("no PIN set")
		}
		return "", fmt.Errorf("read pin: %w", err)
	}

	var pd pinData
	if err := json.Unmarshal(data, &pd); err != nil {
		return "", fmt.Errorf("unmarshal pin: %w", err)
	}

	// 支持旧格式（明文 PIN），迁移到哈希格式
	if pd.Salt == "" && pd.Hash != "" && !strings.Contains(pd.Hash, ":") {
		// 旧格式：pd.Hash 实际上是明文 PIN，重新哈希存储
		newStored, err := hashPIN(pd.Hash)
		if err == nil {
			pd = pinData{Hash: newStored}
			if migrateData, err := json.MarshalIndent(pd, "", "  "); err == nil {
				_ = os.WriteFile(s.pinPath(), migrateData, 0600)
			}
		}
		return pd.Hash, nil
	}

	return pd.Hash, nil
}

// VerifyPIN 对外暴露的 PIN 验证函数
func (s *FileStore) VerifyPIN(pin string) (bool, error) {
	stored, err := s.LoadPIN()
	if err != nil {
		return false, err
	}
	// 兼容旧格式（明文 PIN）
	if !strings.Contains(stored, ":") {
		return stored == pin, nil
	}
	return verifyPIN(stored, pin), nil
}

// ============================================================
// 家长锁状态持久化
// ============================================================

func (s *FileStore) parentLockPath() string {
	return filepath.Join(s.dataDir, "parent_lock.json")
}

func (s *FileStore) SaveParentLockStatus(st *types.ParentLockStatus) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal parent lock: %w", err)
	}
	return os.WriteFile(s.parentLockPath(), data, 0644)
}

func (s *FileStore) LoadParentLockStatus() (*types.ParentLockStatus, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := os.ReadFile(s.parentLockPath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("parent lock status not found")
		}
		return nil, fmt.Errorf("read parent lock: %w", err)
	}

	var st types.ParentLockStatus
	if err := json.Unmarshal(data, &st); err != nil {
		return nil, fmt.Errorf("unmarshal parent lock: %w", err)
	}
	return &st, nil
}
