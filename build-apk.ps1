# Rebuilds the DA Fuel Android debug APK end to end, using the portable Java and
# the Android SDK set up on this machine. Run it from PowerShell:
#     powershell -ExecutionPolicy Bypass -File C:\DA-Bot\dafuel\build-apk.ps1
#
# Output: android\app\build\outputs\apk\debug\app-debug.apk

$ErrorActionPreference = 'Stop'

# --- toolchain locations ---
# JDK: prefer the portable one; fall back to the JDK bundled with Android Studio
# (this new laptop doesn't have the portable toolchain the old box used).
$jdkCandidates = @(
  'C:\DA-Bot\tools\jdk\jdk-21.0.11+10',
  'C:\Program Files\Android\Android Studio\jbr',
  "$env:LOCALAPPDATA\Programs\Android Studio\jbr"
)
$env:JAVA_HOME = $jdkCandidates | Where-Object { Test-Path (Join-Path $_ 'bin\java.exe') } | Select-Object -First 1
if (-not $env:JAVA_HOME) { throw 'No JDK 21 found. Install Android Studio or a JDK 21, or set JAVA_HOME.' }
Write-Host "Using JDK: $env:JAVA_HOME" -ForegroundColor DarkGray
$env:ANDROID_SDK_ROOT = 'C:\Users\tinas\AppData\Local\Android\Sdk'
$env:ANDROID_HOME     = $env:ANDROID_SDK_ROOT
$env:GRADLE_USER_HOME = 'C:\DA-Bot\gradle-home'

Write-Host 'building web app (uses .env.production for the backend URL)...' -ForegroundColor Cyan
Set-Location 'C:\DA-Bot\dafuel'
npm run build

Write-Host 'syncing web build into the Android project...' -ForegroundColor Cyan
npx cap sync android

Write-Host 'building the APK...' -ForegroundColor Cyan
Set-Location 'C:\DA-Bot\dafuel\android'
& '.\gradlew.bat' assembleDebug --no-daemon --console=plain

$apk = 'C:\DA-Bot\dafuel\android\app\build\outputs\apk\debug\app-debug.apk'
if (Test-Path $apk) {
    Write-Host "APK ready: $apk" -ForegroundColor Green
} else {
    Write-Host 'APK was not produced — check the Gradle output above.' -ForegroundColor Red
}
