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
printf '%s  %s\n' '20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78' \
  "$BOOTSTRAP_ROOT/gradle-8.13-bin.zip" | sha256sum --check -
sudo rm -rf "$GRADLE_HOME"
sudo unzip -q "$BOOTSTRAP_ROOT/gradle-8.13-bin.zip" -d /opt
test "$GRADLE_HOME/bin/gradle" = /opt/gradle-8.13/bin/gradle

curl --fail --silent --show-error --location --retry 5 --retry-delay 5 --retry-all-errors \
  https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
  --output "$BOOTSTRAP_ROOT/commandlinetools-linux-11076708_latest.zip"
printf '%s  %s\n' '2d2d50857e4eb553af5a6dc3ad507a17adf43d115264b1afc116f95c92e5e258' \
  "$BOOTSTRAP_ROOT/commandlinetools-linux-11076708_latest.zip" | sha256sum --check -

download_android_archive() {
  archive=$1
  sha256=$2
  url=$3

  curl --fail --silent --show-error --location --retry 5 --retry-delay 5 --retry-all-errors \
    "$url" --output "$BOOTSTRAP_ROOT/$archive"
  printf '%s  %s\n' "$sha256" "$BOOTSTRAP_ROOT/$archive" | sha256sum --check -
}

download_android_archive platform-tools_r37.0.1-linux.zip \
  d230f13842f60f782a8645f9c813f8f845bf36089ea7289f28c48f17979313f1 \
  https://dl.google.com/android/repository/platform-tools_r37.0.1-linux.zip
download_android_archive platform-35_r02.zip \
  0988cacad01b38a18a47bac14a0695f246bc76c1b06c0eeb8eb0dc825ab0c8e0 \
  https://dl.google.com/android/repository/platform-35_r02.zip
download_android_archive build-tools_r35_linux.zip \
  bd3a4966912eb8b30ed0d00b0cda6b6543b949d5ffe00bea54c04c81e1561d88 \
  https://dl.google.com/android/repository/build-tools_r35_linux.zip
download_android_archive emulator-linux_x64-13610412.zip \
  2fe2b56fe93ce75e1d478a40162131381d911c355efeaedb54dd1e0d0897a5cf \
  https://edgedl.me.gvt1.com/edgedl/android/repository/emulator-linux_x64-13610412.zip
download_android_archive x86_64-35_r09.zip \
  c67b9ba0ff5bc0eb6d046871bfa228af14d4d47b02f0cdae94f048e511b7566e \
  https://dl.google.com/android/repository/sys-img/google_apis/x86_64-35_r09.zip

for directory in cmdline platform-tools platform build-tools emulator system-image; do
  mkdir "$BOOTSTRAP_ROOT/$directory"
done
unzip -q "$BOOTSTRAP_ROOT/commandlinetools-linux-11076708_latest.zip" -d "$BOOTSTRAP_ROOT/cmdline"
unzip -q "$BOOTSTRAP_ROOT/platform-tools_r37.0.1-linux.zip" -d "$BOOTSTRAP_ROOT/platform-tools"
unzip -q "$BOOTSTRAP_ROOT/platform-35_r02.zip" -d "$BOOTSTRAP_ROOT/platform"
unzip -q "$BOOTSTRAP_ROOT/build-tools_r35_linux.zip" -d "$BOOTSTRAP_ROOT/build-tools"
unzip -q "$BOOTSTRAP_ROOT/emulator-linux_x64-13610412.zip" -d "$BOOTSTRAP_ROOT/emulator"
unzip -q "$BOOTSTRAP_ROOT/x86_64-35_r09.zip" -d "$BOOTSTRAP_ROOT/system-image"

sudo rm -rf "$ANDROID_HOME"
sudo install -d -m 0755 "$ANDROID_HOME/cmdline-tools" "$ANDROID_HOME/platforms" "$ANDROID_HOME/build-tools" \
  "$ANDROID_HOME/system-images/android-35/google_apis"
sudo mv "$BOOTSTRAP_ROOT/cmdline/cmdline-tools" "$ANDROID_HOME/cmdline-tools/12.0"
sudo mv "$BOOTSTRAP_ROOT/platform-tools/platform-tools" "$ANDROID_HOME/platform-tools"
sudo mv "$BOOTSTRAP_ROOT/platform/android-35" "$ANDROID_HOME/platforms/android-35"
sudo mv "$BOOTSTRAP_ROOT/build-tools/android-15" "$ANDROID_HOME/build-tools/35.0.0"
sudo mv "$BOOTSTRAP_ROOT/emulator/emulator" "$ANDROID_HOME/emulator"
sudo mv "$BOOTSTRAP_ROOT/system-image/x86_64" "$ANDROID_HOME/system-images/android-35/google_apis/x86_64"
sudo chown -R "$(id -u):$(id -g)" "$ANDROID_HOME"
install -m 0644 scripts/android-emulator-package.xml "$ANDROID_HOME/emulator/package.xml"

grep -Fqx 'Pkg.Revision=37.0.1' "$ANDROID_HOME/platform-tools/source.properties"
grep -Fqx 'Pkg.Revision=2' "$ANDROID_HOME/platforms/android-35/source.properties"
grep -Fqx 'AndroidVersion.ApiLevel=35' "$ANDROID_HOME/platforms/android-35/source.properties"
grep -Fqx 'Pkg.Revision=35.0.0' "$ANDROID_HOME/build-tools/35.0.0/source.properties"
grep -Fqx 'Pkg.Revision=35.6.11' "$ANDROID_HOME/emulator/source.properties"
grep -Fqx 'Pkg.BuildId=13610412' "$ANDROID_HOME/emulator/source.properties"
grep -Fqx 'Pkg.Revision=9' "$ANDROID_HOME/system-images/android-35/google_apis/x86_64/source.properties"
grep -Fqx 'AndroidVersion.ApiLevel=35' "$ANDROID_HOME/system-images/android-35/google_apis/x86_64/source.properties"
grep -Fqx 'SystemImage.Abi=x86_64' "$ANDROID_HOME/system-images/android-35/google_apis/x86_64/source.properties"
grep -Fqx 'SystemImage.TagId=google_apis' "$ANDROID_HOME/system-images/android-35/google_apis/x86_64/source.properties"
test "$("$ANDROID_HOME/emulator/emulator" -version 2>&1 | sed -n 's/^Android emulator version \([^ ]*\).*/\1/p')" = 35.6.11.0

AVD_NAME="${SEMANTIFOLD_ANDROID_AVD:-semantifold-api35}"
export ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME"
printf '%s\n' no | "$ANDROID_HOME/cmdline-tools/12.0/bin/avdmanager" create avd --force \
  --name "$AVD_NAME" --package 'system-images;android-35;google_apis;x86_64' --device pixel_6

sudo install -d -m 0755 "$GRADLE_USER_HOME"
sudo chown -R "$(id -u):$(id -g)" "$GRADLE_USER_HOME"
export GRADLE_USER_HOME JAVA_HOME
export SEMANTIFOLD_ANDROID_HOME="$ANDROID_HOME" SEMANTIFOLD_GRADLE_HOME="$GRADLE_HOME"
export SEMANTIFOLD_GRADLE_USER_HOME="$GRADLE_USER_HOME" SEMANTIFOLD_ANDROID_MODE=prepare
export SEMANTIFOLD_KOTLIN_HOME="$KOTLIN_HOME"
node scripts/android-acceptance.js
