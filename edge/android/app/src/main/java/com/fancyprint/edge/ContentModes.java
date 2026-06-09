package com.fancyprint.edge;

/**
 * 与 Web fancy-print-ui {@code ContentMode} 对齐的字符串常量，
 * 并将 UI 模式映射为 device-api 策略允许的 {@code content_mode}（见 {@code PolicyService}）。
 */
public final class ContentModes {

    public static final String UI_AI_CREATE = "ai_create";
    public static final String UI_COLORING = "coloring";
    public static final String UI_TEMPLATE = "template";
    public static final String UI_MY_WORKS = "my_works";

    private ContentModes() {}

    /**
     * 将 UI 模式映射为云端创建 Job 时使用的 content_mode（须在 policy 允许列表内）。
     */
    public static String uiModeToCloudContentMode(String uiMode) {
        if (uiMode == null) {
            return "coloring_quiet_book";
        }
        switch (uiMode) {
            case UI_AI_CREATE:
                return "dress_up";
            case UI_COLORING:
                return "coloring_quiet_book";
            case UI_TEMPLATE:
                return "paper_craft";
            case UI_MY_WORKS:
                return "paper_craft";
            default:
                return "coloring_quiet_book";
        }
    }
}
