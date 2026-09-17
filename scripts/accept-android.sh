#!/bin/sh
set -eu

export SEMANTIFOLD_ANDROID_HOME="${SEMANTIFOLD_ANDROID_HOME:-/opt/semantifold-android-sdk}"
export SEMANTIFOLD_GRADLE_HOME="${SEMANTIFOLD_GRADLE_HOME:-/opt/gradle-8.14}"
export SEMANTIFOLD_GRADLE_USER_HOME="${SEMANTIFOLD_GRADLE_USER_HOME:-/opt/semantifold-gradle-cache}"
export SEMANTIFOLD_KOTLIN_HOME="${SEMANTIFOLD_KOTLIN_HOME:-/opt/kotlinc-2.2.10}"
export JAVA_HOME="${SEMANTIFOLD_JAVA_HOME:-/opt/semantifold-jdk-21.0.8}"
export SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT="${SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT:-/tmp/semantifold-android-acceptance}"
export SEMANTIFOLD_ANDROID_MODE=offline-build
ACCEPTANCE_OUTPUT="${SEMANTIFOLD_ANDROID_ACCEPTANCE_OUTPUT:-${SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT}.json}"

rm -rf "$SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT"
node scripts/android-acceptance.js > "$ACCEPTANCE_OUTPUT"
cat "$ACCEPTANCE_OUTPUT"

test -f "$SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT/generated/android-app/app/build/outputs/apk/debug/app-debug.apk"
test -f "$SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT/generated/android-app/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
