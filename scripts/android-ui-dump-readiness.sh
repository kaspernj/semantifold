# Bounded readiness protocol for the first Android UI dump artifact, sourced
# by scripts/android-emulator-acceptance.sh. A fresh boot can still be settling
# package-manager work when the app first becomes visible, so uiautomator dump
# may report a null root node and leave no remote file behind. The dump and
# pull are retried as one unit until a non-empty artifact lands locally,
# bounded to the same 30 one-second cadence the Flutter UI assertion uses.
# A hard dump-command failure is not retried: set -e exits the caller with the
# exact UI artifact capture reason.

android_wait_for_ui_dump() {
  dump_adb=$1
  dump_serial=$2
  dump_remote=$3
  dump_local=$4
  attempts=0
  while :; do
    timeout 30 "$dump_adb" -s "$dump_serial" shell uiautomator dump "$dump_remote"
    if timeout 30 "$dump_adb" -s "$dump_serial" pull "$dump_remote" "$dump_local"; then
      if test -s "$dump_local"; then
        return 0
      fi
    fi
    attempts=$((attempts + 1))
    test "$attempts" -lt 30 || return 1
    sleep 1
  done
}
