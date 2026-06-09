package com.fancyprint.edge.storage;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;
import androidx.room.Update;

import java.util.List;

/**
 * PrintJobDao — 打印任务 Room DAO
 */
@Dao
public interface PrintJobDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    long insert(PrintJobEntity entity);

    @Update
    void update(PrintJobEntity entity);

    @Query("SELECT * FROM print_jobs WHERE job_id = :jobId LIMIT 1")
    PrintJobEntity getByJobId(String jobId);

    @Query("SELECT * FROM print_jobs WHERE status = :status ORDER BY created_at ASC")
    List<PrintJobEntity> getByStatus(String status);

    @Query("SELECT * FROM print_jobs WHERE status = 'queued' ORDER BY created_at ASC")
    List<PrintJobEntity> getQueuedJobs();

    @Query("SELECT * FROM print_jobs ORDER BY created_at DESC")
    List<PrintJobEntity> getAllJobs();

    @Query("UPDATE print_jobs SET status = :status, updated_at = :updatedAt WHERE job_id = :jobId")
    void updateStatus(String jobId, String status, long updatedAt);

    @Query("UPDATE print_jobs SET error_code = :errorCode WHERE job_id = :jobId")
    void updateErrorCode(String jobId, int errorCode);

    @Query("UPDATE print_jobs SET progress = :progress WHERE job_id = :jobId")
    void updateProgress(String jobId, int progress);

    @Query("DELETE FROM print_jobs WHERE job_id = :jobId")
    void deleteByJobId(String jobId);

    @Query("DELETE FROM print_jobs")
    void deleteAll();

    @Query("DELETE FROM print_jobs WHERE updated_at < :cutoff AND status IN ('done', 'failed', 'cancelled')")
    int deleteOlderThan(long cutoff);

    @Query("SELECT COUNT(*) FROM print_jobs WHERE status = 'queued'")
    int getQueuedCount();
}
