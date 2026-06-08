plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.fancyprint.edge"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.fancyprint.edge"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        aidl = true
        compose = false
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // AndroidX Core
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.lifecycle:lifecycle-service:2.7.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")

    // UI - ConstraintLayout + RecyclerView
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("com.google.android.material:material:1.11.0")

    // Room (offline queue)
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // MQTT (Eclipse Paho)
    implementation("org.eclipse.paho:org.eclipse.paho.client.mqttv3:1.2.5")
    implementation("org.eclipse.paho:org.eclipse.paho.android.service:1.1.1")

    // JSON parsing
    implementation("com.google.code.gson:gson:2.10.1")

    // OkHttp for HTTPS API calls
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // WorkManager for background scheduling
    implementation("androidx.work:work-runtime-ktx:2.9.0")

    // Security Crypto (EncryptedSharedPreferences for Keystore-backed storage)
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Sherpa-ONNX — 本地离线语音识别（ASR）
    implementation(":sherpa-onnx@aar")

    // LMY CPCL SDK — 图片转CPCL打印机指令（排除 sherpa-onnx，避免与 :sherpa-onnx 模块冲突）
    implementation(fileTree("libs") { exclude("sherpa-onnx*") })

    // USB Serial — 增强USB打印机支持（usb-serial-for-android）
    implementation("com.github.mik3y:usb-serial-for-android:3.5.1")

    // Testing
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.mockito:mockito-core:5.10.0")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
}
