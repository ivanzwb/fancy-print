// Package audio — 音频管理器
//
// 职责：
// - PTT 录音（arecord PCM → WAV）
// - TTS/提示音播放（aplay）
// - 音频状态管理
//
// 对应 doc/2 §6 音频集成、doc/3 §2.1 进程模型
//
// Debian 依赖：alsa-utils（arecord / aplay）
// 硬件：USB 麦克风 / 板载音频 + 扬声器

package audio

import (
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/fancy-print/edge-daemon/internal/types"
)

// Manager 音频管理器
type Manager struct {
	inputDevice       string   // ALSA 输入设备（hw:0,0 或 default）
	outputDevice      string   // ALSA 输出设备
	sampleRate        int      // 采样率（Hz）
	audioDir          string   // 音频文件存储目录
	maxDurationS      int      // 最大录音时长（秒）
	recordingPID      int      // arecord 进程 PID（录音中）
	lastRecordingPath string   // 当前录音文件路径
	playingPID        int      // aplay 进程 PID（播放中）
	state             types.AudioState
	mu                sync.Mutex
}

// NewManager 创建音频管理器
func NewManager(inputDevice, outputDevice string, sampleRate int, audioDir string, maxDurationS int) *Manager {
	return &Manager{
		inputDevice:  inputDevice,
		outputDevice: outputDevice,
		sampleRate:   sampleRate,
		audioDir:     audioDir,
		maxDurationS: maxDurationS,
		state:        types.AudioStateIdle,
	}
}

// StartRecording 开始 PTT 录音
// 使用 arecord PCM → 管道 → WAV 文件
func (m *Manager) StartRecording() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.state == types.AudioStateRecording {
		return fmt.Errorf("already recording")
	}

	if err := os.MkdirAll(m.audioDir, 0755); err != nil {
		return fmt.Errorf("create audio dir: %w", err)
	}

	outputPath := filepath.Join(m.audioDir,
		fmt.Sprintf("ptt-%d.wav", time.Now().UnixMilli()))

	// 使用 arecord 录音
	// -f S16_LE 16位 PCM 小端, -r 采样率, -c 1 单声道
	args := []string{
		"-D", m.inputDevice,
		"-f", "S16_LE",
		"-r", fmt.Sprintf("%d", m.sampleRate),
		"-c", "1",
		"-t", "wav",
		"-d", fmt.Sprintf("%d", m.maxDurationS),
		outputPath,
	}

	cmd := exec.Command("arecord", args...)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("arecord start: %w", err)
	}

	m.recordingPID = cmd.Process.Pid
	m.lastRecordingPath = outputPath
	m.state = types.AudioStateRecording

	go func() {
		err := cmd.Wait()
		m.mu.Lock()
		m.recordingPID = 0
		m.state = types.AudioStateIdle
		m.mu.Unlock()
		if err != nil {
			slog.Warn("arecord finished with error", "error", err)
		} else {
			slog.Info("recording completed (timeout)", "path", outputPath)
		}
	}()

	slog.Info("recording started", "pid", m.recordingPID, "path", outputPath, "device", m.inputDevice)
	return nil
}

// StopRecording 停止录音，返回音频文件路径
func (m *Manager) StopRecording() (*types.RecordingResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.state != types.AudioStateRecording || m.recordingPID == 0 {
		return nil, fmt.Errorf("not recording")
	}

	proc, err := os.FindProcess(m.recordingPID)
	if err != nil {
		m.state = types.AudioStateIdle
		return nil, fmt.Errorf("find recording process: %w", err)
	}

	// 发送 SIGINT 终止 arecord（arecord 会写完 WAV 头）
	if err := proc.Signal(os.Interrupt); err != nil {
		slog.Warn("signal recording process", "pid", m.recordingPID, "error", err)
	}

	path := m.lastRecordingPath
	m.state = types.AudioStateIdle
	pid := m.recordingPID
	m.recordingPID = 0
	m.lastRecordingPath = ""

	slog.Info("recording stopped", "pid", pid, "path", path)
	return &types.RecordingResult{
		AudioPath:  path,
		DurationMs: int32(m.maxDurationS * 1000),
		SampleRate: int32(m.sampleRate),
	}, nil
}

// PlayAudio 播放音频文件（TTS 提示音或音效）
func (m *Manager) PlayAudio(path string, audioType string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.state == types.AudioStatePlaying {
		// 停止当前播放
		m.stopPlayback()
	}

	// 检查文件是否存在
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return fmt.Errorf("audio file not found: %s", path)
	}

	args := []string{
		"-D", m.outputDevice,
		path,
	}

	cmd := exec.Command("aplay", args...)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("aplay start: %w", err)
	}

	m.playingPID = cmd.Process.Pid
	m.state = types.AudioStatePlaying

	go func() {
		err := cmd.Wait()
		m.mu.Lock()
		m.playingPID = 0
		m.state = types.AudioStateIdle
		m.mu.Unlock()
		if err != nil {
			slog.Warn("aplay finished with error", "error", err)
		}
	}()

	slog.Info("playback started", "path", path, "type", audioType)
	return nil
}

// StopPlayback 停止播放
func (m *Manager) StopPlayback() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.stopPlayback()
}

func (m *Manager) stopPlayback() error {
	if m.state != types.AudioStatePlaying || m.playingPID == 0 {
		return nil
	}

	proc, err := os.FindProcess(m.playingPID)
	if err != nil {
		m.state = types.AudioStateIdle
		return nil
	}

	proc.Signal(os.Interrupt)
	m.playingPID = 0
	m.state = types.AudioStateIdle
	slog.Info("playback stopped")
	return nil
}

// GetState 返回当前音频状态
func (m *Manager) GetState() types.AudioState {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}
