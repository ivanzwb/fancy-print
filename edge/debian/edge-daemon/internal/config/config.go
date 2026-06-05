// Package config — edge-daemon 配置管理
//
// 配置文件路径：/etc/fancy-print/config.yaml（只读）
// 运行时覆盖：/var/lib/fancy-print/config.override.yaml（可选）
//
// 对应 doc/2 §8 安全配置

package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// Config 顶层配置结构
type Config struct {
	// 设备身份
	DeviceID   string `yaml:"device_id"`
	DeviceName string `yaml:"device_name"`

	// IPC 服务
	GRPCPort int `yaml:"grpc_port"`

	// 打印
	PrinterDriver string `yaml:"printer_driver"` // "cups", "direct"
	PrinterName   string `yaml:"printer_name"`   // CUPS 打印机名
	PrintTimeoutS int    `yaml:"print_timeout_s"`

	// 音频
	AudioInputDevice  string `yaml:"audio_input_device"`  // ALSA 输入设备
	AudioOutputDevice string `yaml:"audio_output_device"` // ALSA 输出设备
	SampleRate        int    `yaml:"sample_rate"`

	// GPIO
	PTTGPIO int `yaml:"ptt_gpio"` // PTT 按键 GPIO 编号
	LEDGPIO int `yaml:"led_gpio"` // 状态 LED GPIO 编号

	// 云连接
	MQTTBrokerURL   string `yaml:"mqtt_broker_url"`
	MQTTClientID    string `yaml:"mqtt_client_id"`
	APIBaseURL      string `yaml:"api_base_url"`
	TokenPath       string `yaml:"token_path"`

	// 存储
	DataDir          string `yaml:"data_dir"`
	CacheDir         string `yaml:"cache_dir"`
	AudioDir         string `yaml:"audio_dir"`
	MaxCacheSizeMB   int    `yaml:"max_cache_size_mb"`
	MaxAudioDurationS int   `yaml:"max_audio_duration_s"`

	// 日志
	LogLevel string `yaml:"log_level"`
}

// DefaultConfig 返回默认配置
func DefaultConfig() *Config {
	return &Config{
		GRPCPort:          9090,
		PrinterDriver:     "cups",
		PrintTimeoutS:     120,
		SampleRate:        16000,
		PTTGPIO:           17,
		LEDGPIO:           27,
		DataDir:           "/var/lib/fancy-print",
		CacheDir:          "/var/cache/fancy-print",
		AudioDir:          "/var/lib/fancy-print/audio",
		MaxCacheSizeMB:    200,
		MaxAudioDurationS: 30,
		LogLevel:          "info",
	}
}

// Load 从 YAML 文件加载配置，缺失字段使用默认值
func Load(path string) (*Config, error) {
	cfg := DefaultConfig()

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil // 配置文件不存在时使用默认值
		}
		return nil, fmt.Errorf("read config: %w", err)
	}

	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	// 验证必填字段
	if cfg.DeviceID == "" {
		return nil, fmt.Errorf("device_id is required in config")
	}

	return cfg, nil
}
