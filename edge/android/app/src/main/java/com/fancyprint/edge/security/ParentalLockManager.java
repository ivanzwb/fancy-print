package com.fancyprint.edge.security;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import java.security.MessageDigest;
import java.security.SecureRandom;

/**
 * ParentalLockManager — 家长锁管理器
 *
 * 对应 doc/2 §13.5.2 儿童场景的 Android 特有优势
 *
 * 职责：
 * - PIN 码设置与校验（SHA-256 哈希存储，不存明文）
 * - Lock Task Mode 的激活与退出（与 DeviceAdminReceiver 配合）
 * - 家长锁状态查询
 *
 * 安全设计：
 * - PIN 不入日志
 * - 本地仅存储 SHA-256(salt + PIN) 哈希
 * - 连续失败 N 次后增加冷却时间
 */
public class ParentalLockManager {

    private static final String TAG = "ParentalLockManager";
    private static final String PREFS_NAME = "parental_lock_prefs";
    private static final String KEY_PIN_HASH = "pin_hash";
    private static final String KEY_PIN_SALT = "pin_salt";
    private static final String KEY_ENABLED = "lock_enabled";
    private static final String KEY_FAIL_COUNT = "fail_count";
    private static final String KEY_LOCKOUT_UNTIL = "lockout_until";
    private static final int MAX_FAIL_ATTEMPTS = 5;
    private static final long LOCKOUT_DURATION_MS = 60000; // 1 分钟锁定

    private final SharedPreferences prefs;
    private final SecureRandom secureRandom;

    public ParentalLockManager(Context context) {
        this.prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        this.secureRandom = new SecureRandom();
    }

    /**
     * 设置 PIN 码
     * @param oldPin 旧 PIN（首次设置传 null 或空字符串）
     * @param newPin 新 PIN
     * @return 是否成功
     */
    public boolean setPin(String oldPin, String newPin) {
        // 验证旧 PIN（如果已设置）
        if (isPinSet() && !validatePinInternal(oldPin != null ? oldPin : "")) {
            Log.w(TAG, "setPin failed: old PIN incorrect");
            return false;
        }

        if (newPin == null || newPin.length() < 4 || newPin.length() > 8) {
            Log.w(TAG, "setPin failed: invalid PIN length");
            return false;
        }

        // 生成新 salt + hash
        byte[] salt = new byte[16];
        secureRandom.nextBytes(salt);
        String saltHex = bytesToHex(salt);
        String hash = hashPin(newPin, saltHex);

        prefs.edit()
                .putString(KEY_PIN_SALT, saltHex)
                .putString(KEY_PIN_HASH, hash)
                .putBoolean(KEY_ENABLED, true)
                .putInt(KEY_FAIL_COUNT, 0)
                .putLong(KEY_LOCKOUT_UNTIL, 0)
                .apply();

        Log.i(TAG, "Parent PIN set successfully");
        return true;
    }

    /**
     * 验证 PIN 码
     */
    public boolean validatePin(String pin) {
        if (!isPinSet()) {
            return true; // 未设置 PIN 默认通过
        }

        // 检查是否在锁定期
        long lockoutUntil = prefs.getLong(KEY_LOCKOUT_UNTIL, 0);
        if (lockoutUntil > System.currentTimeMillis()) {
            Log.w(TAG, "PIN locked out for " +
                    (lockoutUntil - System.currentTimeMillis()) / 1000 + "s");
            return false;
        }

        boolean valid = validatePinInternal(pin);
        if (valid) {
            prefs.edit().putInt(KEY_FAIL_COUNT, 0).apply();
        } else {
            int failCount = prefs.getInt(KEY_FAIL_COUNT, 0) + 1;
            prefs.edit().putInt(KEY_FAIL_COUNT, failCount).apply();
            if (failCount >= MAX_FAIL_ATTEMPTS) {
                prefs.edit().putLong(KEY_LOCKOUT_UNTIL,
                        System.currentTimeMillis() + LOCKOUT_DURATION_MS).apply();
                Log.w(TAG, "PIN locked out for 60s due to " + failCount + " failures");
            }
        }

        return valid;
    }

    /**
     * 家长锁是否已启用
     */
    public boolean isEnabled() {
        return prefs.getBoolean(KEY_ENABLED, false) && isPinSet();
    }

    /**
     * 启用/禁用家长锁
     */
    public void setEnabled(boolean enabled) {
        prefs.edit()
                .putBoolean(KEY_ENABLED, enabled)
                .apply();
        Log.i(TAG, "Parent lock " + (enabled ? "enabled" : "disabled"));
    }

    /**
     * 退出锁状态（清除失败计数）
     */
    public void resetLockout() {
        prefs.edit()
                .putInt(KEY_FAIL_COUNT, 0)
                .putLong(KEY_LOCKOUT_UNTIL, 0)
                .apply();
    }

    /**
     * 重置所有家长锁数据（FactoryReset 使用）
     */
    public void reset() {
        prefs.edit()
                .remove(KEY_PIN_HASH)
                .remove(KEY_PIN_SALT)
                .putBoolean(KEY_ENABLED, false)
                .putInt(KEY_FAIL_COUNT, 0)
                .putLong(KEY_LOCKOUT_UNTIL, 0)
                .apply();
        Log.i(TAG, "Parental lock data reset");
    }

    // ============================================================
    // 内部方法
    // ============================================================

    private boolean isPinSet() {
        return prefs.contains(KEY_PIN_HASH) && prefs.contains(KEY_PIN_SALT);
    }

    private boolean validatePinInternal(String pin) {
        String saltHex = prefs.getString(KEY_PIN_SALT, "");
        String storedHash = prefs.getString(KEY_PIN_HASH, "");
        String inputHash = hashPin(pin, saltHex);
        return storedHash.equals(inputHash);
    }

    private String hashPin(String pin, String saltHex) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(saltHex.getBytes());
            byte[] hash = md.digest(pin.getBytes());
            return bytesToHex(hash);
        } catch (Exception e) {
            Log.e(TAG, "Hash error", e);
            return "";
        }
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
