#!/bin/sh
set -eu
umask 077

ANDROID_HOME="${SEMANTIFOLD_ANDROID_HOME:-/opt/semantifold-android-sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
EMULATOR="$ANDROID_HOME/emulator/emulator"
AVD_NAME="${SEMANTIFOLD_ANDROID_AVD:-semantifold-api35}"
SERIAL=emulator-5580
PORT=5580
ANDROID_ADB_SERVER_PORT=5038
export ANDROID_ADB_SERVER_PORT
ACCEPTANCE_ROOT=/tmp/semantifold-android-acceptance
PROJECT="$ACCEPTANCE_ROOT/generated/android-app"
APK="$PROJECT/app/build/outputs/apk/debug/app-debug.apk"
TEST_APK="$PROJECT/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
ARTIFACTS="$ACCEPTANCE_ROOT/emulator-artifacts"
EXPECTED_OUTPUT_BASE64='aMOp8J+YgApow6nwn5iAIQpow6nwn5iAIT8='
EMULATOR_PID=
EXIT_REASON=unclassified
LOCK=/tmp/semantifold-android-5580-5581-5038.lock

mkdir -p "$ARTIFACTS"

print_failure_artifact() {
  artifact=$1
  test -f "$ARTIFACTS/$artifact" || return 0
  printf '%s\n' "--- $artifact (last 16384 bytes) ---" >&2
  tail -c 16384 "$ARTIFACTS/$artifact" >&2
  printf '\n' >&2
}

capture_failure() {
  status=$?
  trap - EXIT HUP INT TERM
  set +e
  printf '%s\n' "$EXIT_REASON" > "$ARTIFACTS/exit-reason.txt"
  timeout 15 "$ADB" devices -l > "$ARTIFACTS/adb-state.txt" 2>&1
  timeout 15 "$ADB" -s "$SERIAL" logcat -d > "$ARTIFACTS/logcat.txt" 2>&1
  ps -ef | grep '[e]mulator' > "$ARTIFACTS/emulator-command-line.txt" 2>&1
  if test -n "$EMULATOR_PID"; then
    kill "$EMULATOR_PID" 2>/dev/null
    attempts=0
    while kill -0 "$EMULATOR_PID" 2>/dev/null && test "$attempts" -lt 10; do attempts=$((attempts + 1)); sleep 1; done
    kill -KILL "$EMULATOR_PID" 2>/dev/null
    wait "$EMULATOR_PID" 2>/dev/null
  fi
  timeout 15 "$ADB" kill-server >/dev/null 2>&1
  rm -rf "$ACCEPTANCE_ROOT/generated"
  rm -f "$ACCEPTANCE_ROOT/debug.keystore"
  printf 'SEMANTIFOLD_ANDROID_EMULATOR_FAILURE: %s (exit status %s)\n' "$EXIT_REASON" "$status" >&2
  for artifact in accel-check.txt adb-state.txt emulator-first.log instrumentation-first.txt \
    emulator-second.log instrumentation-second.txt logcat.txt; do
    print_failure_artifact "$artifact"
  done
  exit "$status"
}
trap capture_failure EXIT HUP INT TERM

test -c /dev/kvm || { EXIT_REASON='KVM character device is unavailable'; exit 2; }
test -r /dev/kvm && test -w /dev/kvm || { EXIT_REASON='KVM is not readable and writable by the TensorBuzz user'; exit 2; }
"$EMULATOR" -accel-check > "$ARTIFACTS/accel-check.txt" 2>&1 || { EXIT_REASON='emulator -accel-check failed'; exit 2; }
grep -Eiq 'accel|KVM.*(usable|installed|working)' "$ARTIFACTS/accel-check.txt" || { EXIT_REASON='KVM acceleration was not affirmed'; exit 2; }
test -f "$APK" && test -f "$TEST_APK" || { EXIT_REASON='offline Android APK outputs are missing'; exit 2; }
command -v flock >/dev/null 2>&1 || { EXIT_REASON='flock is unavailable for fixed emulator port ownership'; exit 2; }
command -v timeout >/dev/null 2>&1 || { EXIT_REASON='timeout is unavailable for bounded Android commands'; exit 2; }
exec 9>"$LOCK"
flock -n 9 || { EXIT_REASON='fixed Android port set 5580/5581/5038 is already owned'; exit 2; }
EXIT_REASON='fixed adb server port 5038 could not start'
timeout 30 "$ADB" start-server >/dev/null
if timeout 30 "$ADB" devices | grep -q "$SERIAL"; then EXIT_REASON='fixed emulator port 5580 is already owned'; exit 2; fi

run_emulator_acceptance() {
  sequence=$1
  "$EMULATOR" -avd "$AVD_NAME" -port "$PORT" -accel on -no-window -no-audio -no-boot-anim \
    -gpu swiftshader_indirect -no-snapshot -wipe-data > "$ARTIFACTS/emulator-$sequence.log" 2>&1 &
  EMULATOR_PID=$!
  EXIT_REASON="emulator $sequence did not appear through adb"
  timeout 180 "$ADB" -s "$SERIAL" wait-for-device
  EXIT_REASON="emulator $sequence boot did not complete"
  attempts=0
  while test "$(timeout 10 "$ADB" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != 1; do
    attempts=$((attempts + 1))
    test "$attempts" -lt 180 || { EXIT_REASON="emulator $sequence boot timed out"; return 1; }
    sleep 1
  done
  EXIT_REASON="emulator $sequence APK installation failed"
  timeout 120 "$ADB" -s "$SERIAL" install --no-streaming -r "$APK"
  timeout 120 "$ADB" -s "$SERIAL" install --no-streaming -r "$TEST_APK"
  EXIT_REASON="emulator $sequence application launch failed"
  timeout 30 "$ADB" -s "$SERIAL" shell am force-stop dev.semantifold.generated
  timeout 30 "$ADB" -s "$SERIAL" shell am start -W -n dev.semantifold.generated/.MainActivity
  EXIT_REASON="emulator $sequence UI artifact capture failed"
  timeout 30 "$ADB" -s "$SERIAL" shell uiautomator dump "/sdcard/semantifold-$sequence.xml"
  timeout 30 "$ADB" -s "$SERIAL" pull "/sdcard/semantifold-$sequence.xml" "$ARTIFACTS/ui-$sequence.xml"
  timeout 30 "$ADB" -s "$SERIAL" exec-out screencap -p > "$ARTIFACTS/screenshot-$sequence.png"
  EXIT_REASON="emulator $sequence instrumentation assertion failed"
  timeout 60 "$ADB" -s "$SERIAL" shell am instrument -w \
    -e expected_output_base64 "$EXPECTED_OUTPUT_BASE64" \
    dev.semantifold.generated.test/dev.semantifold.generated.SemantifoldUiInstrumentation \
    > "$ARTIFACTS/instrumentation-$sequence.txt"
  grep -q 'INSTRUMENTATION_CODE: -1' "$ARTIFACTS/instrumentation-$sequence.txt"
  EXIT_REASON="emulator $sequence teardown failed"
  timeout 30 "$ADB" -s "$SERIAL" emu kill
  attempts=0
  while kill -0 "$EMULATOR_PID" 2>/dev/null; do
    attempts=$((attempts + 1))
    test "$attempts" -lt 30 || { EXIT_REASON="emulator $sequence process did not stop"; return 1; }
    sleep 1
  done
  wait "$EMULATOR_PID" || true
  EMULATOR_PID=
  attempts=0
  while timeout 10 "$ADB" devices | grep -q "$SERIAL"; do
    attempts=$((attempts + 1))
    test "$attempts" -lt 30 || { EXIT_REASON="emulator $sequence did not release port 5580"; return 1; }
    sleep 1
  done
}

EXIT_REASON='first clean emulator acceptance failed'
run_emulator_acceptance first
EXIT_REASON='second fresh emulator acceptance failed'
run_emulator_acceptance second
EXIT_REASON=success
trap - EXIT HUP INT TERM
timeout 15 "$ADB" kill-server >/dev/null
rm -rf "$ACCEPTANCE_ROOT/generated"
rm -f "$ACCEPTANCE_ROOT/debug.keystore"
