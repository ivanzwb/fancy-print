// Package config — ota-agent 配置
//
// 复用 /etc/fancy-print/config.yaml 中的 OTA 相关字段，
// 确保与 edge-daemon 配置一致。
//
// 对应 doc/3 §2.2 OTA 更新

package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// Config ota-agent 配置
type Config struct {
	DeviceID       string `yaml:"device_id"`
	DeviceName     string `yaml:"device_name"`
	APIBaseURL     string `yaml:"api_base_url"`
	DataDir        string `yaml:"data_dir"`
	CacheDir       string `yaml:"cache_dir"`
	OTAUpdateURL   string `yaml:"ota_update_url"`
	OTAPublicKey   string `yaml:"ota_public_key"`   // 更新包签名验证公钥路径
	CurrentVersion string `yaml:"current_version"`
}

// DefaultConfig 返回默认配置
func DefaultConfig() *Config {
	return &Config{
		DataDir:  "/var/lib/fancy-print",
		CacheDir: "/var/cache/fancy-print",
	}
}

// Load 从 edge-daemon 配置文件加载 OTA 相关配置
func Load(path string) (*Config, error) {
	cfg := DefaultConfig()

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return nil, fmt.Errorf("read config: %w", err)
	}

	// 先解析到通用 map 提取 OTA 字段
	var raw map[string]interface{}
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	// 提取已知字段
	if v, ok := raw["device_id"].(string); ok {
		cfg.DeviceID = v
	}
	if v, ok := raw["device_name"].(string); ok {
		cfg.DeviceName = v
	}
	if v, ok := raw["api_base_url"].(string); ok {
		cfg.APIBaseURL = v
	}
	if v, ok := raw["data_dir"].(string); ok {
		cfg.DataDir = v
	}
	if v, ok := raw["cache_dir"].(string); ok {
		cfg.CacheDir = v
	}
	if v, ok := raw["ota_update_url"].(string); ok {
		cfg.OTAUpdateURL = v
	}
	if v, ok := raw["ota_public_key"].(string); ok {
		cfg.OTAPublicKey = v
	}
	if v, ok := raw["current_version"].(string); ok {
		cfg.CurrentVersion = v
	}

	// 默认 OTA URL 从 API base URL 派生
	if cfg.OTAUpdateURL == "" && cfg.APIBaseURL != "" {
		cfg.OTAUpdateURL = cfg.APIBaseURL + "/ota/check"
	}

	return cfg, nil
}

// Validate 验证必填字段
func (c *Config) Validate() error {
	if c.DeviceID == "" {
		return fmt.Errorf("device_id is required")
	}
	return nil
}
