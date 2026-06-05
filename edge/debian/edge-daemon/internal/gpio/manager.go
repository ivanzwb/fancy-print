// Package gpio — GPIO 管理器
//
// 职责：
// - PTT 物理按键监听（中断/轮询）
// - 状态 LED 控制
//
// 对应 doc/3 §2.1、doc/2 §6 GPIO/PTT
//
// 实现方式：
// - 生产：libgpiod（gpiod CLI 或 cgo 绑定）
// - 开发/Mock：无硬件时可回退到模拟模式
//
// Debian 依赖：gpiod（libgpiod-utils）
//
// GPIO 编号使用 BCM/SoC 编号（非物理引脚号）：
// PTT = GPIO17（物理 pin 11），LED = GPIO27（物理 pin 13）

package gpio

import (
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// Manager GPIO 管理器
type Manager struct {
	pttGPIO      int           // PTT 按键 GPIO
	ledGPIO      int           // 状态 LED GPIO
	pollInterval  time.Duration // 轮询间隔（无中断时）
	pttState     bool
	pttEvents    chan bool
	mockPTT      chan bool // 模拟 PTT 输入（无硬件时使用）
	stopCh       chan struct{}
	mu           sync.Mutex
	useSysfs     bool // 使用 sysfs（回退）还是 gpiod
}

// NewManager 创建 GPIO 管理器
func NewManager(pttGPIO, ledGPIO int) *Manager {
	return &Manager{
		pttGPIO:      pttGPIO,
		ledGPIO:      ledGPIO,
		pollInterval:  50 * time.Millisecond,
		pttState:     false,
		pttEvents:    make(chan bool, 16),
		mockPTT:      make(chan bool, 16),
		stopCh:       make(chan struct{}),
		useSysfs:     false,
	}
}

// Start 初始化 GPIO 并启动监听
func (m *Manager) Start() error {
	slog.Info("initializing GPIO", "ptt_pin", m.pttGPIO, "led_pin", m.ledGPIO)

	// 探测系统使用 gpiod 还是 sysfs
	if !m.hasGPIOD() {
		if !m.hasSysfs() {
			slog.Warn("no GPIO subsystem found, using mock mode")
			go m.mockLoop()
			return nil
		}
		m.useSysfs = true
		slog.Info("using sysfs GPIO (backup)")
	} else {
		slog.Info("using gpiod GPIO")
	}

	// 导出/初始化 GPIO
	if err := m.exportGPIO(m.pttGPIO, "in"); err != nil {
		slog.Warn("PTT GPIO init failed, using mock", "error", err)
		go m.mockLoop()
		return nil
	}
	if err := m.exportGPIO(m.ledGPIO, "out"); err != nil {
		slog.Warn("LED GPIO init failed")
	}

	go m.pollLoop()
	return nil
}

// Stop 停止 GPIO 监听
func (m *Manager) Stop() {
	close(m.stopCh)
}

// SetLED 设置 LED 状态
func (m *Manager) SetLED(on bool) error {
	value := "0"
	if on {
		value = "1"
	}

	if m.useSysfs {
		return exec.Command("sh", "-c",
			fmt.Sprintf("echo %s > /sys/class/gpio/gpio%d/value", value, m.ledGPIO)).Run()
	}

	// gpiod
	return exec.Command("gpioset", fmt.Sprintf("gpiochip0"), fmt.Sprintf("%d=%s", m.ledGPIO, value)).Run()
}

// PTTState 返回 PTT 按键当前状态（true = 按下）
func (m *Manager) PTTState() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.pttState
}

// PTTEvent 返回 PTT 按键事件 channel
// true = 按下，false = 松开
func (m *Manager) PTTEvent() <-chan bool {
	return m.pttEvents
}

// SimulatePTT 在 mock 模式下模拟 PTT 按键（不依赖硬件）
func (m *Manager) SimulatePTT(pressed bool) {
	select {
	case m.mockPTT <- pressed:
	default:
		slog.Warn("mock PTT channel full, dropping event")
	}
}

// ============================================================
// 内部方法
// ============================================================

func (m *Manager) hasGPIOD() bool {
	err := exec.Command("which", "gpioset").Run()
	return err == nil
}

func (m *Manager) hasSysfs() bool {
	_, err := exec.Command("sh", "-c", "ls /sys/class/gpio/ 2>/dev/null").Output()
	return err == nil
}

func (m *Manager) exportGPIO(pin int, direction string) error {
	if m.useSysfs {
		// sysfs: echo pin > export; echo direction > direction
		exec.Command("sh", "-c", fmt.Sprintf("echo %d > /sys/class/gpio/export 2>/dev/null", pin)).Run()
		return exec.Command("sh", "-c",
			fmt.Sprintf("echo %s > /sys/class/gpio/gpio%d/direction", direction, pin)).Run()
	}
	return nil // gpiod 不需要 export
}

func (m *Manager) readGPIO(pin int) (bool, error) {
	if m.useSysfs {
		out, err := exec.Command("sh", "-c",
			fmt.Sprintf("cat /sys/class/gpio/gpio%d/value", pin)).Output()
		if err != nil {
			return false, err
		}
		return strings.TrimSpace(string(out)) == "1", nil
	}

	// gpiod: gpioget gpiochip0 <pin>
	out, err := exec.Command("gpioget", "--active-low", "gpiochip0", fmt.Sprintf("%d", pin)).Output()
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(string(out)) == "1", nil
}

// pollLoop 轮询 PTT 引脚（50ms 间隔）
func (m *Manager) pollLoop() {
	slog.Info("GPIO PTT poll loop started")
	ticker := time.NewTicker(m.pollInterval)
	defer ticker.Stop()

	lastState := false

	for range ticker.C {
		select {
		case <-m.stopCh:
			slog.Info("GPIO poll loop stopped")
			return
		default:
		}

		current, err := m.readGPIO(m.pttGPIO)
		if err != nil {
			continue
		}

		if current != lastState {
			lastState = current
			m.mu.Lock()
			m.pttState = current
			m.mu.Unlock()

			slog.Debug("PTT state changed", "pressed", current)
			select {
			case m.pttEvents <- current:
			default:
				slog.Warn("PTT event channel full, dropping")
			}
		}
	}
}

// mockLoop 无硬件时的模拟模式
func (m *Manager) mockLoop() {
	slog.Info("GPIO mock mode: call SimulatePTT() to simulate PTT button")

	lastState := false

	for {
		select {
		case <-m.stopCh:
			slog.Info("GPIO mock loop stopped")
			return
		case pressed := <-m.mockPTT:
			if pressed == lastState {
				continue
			}
			lastState = pressed
			m.mu.Lock()
			m.pttState = pressed
			m.mu.Unlock()
			slog.Debug("mock PTT", "pressed", pressed)
			select {
			case m.pttEvents <- pressed:
			default:
				slog.Warn("mock PTT event channel full, dropping")
			}
		}
	}
}
