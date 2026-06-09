package com.fancyprint.edge.storage;

import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.Index;
import androidx.room.PrimaryKey;

/**
 * PrintJobEntity — 打印任务 Room Entity
 *
 * 对应 doc/2 §13.4.2 离线队列
 *
 * 持久化打印任务以支持：
 * - 离线环境下保存任务
 * - 应用重启后恢复队列
 * - 任务历史追溯
 */
@Entity(
        tableName = "print_jobs",
        indices = {
                @Index(value = "job_id", unique = true),
                @Index(value = "status")
        }
)
public class PrintJobEntity {

    @PrimaryKey(autoGenerate = true)
    public long id;

    @ColumnInfo(name = "job_id")
    public String jobId;

    @ColumnInfo(name = "image_url")
    public String imageUrl;

    @ColumnInfo(name = "mode")
    public String mode; // color / lineart / pastel

    @ColumnInfo(name = "content_mode")
    public String contentMode; // coloring / papercut / dressup 等

    @ColumnInfo(name = "timeout_sec")
    public int timeoutSec;

    @ColumnInfo(name = "status")
    public String status; // queued / printing / done / failed / cancelled

    @ColumnInfo(name = "error_code")
    public int errorCode;

    @ColumnInfo(name = "progress")
    public int progress; // 0-100

    @ColumnInfo(name = "created_at")
    public long createdAt;

    @ColumnInfo(name = "updated_at")
    public long updatedAt;
}
