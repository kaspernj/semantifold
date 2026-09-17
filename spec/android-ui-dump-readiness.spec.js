// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"

const executeFile = promisify(execFile)
const REMOTE_XML = "/sdcard/semantifold-first.xml"
const NULL_ROOT_ERROR = /ERROR: null root node returned by UiTestAutomationBridge/gu

function fakeAdbSource(deviceDirectory, nullRootAttempts) {
  return `#!/bin/sh
set -eu
device_dir=${deviceDirectory}
count_file="$device_dir/dump-counter"
case "$3" in
shell)
  count=0
  if test -f "$count_file"; then
    count=$(cat "$count_file")
  fi
  count=$((count + 1))
  printf '%s\\n' "$count" > "$count_file"
  if test "$count" -lt ${nullRootAttempts}; then
    printf 'ERROR: null root node returned by UiTestAutomationBridge\\n'
  else
    printf '<?xml version="1.0" encoding="UTF-8"?>\\n<hierarchy rotation="0"><node index="0" text="semantifold" /></hierarchy>\\n' > "$device_dir/semantifold-first.xml"
    printf 'UI dump: %s\\n' "$6"
  fi
  ;;
pull)
  if test -f "$device_dir/semantifold-first.xml"; then
    cp "$device_dir/semantifold-first.xml" "$5"
    printf '%s -> %s\\n' "$4" "$5"
  else
    printf "pull: stat '%s' failed: No such file or directory\\n" "$4" >&2
    exit 1
  fi
  ;;
esac
`
}

function driverSource(fakeAdb, localXml) {
  return `#!/bin/sh
set -eu
. ./scripts/android-ui-dump-readiness.sh
android_wait_for_ui_dump "${fakeAdb}" emulator-5580 "${REMOTE_XML}" "${localXml}"
`
}

describe("Android first UI dump bounded readiness", () => {
  it("recovers a transient null-root dump into a real first UI artifact", {timeoutMs: 30_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-android-ui-readiness-transient-"))
    const deviceDirectory = path.join(root, "device")
    const artifactsDirectory = path.join(root, "artifacts")
    const localXml = path.join(artifactsDirectory, "ui-first.xml")
    const fakeAdb = path.join(root, "adb")
    const driver = path.join(root, "driver.sh")

    try {
      await mkdir(deviceDirectory)
      await mkdir(artifactsDirectory)
      await writeFile(fakeAdb, fakeAdbSource(deviceDirectory, 3))
      await chmod(fakeAdb, 0o700)
      await writeFile(driver, driverSource(fakeAdb, localXml))
      await chmod(driver, 0o700)
      const result = await executeFile("sh", [driver], {cwd: new URL("../", import.meta.url)})

      expect(String(result.stdout).match(NULL_ROOT_ERROR)?.length).toEqual(2)
      expect((await readFile(path.join(deviceDirectory, "dump-counter"), "utf8")).trim()).toEqual("3")
      const pulled = await readFile(localXml, "utf8")

      expect(pulled).toContain("<hierarchy")
      expect(pulled).toContain('text="semantifold"')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("fails loudly after exactly 30 bounded attempts when the dump artifact never appears", {timeoutMs: 120_000}, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-android-ui-readiness-persistent-"))
    const deviceDirectory = path.join(root, "device")
    const artifactsDirectory = path.join(root, "artifacts")
    const localXml = path.join(artifactsDirectory, "ui-first.xml")
    const fakeAdb = path.join(root, "adb")
    const driver = path.join(root, "driver.sh")

    try {
      await mkdir(deviceDirectory)
      await mkdir(artifactsDirectory)
      await writeFile(fakeAdb, fakeAdbSource(deviceDirectory, 999))
      await chmod(fakeAdb, 0o700)
      await writeFile(driver, driverSource(fakeAdb, localXml))
      await chmod(driver, 0o700)

      await assert.rejects(
        executeFile("sh", [driver], {cwd: new URL("../", import.meta.url)}),
        error => {
          const stdout = String(error?.stdout)
          const stderr = String(error?.stderr)

          return error?.code == 1 &&
            (stdout.match(NULL_ROOT_ERROR)?.length ?? 0) == 30 &&
            stderr.includes(`pull: stat '${REMOTE_XML}' failed: No such file or directory`)
        }
      )
      expect((await readFile(path.join(deviceDirectory, "dump-counter"), "utf8")).trim()).toEqual("30")
      await assert.rejects(stat(localXml))
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
