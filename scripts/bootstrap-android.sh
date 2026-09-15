#!/bin/sh
set -eu

ANDROID_HOME="${SEMANTIFOLD_ANDROID_HOME:-/opt/semantifold-android-sdk}"
GRADLE_HOME="${SEMANTIFOLD_GRADLE_HOME:-/opt/gradle-8.13}"
GRADLE_USER_HOME="${SEMANTIFOLD_GRADLE_USER_HOME:-/opt/semantifold-gradle-cache}"
JAVA_HOME="${SEMANTIFOLD_JAVA_HOME:-/opt/semantifold-jdk-21.0.8}"
KOTLIN_HOME="${SEMANTIFOLD_KOTLIN_HOME:-/opt/kotlinc-2.2.10}"
BOOTSTRAP_ROOT="$(mktemp -d)"
trap 'rm -rf "$BOOTSTRAP_ROOT"' EXIT HUP INT TERM

test "$ANDROID_HOME" = /opt/semantifold-android-sdk
test "$GRADLE_HOME" = /opt/gradle-8.13
test "$GRADLE_USER_HOME" = /opt/semantifold-gradle-cache
test "$JAVA_HOME" = /opt/semantifold-jdk-21.0.8
test "$KOTLIN_HOME" = /opt/kotlinc-2.2.10
test "$(uname -m)" = x86_64
test "$(id -u)" != 0

curl --fail --silent --show-error --location --retry 5 --retry-delay 5 --retry-all-errors \
  'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.8%2B9/OpenJDK21U-jdk_x64_linux_hotspot_21.0.8_9.tar.gz' \
  --output "$BOOTSTRAP_ROOT/OpenJDK21U-jdk_x64_linux_hotspot_21.0.8_9.tar.gz"
printf '%s  %s\n' 'f2dc5418092c43003db8f9005c4a286e1c0104fea96ccdd49e8ebd037cac9219' \
  "$BOOTSTRAP_ROOT/OpenJDK21U-jdk_x64_linux_hotspot_21.0.8_9.tar.gz" | sha256sum --check -
sudo rm -rf "$JAVA_HOME"
sudo tar -xzf "$BOOTSTRAP_ROOT/OpenJDK21U-jdk_x64_linux_hotspot_21.0.8_9.tar.gz" -C /opt
sudo mv '/opt/jdk-21.0.8+9' "$JAVA_HOME"
test "$("$JAVA_HOME/bin/java" -version 2>&1 | sed -n '1p')" = 'openjdk version "21.0.8" 2025-07-15 LTS'

curl --fail --silent --show-error --location --retry 5 --retry-delay 5 --retry-all-errors \
  https://github.com/JetBrains/kotlin/releases/download/v2.2.10/kotlin-compiler-2.2.10.zip \
  --output "$BOOTSTRAP_ROOT/kotlin-compiler-2.2.10.zip"
printf '%s  %s\n' '302d1d8e671e5c3207e6ed62ff11fb555462a628e22a1158254dcaaf7e7394bc' \
  "$BOOTSTRAP_ROOT/kotlin-compiler-2.2.10.zip" | sha256sum --check -
mkdir "$BOOTSTRAP_ROOT/kotlin"
unzip -q "$BOOTSTRAP_ROOT/kotlin-compiler-2.2.10.zip" -d "$BOOTSTRAP_ROOT/kotlin"
sudo rm -rf "$KOTLIN_HOME"
sudo mv "$BOOTSTRAP_ROOT/kotlin/kotlinc" "$KOTLIN_HOME"
test "$(JAVA_HOME="$JAVA_HOME" "$KOTLIN_HOME/bin/kotlinc" -version 2>&1 | sed -n 's/^info: kotlinc-jvm \([^ ]*\).*/\1/p')" = 2.2.10

curl --fail --silent --show-error --location --retry 5 --retry-delay 5 --retry-all-errors \
  https://services.gradle.org/distributions/gradle-8.13-bin.zip --output "$BOOTSTRAP_ROOT/gradle-8.13-bin.zip"
printf '%s  %s\n' '20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed789' \
  "$BOOTSTRAP_ROOT/gradle-8.13-bin.zip" | sha256sum --check -
sudo rm -rf "$GRADLE_HOME"
sudo unzip -q "$BOOTSTRAP_ROOT/gradle-8.13-bin.zip" -d /opt
test "$GRADLE_HOME/bin/gradle" = /opt/gradle-8.13/bin/gradle

curl --fail --silent --show-error --location --retry 5 --retry-delay 5 --retry-all-errors \
  https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
  --output "$BOOTSTRAP_ROOT/commandlinetools-linux-11076708_latest.zip"
printf '%s  %s\n' '2d2d50857e4eb553af5a6dc3ad507a17adf43d115264b1afc116f95c92e5e258' \
  "$BOOTSTRAP_ROOT/commandlinetools-linux-11076708_latest.zip" | sha256sum --check -
sudo rm -rf "$ANDROID_HOME"
mkdir "$BOOTSTRAP_ROOT/cmdline"
unzip -q "$BOOTSTRAP_ROOT/commandlinetools-linux-11076708_latest.zip" -d "$BOOTSTRAP_ROOT/cmdline"
sudo install -d -m 0755 "$ANDROID_HOME/cmdline-tools"
sudo mv "$BOOTSTRAP_ROOT/cmdline/cmdline-tools" "$ANDROID_HOME/cmdline-tools/12.0"
sudo chown -R "$(id -u):$(id -g)" "$ANDROID_HOME"

SDKMANAGER="$ANDROID_HOME/cmdline-tools/12.0/bin/sdkmanager"
yes | "$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses >/dev/null
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" \
  'platform-tools' \
  'platforms;android-35' \
  'build-tools;35.0.0' \
  'emulator' \
  'system-images;android-35;google_apis;x86_64'
test "$("$ANDROID_HOME/emulator/emulator" -version 2>&1 | sed -n 's/^Android emulator version \([^ ]*\).*/\1/p')" = 35.6.12

AVD_NAME="${SEMANTIFOLD_ANDROID_AVD:-semantifold-api35}"
printf '%s\n' no | "$ANDROID_HOME/cmdline-tools/12.0/bin/avdmanager" create avd --force \
  --name "$AVD_NAME" --package 'system-images;android-35;google_apis;x86_64' --device pixel_6

sudo install -d -m 0755 "$GRADLE_USER_HOME"
sudo chown -R "$(id -u):$(id -g)" "$GRADLE_USER_HOME"
export ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME" GRADLE_USER_HOME JAVA_HOME
export SEMANTIFOLD_ANDROID_HOME="$ANDROID_HOME" SEMANTIFOLD_GRADLE_HOME="$GRADLE_HOME"
export SEMANTIFOLD_GRADLE_USER_HOME="$GRADLE_USER_HOME" SEMANTIFOLD_ANDROID_MODE=prepare
export SEMANTIFOLD_KOTLIN_HOME="$KOTLIN_HOME"
node scripts/android-acceptance.js
