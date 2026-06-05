# 奇想印印 Debian 端侧软件构建系统
#
# 目标: edge-daemon, edge-ui-server, fancy-print-ui, ota-agent
# 架构: linux/amd64 (开发), linux/arm64 (量产)
#
# 用法:
#   make all         # 构建所有组件 (本地架构)
#   make arm64       # 交叉构建所有组件 (ARM64)
#   make install     # 安装到系统路径 (需要 sudo)
#   make clean       # 清理构建产物

SHELL := /bin/bash

# 架构
ARCH := $(shell uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/')
GOOS ?= linux

# 仅在交叉编译时设置 GOARCH
ifeq ($(filter arm64, $(ARCH)), arm64)
GOARCH ?= arm64
else
GOARCH ?= amd64
endif

# 工具
GO := go
NPM := npm
GOPROXY := https://goproxy.cn,direct

# 构建目录
BUILD_DIR := build
DAEMON_DIR := edge-daemon
UI_DIR := fancy-print-ui
OTA_DIR := ../../ota-agent

# 二进制名称
DAEMON_BIN := edge-daemon
UI_SERVER_BIN := edge-ui-server
OTA_BIN := ota-agent

# Go 编译标志
GO_FLAGS := -trimpath -ldflags="-s -w"

# 安装路径
PREFIX := /usr/local/bin
UI_PREFIX := /usr/share/fancy-print-ui
SYSTEMD_PREFIX := /etc/systemd/system
CONFIG_PREFIX := /etc/fancy-print

# ---------------------------------------------------------------------------
# 目标
# ---------------------------------------------------------------------------

.PHONY: all amd64 arm64 daemon ui-server ui ota \
	install install-daemon install-ui-server install-ui install-ota install-systemd \
	clean clean-daemon clean-ui clean-ota clean-all distclean

all: daemon ui-server ui ota

arm64:
	$(MAKE) all GOARCH=arm64

# edge-daemon
daemon:
	@mkdir -p $(BUILD_DIR)
	@echo "Building edge-daemon ($(GOOS)/$(GOARCH))..."
	cd $(DAEMON_DIR) && \
		GOPROXY=$(GOPROXY) GOOS=$(GOOS) GOARCH=$(GOARCH) \
		$(GO) build $(GO_FLAGS) -o ../$(BUILD_DIR)/$(DAEMON_BIN) ./cmd/edge-daemon/

# edge-ui-server
ui-server:
	@mkdir -p $(BUILD_DIR)
	@echo "Building edge-ui-server ($(GOOS)/$(GOARCH))..."
	cd $(DAEMON_DIR) && \
		GOPROXY=$(GOPROXY) GOOS=$(GOOS) GOARCH=$(GOARCH) \
		$(GO) build $(GO_FLAGS) -o ../$(BUILD_DIR)/$(UI_SERVER_BIN) ./cmd/edge-ui-server/

# fancy-print-ui (React SPA)
ui:
	@echo "Building fancy-print-ui..."
	cd $(UI_DIR) && \
		$(NPM) install --silent && \
		$(NPM) run build
	@mkdir -p $(BUILD_DIR)/ui
	@cp -r $(UI_DIR)/dist/* $(BUILD_DIR)/ui/
	@echo "UI built: $(BUILD_DIR)/ui/"

# ota-agent
ota:
	@mkdir -p $(BUILD_DIR)
	@echo "Building ota-agent ($(GOOS)/$(GOARCH))..."
	cd $(OTA_DIR) && \
		GOPROXY=$(GOPROXY) GOOS=$(GOOS) GOARCH=$(GOARCH) \
		$(GO) build $(GO_FLAGS) -o ../debian/$(BUILD_DIR)/$(OTA_BIN) .

# ---------------------------------------------------------------------------
# 安装 (需要 sudo)
# ---------------------------------------------------------------------------

install: install-daemon install-ui-server install-ui install-ota install-systemd
	@echo "Installation complete."
	@echo "Next steps:"
	@echo "  1. Edit $(CONFIG_PREFIX)/config.yaml"
	@echo "  2. systemctl daemon-reload"
	@echo "  3. systemctl enable --now edge-daemon fancy-print-ui ota-agent.timer"

install-daemon: $(BUILD_DIR)/$(DAEMON_BIN)
	install -m 755 $(BUILD_DIR)/$(DAEMON_BIN) $(PREFIX)/$(DAEMON_BIN)
	@echo "Installed $(DAEMON_BIN) -> $(PREFIX)/$(DAEMON_BIN)"

install-ui-server: $(BUILD_DIR)/$(UI_SERVER_BIN)
	install -m 755 $(BUILD_DIR)/$(UI_SERVER_BIN) $(PREFIX)/$(UI_SERVER_BIN)
	@echo "Installed $(UI_SERVER_BIN) -> $(PREFIX)/$(UI_SERVER_BIN)"

install-ui:
	install -d $(UI_PREFIX)
	cp -r $(BUILD_DIR)/ui/* $(UI_PREFIX)/
	@echo "Installed UI -> $(UI_PREFIX)/"

install-ota: $(BUILD_DIR)/$(OTA_BIN)
	install -m 755 $(BUILD_DIR)/$(OTA_BIN) $(PREFIX)/$(OTA_BIN)
	@echo "Installed $(OTA_BIN) -> $(PREFIX)/$(OTA_BIN)"

install-systemd:
	install -m 644 systemd/edge-daemon.service $(SYSTEMD_PREFIX)/
	install -m 644 systemd/fancy-print-ui.service $(SYSTEMD_PREFIX)/
	install -m 644 systemd/ota-agent.service $(SYSTEMD_PREFIX)/
	install -m 644 systemd/ota-agent.timer $(SYSTEMD_PREFIX)/
	@echo "Installed systemd units -> $(SYSTEMD_PREFIX)/"

# ---------------------------------------------------------------------------
# 清理
# ---------------------------------------------------------------------------

clean: clean-daemon clean-ui clean-ota
	rm -rf $(BUILD_DIR)
	@echo "Cleaned."

clean-daemon:
	cd $(DAEMON_DIR) && $(GO) clean ./cmd/...

clean-ui:
	rm -rf $(UI_DIR)/dist
	rm -rf $(UI_DIR)/node_modules

clean-ota:
	cd $(OTA_DIR) && $(GO) clean .

distclean: clean
	rm -rf $(UI_DIR)/node_modules
	rm -rf $(DAEMON_DIR)/vendor
	rm -rf $(OTA_DIR)/vendor
	@echo "Full clean complete."
