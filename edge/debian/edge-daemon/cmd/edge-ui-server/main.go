// edge-ui-server — 奇想印印端侧儿童触屏 UI 静态文件 HTTP 服务
//
// 提供 React 构建产物（dist/）的 HTTP 服务，
// 供 kiosk 浏览器（WPE WebKit / Chromium kiosk 模式）加载。
//
// 对应 doc/3 §2.1 进程模型：fancy-print-ui 子进程
//
// 运行方式：
//   ./edge-ui-server -addr :3000 -root /usr/share/fancy-print-ui
//
// 交叉编译：
//   GOOS=linux GOARCH=arm64 go build -o edge-ui-server-arm64 ./cmd/edge-ui-server/

package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

var (
	addr     = flag.String("addr", ":3000", "监听地址")
	root     = flag.String("root", "", "静态文件根目录（必填）")
	cacheMax = flag.Int("cache-max-age", 3600, "静态资源 Cache-Control max-age（秒）")
)

const version = "0.1.0"

func main() {
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	if *root == "" {
		slog.Error("root directory is required")
		fmt.Fprintf(os.Stderr, "Usage: edge-ui-server -root <path>\n")
		os.Exit(1)
	}

	absRoot, err := filepath.Abs(*root)
	if err != nil {
		slog.Error("invalid root path", "path", *root, "error", err)
		os.Exit(1)
	}

	// 验证根目录存在
	if info, err := os.Stat(absRoot); err != nil || !info.IsDir() {
		slog.Error("root directory does not exist or is not a directory", "path", absRoot)
		os.Exit(1)
	}

	slog.Info("starting edge-ui-server", "version", version, "addr", *addr, "root", absRoot)

	// 文件服务器（SPA 友好：所有非文件路由返回 index.html）
	fs := http.FileServer(http.Dir(absRoot))
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 尝试直接提供文件
		target := filepath.Join(absRoot, r.URL.Path)
		if _, err := os.Stat(target); err == nil {
			w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d", *cacheMax))
			fs.ServeHTTP(w, r)
			return
		}
		// SPA fallback: 返回 index.html
		http.ServeFile(w, r, filepath.Join(absRoot, "index.html"))
	})

	server := &http.Server{
		Addr:         *addr,
		Handler:      handler,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// 优雅关闭
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT)

	go func() {
		slog.Info("HTTP server listening", "addr", *addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("HTTP server error", "error", err)
			os.Exit(1)
		}
	}()

	sig := <-quit
	slog.Info("received signal, shutting down", "signal", sig.String())

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	server.Shutdown(shutdownCtx)
	slog.Info("edge-ui-server stopped")
}
