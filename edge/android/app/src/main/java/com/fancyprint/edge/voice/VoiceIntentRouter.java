package com.fancyprint.edge.voice;

import com.fancyprint.edge.ContentModes;

import java.util.Locale;

public class VoiceIntentRouter {

    public VoiceIntentResult parse(String text) {
        String original = text == null ? "" : text.trim();
        String normalized = normalize(original);
        if (normalized.isEmpty()) {
            return VoiceIntentResult.askClarify("我没有听清楚，可以再说一遍吗");
        }

        if (containsAny(normalized, "变线稿", "切到线稿", "线稿模式", "涂色线稿", "我要涂色")) {
            return VoiceIntentResult.switchMode(ContentModes.UI_COLORING, "好，切到线稿模式");
        }
        if (containsAny(normalized, "变彩画", "彩画模式", "我要变彩画", "ai画画", "我要画画")) {
            return VoiceIntentResult.switchMode(ContentModes.UI_AI_CREATE, "好，切到变彩画模式");
        }
        if (containsAny(normalized, "安静书", "安静模式", "模板模式", "趣味模板")) {
            return VoiceIntentResult.switchMode(ContentModes.UI_TEMPLATE, "好，切到安静书模式");
        }
        if (containsAny(normalized, "小相册", "我的作品", "相册模式")) {
            return VoiceIntentResult.switchMode(ContentModes.UI_MY_WORKS, "好，打开小相册");
        }
        if (containsAny(normalized, "回主页", "回到主页", "返回主页", "返回首页", "主界面", "不玩了")) {
            return VoiceIntentResult.command(VoiceIntent.GO_HOME, "好，回到主页");
        }
        if (containsAny(normalized, "打印这张", "确认打印", "就要这个", "打印吧", "开始打印")) {
            return VoiceIntentResult.command(VoiceIntent.CONFIRM_PRINT, "好，这张准备打印");
        }
        if (containsAny(normalized, "取消", "不要了", "重新说", "重说", "再说一次")) {
            return VoiceIntentResult.command(VoiceIntent.CANCEL_CURRENT, "好，我们重新来");
        }
        if (containsAny(normalized, "你能做什么", "帮我", "帮助", "怎么玩", "怎么用")) {
            return VoiceIntentResult.command(VoiceIntent.HELP, "你可以说想画什么，也可以说切到线稿、返回主页或者打印这张");
        }

        return VoiceIntentResult.createImage(original);
    }

    private static String normalize(String text) {
        return text.toLowerCase(Locale.ROOT)
                .replaceAll("[\\s，。！？、,.!?;；:：\"'\u201C\u201D\u2018\u2019（）()]", "");
    }

    private static boolean containsAny(String text, String... keywords) {
        for (String keyword : keywords) {
            if (text.contains(normalize(keyword))) {
                return true;
            }
        }
        return false;
    }
}
