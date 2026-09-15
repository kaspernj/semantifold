#!/bin/sh
set -eu

export SEMANTIFOLD_ANDROID_HOME="${SEMANTIFOLD_ANDROID_HOME:-/opt/semantifold-android-sdk}"
export SEMANTIFOLD_GRADLE_HOME="${SEMANTIFOLD_GRADLE_HOME:-/opt/gradle-8.13}"
export SEMANTIFOLD_GRADLE_USER_HOME="${SEMANTIFOLD_GRADLE_USER_HOME:-/opt/semantifold-gradle-cache}"
export SEMANTIFOLD_KOTLIN_HOME="${SEMANTIFOLD_KOTLIN_HOME:-/opt/kotlinc-2.2.10}"
export JAVA_HOME="${SEMANTIFOLD_JAVA_HOME:-/opt/semantifold-jdk-21.0.8}"
export SEMANTIFOLD_ANDROID_ACCEPTANCE_ROOT=/tmp/semantifold-android-acceptance
export SEMANTIFOLD_ANDROID_MODE=offline-build

rm -rf /tmp/semantifold-android-acceptance
node scripts/android-acceptance.js | tee /tmp/semantifold-android-acceptance.json

test -f /tmp/semantifold-android-acceptance/generated/android-app/app/build/outputs/apk/debug/app-debug.apk
test -f /tmp/semantifold-android-acceptance/generated/android-app/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
