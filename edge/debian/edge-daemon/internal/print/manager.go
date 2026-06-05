// Package print — 打印队列管理器
//
// 职责：
// - 打印任务状态机（queued → printing → completed/failed/cancelled）
// - 队列管理（FIFO、优先级、并发控制）
// - CUPS/lp 集成（cups.go）
// - 任务持久化（委托 storage 包）
//
// 对应 doc/3 §2.1 进程模型、doc/2 §6 打印集成

package print

import (
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/fancy-print/edge-daemon/internal/types"
)

// Manager 打印队列管理器
type Manager struct {
	printer    PrinterBackend
	store      types.StorageManager
	mu         sync.RWMutex
	jobs       []*types.PrintJob
	queue      []string // jobID 队列（FIFO）
	subs       map[string]chan *types.PrintJobEvent
	stopCh     chan struct{}
	activeID   string        // 当前打印中的 jobID
	retryCount map[string]int // jobID → 连续失败次数
}

// PrinterBackend 打印后端接口（CUPS / 直写 / mock）
type PrinterBackend interface {
	// Print 提交打印作业（图片路径 → 打印机）
	Print(jobID string, imagePath string) error
	// Cancel 取消当前作业
	Cancel(jobID string) error
	// State 返回打印机状态
	State() string // "ready", "printing", "error", "offline"
}

// NewManager 创建打印管理器
func NewManager(printer PrinterBackend, store types.StorageManager) *Manager {
	return &Manager{
		printer:    printer,
		store:      store,
		subs:       make(map[string]chan *types.PrintJobEvent),
		stopCh:     make(chan struct{}),
		retryCount: make(map[string]int),
	}
}

// Start 启动队列处理循环
func (m *Manager) Start() error {
	go m.processLoop()
	return nil
}

// Stop 停止队列处理
func (m *Manager) Stop() {
	close(m.stopCh)
}

// ============================================================
// IPC 接口实现
// ============================================================

func (m *Manager) CreateJob(req *types.CreatePrintJobRequest) (*types.PrintJob, error) {
	if req.Copies <= 0 {
		req.Copies = 1
	}

	job := &types.PrintJob{
		JobID:           fmt.Sprintf("job-%d", time.Now().UnixNano()),
		ContentMode:     req.ContentMode,
		Status:          types.PrintJobStatusPendingConfirm,
		ErrorCode:       types.ErrorCodeNone,
		PreviewImageURL: req.PreviewImageURL,
		Copies:          req.Copies,
		CreatedAtUnix:   time.Now().Unix(),
		AutoConfirm:     req.AutoConfirm,
	}

	m.mu.Lock()
	m.jobs = append(m.jobs, job)
	m.mu.Unlock()
	// 不入队列 — 等待 ConfirmPrint 或 auto-confirm 后方可打印

	// 持久化
	if m.store != nil {
		if err := m.store.SavePrintJob(job); err != nil {
			slog.Error("persist print job failed", "job_id", job.JobID, "error", err)
		}
	}

	// 广播事件
	m.broadcastEvent(job.JobID, types.PrintJobStatusUnspecified, types.PrintJobStatusPendingConfirm, types.ErrorCodeNone)

	slog.Info("print job created", "job_id", job.JobID, "mode", req.ContentMode.String())
	return job, nil
}

func (m *Manager) GetJob(jobID string) (*types.PrintJob, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, j := range m.jobs {
		if j.JobID == jobID {
			return j, nil
		}
	}
	return nil, fmt.Errorf("job not found: %s", jobID)
}

func (m *Manager) ListJobs(limit int, statusFilter types.PrintJobStatus) ([]*types.PrintJob, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []*types.PrintJob
	for _, j := range m.jobs {
		if statusFilter != types.PrintJobStatusUnspecified && j.Status != statusFilter {
			continue
		}
		result = append(result, j)
		if limit > 0 && len(result) >= limit {
			break
		}
	}
	return result, nil
}

func (m *Manager) ConfirmPrint(jobID string, confirmed bool) (*types.PrintResult, error) {
	job, err := m.GetJob(jobID)
	if err != nil {
		return nil, err
	}

	if !confirmed {
		m.updateStatus(job, types.PrintJobStatusCancelled, types.ErrorCodeCancelled, "用户放弃")
		return &types.PrintResult{
			Success:      false,
			JobID:        jobID,
			ErrorCode:    types.ErrorCodeCancelled,
			ErrorMessage: "用户放弃打印",
		}, nil
	}

	// 确认打印 → 入队列
	m.mu.Lock()
	job.Status = types.PrintJobStatusQueued
	m.queue = append(m.queue, jobID)
	m.mu.Unlock()

	m.broadcastEvent(jobID, types.PrintJobStatusPendingConfirm, types.PrintJobStatusQueued, types.ErrorCodeNone)

	return &types.PrintResult{
		Success: true,
		JobID:   jobID,
	}, nil
}

func (m *Manager) CancelJob(jobID string) error {
	job, err := m.GetJob(jobID)
	if err != nil {
		return err
	}

	// 如果正在打印，通知后端取消
	if job.Status == types.PrintJobStatusPrinting {
		if m.printer != nil {
			m.printer.Cancel(jobID)
		}
	}

	m.updateStatus(job, types.PrintJobStatusCancelled, types.ErrorCodeNone, "用户取消")
	return nil
}

// AutoConfirmPending 如果 job 标记了 AutoConfirm 且仍为 PendingConfirm，则入队列
func (m *Manager) AutoConfirmPending(jobID string) error {
	m.mu.Lock()
	var job *types.PrintJob
	for _, j := range m.jobs {
		if j.JobID == jobID {
			job = j
			break
		}
	}
	if job == nil {
		m.mu.Unlock()
		return fmt.Errorf("job not found: %s", jobID)
	}
	if !job.AutoConfirm || job.Status != types.PrintJobStatusPendingConfirm {
		m.mu.Unlock()
		return nil
	}
	job.Status = types.PrintJobStatusQueued
	m.queue = append(m.queue, jobID)
	m.mu.Unlock()

	m.broadcastEvent(jobID, types.PrintJobStatusPendingConfirm, types.PrintJobStatusQueued, types.ErrorCodeNone)
	return nil
}

func (m *Manager) WatchJobs() (<-chan *types.PrintJobEvent, error) {
	ch := make(chan *types.PrintJobEvent, 32)
	subID := fmt.Sprintf("print-%d", time.Now().UnixNano())
	m.mu.Lock()
	m.subs[subID] = ch
	m.mu.Unlock()
	return ch, nil
}

// ============================================================
// 内部方法
// ============================================================

// processLoop 队列处理主循环
func (m *Manager) processLoop() {
	for {
		select {
		case <-m.stopCh:
			return
		default:
			m.mu.Lock()
			if len(m.queue) == 0 {
				m.mu.Unlock()
				time.Sleep(500 * time.Millisecond)
				continue
			}

			jobID := m.queue[0]
			m.queue = m.queue[1:]
			m.activeID = jobID
			m.mu.Unlock()

			m.printJob(jobID)
		}
	}
}

const (
	maxRetries       = 3
	retryBaseDelayMs = 1000
)

func (m *Manager) printJob(jobID string) {
	job, err := m.GetJob(jobID)
	if err != nil {
		slog.Error("print job not found in queue", "job_id", jobID)
		return
	}

	slog.Info("printing job", "job_id", jobID)
	m.updateStatus(job, types.PrintJobStatusPrinting, types.ErrorCodeNone, "")

	if m.printer == nil {
		// 无后端：mock 打印（3秒假装）
		slog.Warn("no printer backend — mock printing", "job_id", jobID)
		time.Sleep(3 * time.Second)
		m.updateStatus(job, types.PrintJobStatusCompleted, types.ErrorCodeNone, "")
		return
	}

	// 重试循环
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			delay := time.Duration(retryBaseDelayMs*(1<<(attempt-1))) * time.Millisecond
			slog.Info("retrying print", "job_id", jobID, "attempt", attempt, "delay_ms", delay.Milliseconds())
			time.Sleep(delay)
		}

		// 调用 CUPS 后端
		failed := false
		for i := 0; i < int(job.Copies); i++ {
			err := m.printer.Print(jobID, job.PreviewImageURL)
			if err != nil {
				slog.Error("print failed", "job_id", jobID, "copy", i+1, "attempt", attempt+1, "error", err)
				failed = true
				break
			}
		}

		if !failed {
			// 成功后清除重试计数
			m.mu.Lock()
			delete(m.retryCount, jobID)
			m.mu.Unlock()
			m.updateStatus(job, types.PrintJobStatusCompleted, types.ErrorCodeNone, "")
			slog.Info("print job completed", "job_id", jobID)
			return
		}

		// 最后一次尝试也失败 → 永久失败
		if attempt == maxRetries {
			m.mu.Lock()
			m.retryCount[jobID] = attempt + 1
			m.mu.Unlock()
			slog.Error("print job permanent failure", "job_id", jobID, "retries", maxRetries)
			m.updateStatus(job, types.PrintJobStatusFailed, types.ErrorCodeInternal, fmt.Sprintf("failed after %d retries", maxRetries))
			return
		}
	}
}

func (m *Manager) updateStatus(job *types.PrintJob, status types.PrintJobStatus, errCode types.ErrorCode, errMsg string) {
	oldStatus := job.Status
	job.Status = status
	job.ErrorCode = errCode
	job.ErrorMessage = errMsg

	if status == types.PrintJobStatusCompleted || status == types.PrintJobStatusFailed {
		job.CompletedAtUnix = time.Now().Unix()
		m.mu.Lock()
		m.activeID = ""
		m.mu.Unlock()
	}

	// 持久化状态变更
	if m.store != nil {
		m.store.UpdatePrintJobStatus(job.JobID, status, errCode, errMsg)
	}

	m.broadcastEvent(job.JobID, oldStatus, status, errCode)
}

// QueueDepth 返回队列中的待打印任务数
func (m *Manager) QueueDepth() int32 {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return int32(len(m.queue))
}

// PrinterState 返回打印机状态（委托 PrinterBackend）
func (m *Manager) PrinterState() string {
	if m.printer == nil {
		return "offline"
	}
	return m.printer.State()
}

// UpdatePreviewURL 更新 job 的云端预览图片 URL，并持久化
func (m *Manager) UpdatePreviewURL(jobID, previewURL string) error {
	m.mu.Lock()
	for _, j := range m.jobs {
		if j.JobID == jobID {
			j.PreviewImageURL = previewURL
			if m.store != nil {
				m.store.UpdatePrintJobPreview(jobID, previewURL)
			}
			m.mu.Unlock()
			return nil
		}
	}
	m.mu.Unlock()
	return fmt.Errorf("job not found: %s", jobID)
}

func (m *Manager) broadcastEvent(jobID string, oldStatus, newStatus types.PrintJobStatus, errCode types.ErrorCode) {
	event := &types.PrintJobEvent{
		JobID:     jobID,
		OldStatus: oldStatus,
		NewStatus: newStatus,
		ErrorCode: errCode,
	}

	m.mu.RLock()
	for id, ch := range m.subs {
		select {
		case ch <- event:
		default:
			slog.Warn("print subscriber slow, dropping", "subscriber", id)
		}
	}
	m.mu.RUnlock()
}
