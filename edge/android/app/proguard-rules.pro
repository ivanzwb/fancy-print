# FancyPrint Edge Android ProGuard Rules

# Keep AIDL interfaces
-keep class com.fancyprint.edge.IEdgeDaemonService { *; }
-keep class com.fancyprint.edge.IPrintJobCallback { *; }
-keep class com.fancyprint.edge.IAsrCallback { *; }

# Keep Sherpa-ONNX JNI classes (com.k2fsa.sherpa.onnx.*)
-keep class com.k2fsa.sherpa.onnx.** { *; }
-keep class com.k2fsa.sherpa.onnx.OnlineRecognizer { *; }
-keep class com.k2fsa.sherpa.onnx.OnlineStream { *; }
-keep class com.k2fsa.sherpa.onnx.OnlineRecognizerConfig { *; }
-keep class com.k2fsa.sherpa.onnx.OnlineModelConfig { *; }
-keep class com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig { *; }
-dontwarn com.k2fsa.sherpa.onnx.**

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

# Keep CPCL SDK (com.lingmoyun.instruction.cpcl.*)
-keep class com.lingmoyun.instruction.** { *; }
-keep class com.lingmoyun.instruction.cpcl.** { *; }
-dontwarn com.lingmoyun.instruction.**

# Keep USB Serial drivers
-keep class com.hoho.android.usbserial.** { *; }
-dontwarn com.hoho.android.usbserial.**

# Keep printer utilities
-keep class com.fancyprint.edge.print.BitmapUtils { *; }
-keep class com.fancyprint.edge.print.HexByteUtils { *; }
-keep class com.fancyprint.edge.print.PrinterOrder { *; }
-keep class com.fancyprint.edge.print.mdns.** { *; }
