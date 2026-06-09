package com.fancyprint.edge.storage;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;
import androidx.sqlite.db.SupportSQLiteDatabase;

import java.util.concurrent.Executors;

/**
 * JobDatabase — Room 数据库
 *
 * 存储打印任务、设备配置等持久化数据
 */
@Database(
        entities = {PrintJobEntity.class},
        version = 1,
        exportSchema = false
)
public abstract class JobDatabase extends RoomDatabase {

    private static final String DB_NAME = "fancy_print_edge.db";
    private static volatile JobDatabase instance;

    public abstract PrintJobDao printJobDao();

    public static JobDatabase getInstance(Context context) {
        if (instance == null) {
            synchronized (JobDatabase.class) {
                if (instance == null) {
                    instance = Room.databaseBuilder(
                            context.getApplicationContext(),
                            JobDatabase.class,
                            DB_NAME
                    )
                    .allowMainThreadQueries()
                    .addCallback(new Callback() {
                        @Override
                        public void onCreate(@NonNull SupportSQLiteDatabase db) {
                            super.onCreate(db);
                            // 数据库创建时的初始化（如需要）
                        }
                    })
                    .build();
                }
            }
        }
        return instance;
    }
}
