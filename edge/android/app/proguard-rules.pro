# FancyPrint Edge Android ProGuard Rules

# Keep AIDL interfaces
-keep class com.fancyprint.edge.IEdgeDaemonService { *; }
-keep class com.fancyprint.edge.IPrintJobCallback { *; }

# Keep Room entities, DAOs, and Database
-keep class com.fancyprint.edge.storage.PrintJobEntity { *; }
-keep class com.fancyprint.edge.storage.PrintJobDao { *; }
-keep class com.fancyprint.edge.storage.JobDatabase { *; }
-keep class * extends androidx.room.RoomDatabase { *; }
-dontwarn androidx.room.**

# Keep OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Keep MQTT
-keep class org.eclipse.paho.** { *; }
-dontwarn org.eclipse.paho.**

# Keep Gson
-keep class com.google.gson.** { *; }
-keepattributes Signature
-keepattributes *Annotation*
