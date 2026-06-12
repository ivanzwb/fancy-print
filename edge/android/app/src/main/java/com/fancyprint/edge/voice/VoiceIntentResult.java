package com.fancyprint.edge.voice;

import org.json.JSONException;
import org.json.JSONObject;

public class VoiceIntentResult {
    public final String intent;
    public final float confidence;
    public final String contentMode;
    public final String prompt;
    public final String replyText;

    public VoiceIntentResult(String intent, float confidence, String contentMode,
                             String prompt, String replyText) {
        this.intent = intent;
        this.confidence = confidence;
        this.contentMode = contentMode;
        this.prompt = prompt;
        this.replyText = replyText;
    }

    public static VoiceIntentResult switchMode(String contentMode, String replyText) {
        return new VoiceIntentResult(VoiceIntent.SWITCH_MODE, 0.95f, contentMode, "", replyText);
    }

    public static VoiceIntentResult command(String intent, String replyText) {
        return new VoiceIntentResult(intent, 0.95f, "", "", replyText);
    }

    public static VoiceIntentResult createImage(String prompt) {
        return new VoiceIntentResult(VoiceIntent.CREATE_IMAGE, 0.75f, "", prompt, "好，我来画出来");
    }

    public static VoiceIntentResult askClarify(String replyText) {
        return new VoiceIntentResult(VoiceIntent.ASK_CLARIFY, 0.2f, "", "", replyText);
    }

    public boolean shouldCreateImage() {
        return VoiceIntent.CREATE_IMAGE.equals(intent) && prompt != null && !prompt.isEmpty();
    }

    public String toJson() {
        JSONObject json = new JSONObject();
        try {
            json.put("intent", intent);
            json.put("confidence", confidence);
            json.put("contentMode", contentMode == null ? "" : contentMode);
            json.put("prompt", prompt == null ? "" : prompt);
            json.put("replyText", replyText == null ? "" : replyText);
        } catch (JSONException ignored) {
            // JSONObject with primitive strings should not fail, but keep AIDL callbacks resilient.
        }
        return json.toString();
    }
}
