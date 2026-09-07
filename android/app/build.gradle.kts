import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val versionProps = Properties().apply {
    rootProject.file("version.properties").inputStream().use(::load)
}

val keystoreProps = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.isFile) {
        file.inputStream().use(::load)
    }
}

fun secret(env: String, key: String): String? =
    System.getenv(env)?.takeIf { it.isNotBlank() } ?: keystoreProps.getProperty(key)?.takeIf { it.isNotBlank() }

fun resolveStoreFile(path: String): File? {
    val candidates = listOf(file(path), rootProject.file(path), File(path))
    return candidates.firstOrNull { it.isFile }
}

val releaseStoreFile = secret("ANDROID_KEYSTORE", "storeFile")?.let(::resolveStoreFile)

android {
    namespace = "com.quickerhub.nearbox"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.quickerhub.nearbox"
        minSdk = 26
        targetSdk = 35
        versionCode = versionProps.getProperty("VERSION_CODE").toInt()
        versionName = versionProps.getProperty("VERSION_NAME")
    }
    signingConfigs {
        if (releaseStoreFile != null) {
            create("release") {
                storeFile = releaseStoreFile
                storePassword = secret("ANDROID_KEYSTORE_PASSWORD", "storePassword")
                    ?: error("缺少 ANDROID_KEYSTORE_PASSWORD / storePassword")
                keyAlias = secret("ANDROID_KEY_ALIAS", "keyAlias")
                    ?: error("缺少 ANDROID_KEY_ALIAS / keyAlias")
                keyPassword = secret("ANDROID_KEY_PASSWORD", "keyPassword")
                    ?: error("缺少 ANDROID_KEY_PASSWORD / keyPassword")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
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
        viewBinding = true
    }
}

afterEvaluate {
    tasks.named("assembleRelease").configure {
        doFirst {
            check(android.signingConfigs.findByName("release")?.storeFile?.isFile == true) {
                "正式包必须用固定签名。设置 ANDROID_KEYSTORE* 环境变量，或在 android/keystore.properties 里指向 release.keystore。调试证书每次 CI 都会变，手机无法覆盖安装。"
            }
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
