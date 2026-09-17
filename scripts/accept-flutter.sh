#!/bin/sh
set -eu

export SEMANTIFOLD_ANDROID_HOME="${SEMANTIFOLD_ANDROID_HOME:-/opt/semantifold-android-sdk}"
export SEMANTIFOLD_GRADLE_HOME="${SEMANTIFOLD_GRADLE_HOME:-/opt/gradle-8.14}"
export SEMANTIFOLD_GRADLE_USER_HOME="${SEMANTIFOLD_GRADLE_USER_HOME:-/opt/semantifold-gradle-cache}"
export SEMANTIFOLD_FLUTTER_HOME="${SEMANTIFOLD_FLUTTER_HOME:-/opt/semantifold-flutter-3.47.4}"
export SEMANTIFOLD_FLUTTER_PUB_CACHE="${SEMANTIFOLD_FLUTTER_PUB_CACHE:-/opt/semantifold-flutter-pub-cache}"
export JAVA_HOME="${SEMANTIFOLD_JAVA_HOME:-/opt/semantifold-jdk-21.0.8}"
export SEMANTIFOLD_FLUTTER_ACCEPTANCE_ROOT=/tmp/semantifold-flutter-acceptance
export SEMANTIFOLD_FLUTTER_MODE=offline-build
ACCEPTANCE_OUTPUT=/tmp/semantifold-flutter-acceptance.json

rm -rf /tmp/semantifold-flutter-acceptance
node scripts/flutter-acceptance.js > "$ACCEPTANCE_OUTPUT"
cat "$ACCEPTANCE_OUTPUT"

test -f /tmp/semantifold-flutter-acceptance/generated/flutter-app/build/app/outputs/flutter-apk/app-debug.apk
