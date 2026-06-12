package com.fancyprint.edge.voice;

import com.fancyprint.edge.ContentModes;

import org.junit.Test;

import static org.junit.Assert.*;

public class VoiceIntentRouterTest {

    private final VoiceIntentRouter router = new VoiceIntentRouter();

    @Test
    public void parse_switchesToColoringMode() {
        VoiceIntentResult result = router.parse("切到线稿模式");

        assertEquals(VoiceIntent.SWITCH_MODE, result.intent);
        assertEquals(ContentModes.UI_COLORING, result.contentMode);
        assertTrue(result.confidence >= 0.9f);
        assertFalse(result.shouldCreateImage());
    }

    @Test
    public void parse_confirmsPrintCommand() {
        VoiceIntentResult result = router.parse("就要这个，打印这张");

        assertEquals(VoiceIntent.CONFIRM_PRINT, result.intent);
        assertTrue(result.confidence >= 0.9f);
        assertFalse(result.shouldCreateImage());
    }

    @Test
    public void parse_creationPromptKeepsPromptText() {
        VoiceIntentResult result = router.parse("画一只穿裙子的兔子");

        assertEquals(VoiceIntent.CREATE_IMAGE, result.intent);
        assertEquals("画一只穿裙子的兔子", result.prompt);
        assertTrue(result.shouldCreateImage());
    }

    @Test
    public void parse_goHomeCommand() {
        VoiceIntentResult result = router.parse("回到主页");

        assertEquals(VoiceIntent.GO_HOME, result.intent);
        assertFalse(result.shouldCreateImage());
    }

    @Test
    public void parse_cancelCommand() {
        VoiceIntentResult result = router.parse("不要了，重新说");

        assertEquals(VoiceIntent.CANCEL_CURRENT, result.intent);
        assertFalse(result.shouldCreateImage());
    }

    @Test
    public void parse_helpCommand() {
        VoiceIntentResult result = router.parse("帮我一下");

        assertEquals(VoiceIntent.HELP, result.intent);
        assertTrue(result.replyText.contains("切到线稿"));
        assertFalse(result.shouldCreateImage());
    }

    @Test
    public void parse_switchesToTemplateMode() {
        VoiceIntentResult result = router.parse("打开安静书");

        assertEquals(VoiceIntent.SWITCH_MODE, result.intent);
        assertEquals(ContentModes.UI_TEMPLATE, result.contentMode);
    }

    @Test
    public void parse_switchesToAlbumMode() {
        VoiceIntentResult result = router.parse("我的作品");

        assertEquals(VoiceIntent.SWITCH_MODE, result.intent);
        assertEquals(ContentModes.UI_MY_WORKS, result.contentMode);
    }

    @Test
    public void parse_emptyTextAsksClarify() {
        VoiceIntentResult result = router.parse("  ");

        assertEquals(VoiceIntent.ASK_CLARIFY, result.intent);
        assertFalse(result.shouldCreateImage());
        assertNotNull(result.replyText);
    }

    @Test
    public void result_serializesToJson() throws Exception {
        VoiceIntentResult result = router.parse("我要变彩画");
        String json = result.toJson();

        org.json.JSONObject obj = new org.json.JSONObject(json);
        assertEquals(VoiceIntent.SWITCH_MODE, obj.getString("intent"));
        assertEquals(ContentModes.UI_AI_CREATE, obj.getString("contentMode"));
        assertTrue(obj.getDouble("confidence") >= 0.9d);
    }
}
