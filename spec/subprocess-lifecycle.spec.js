// @ts-check

import assert from "node:assert/strict"
import {mkdtemp, readFile, rm} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {describe, expect, it} from "@velocious/testing"
import {createExecuteFileWithDeadline, exceededOwnedDeadline} from "../src/subprocess.js"

const ignoreSigtermFixture = fileURLToPath(new URL("fixtures/ignore-sigterm.sh", import.meta.url))
const executeFileWithSynchronizedReadiness = createExecuteFileWithDeadline({
  registerSpawnListener(child, listener) {
    assert.ok(child.stdout)
    child.stdout.once("data", listener)
  }
})

describe("owned subprocess lifecycle", () => {
  it("escalates a ready TERM-resistant process group to SIGKILL without residue", async () => {
    expect(process.platform).toEqual("linux")
    const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-subprocess-hard-timeout-"))
    const fixture = {
      readyPath: path.join(directory, "subprocess.ready"),
      termPath: path.join(directory, "subprocess.term")
    }
    /** @type {Error & {signal?: string, stdout?: string} | undefined} */
    let failure

    try {
      await assert.rejects(() => executeFileWithSynchronizedReadiness({
        arguments: [fixture.readyPath, fixture.termPath],
        environment: {},
        executable: ignoreSigtermFixture,
        maxBuffer: 1024,
        timeoutMs: 500
      }), (error) => {
        assert.ok(error instanceof Error)
        failure = error
        expect(exceededOwnedDeadline(error)).toBeTrue()
        expect("signal" in error ? error.signal : undefined).toEqual("SIGKILL")

        return true
      })

      expect(failure?.stdout).toEqual("ignore-sigterm 1\n")
      await assertForcedFixtureClosure(fixture)
    } finally {
      await terminateFixtureIfAlive(fixture)
      await rm(directory, {force: true, recursive: true})
    }
  })
})

/**
 * Proves the fixture installed its handler, ignored TERM, and left no owned process group.
 * @param {{readyPath: string, termPath: string}} fixture - Fixture evidence paths.
 */
async function assertForcedFixtureClosure(fixture) {
  const identity = await fixtureIdentity(fixture)

  expect(identity.processGroupId).toEqual(identity.pid)
  expect(identity.sessionId).toEqual(identity.pid)
  expect(await readFile(fixture.termPath, "utf8")).toEqual("SIGTERM\n")
  expect(await waitForNoLiveLinuxProcess(identity, 500)).toBeTrue()
  expect(processGroupExists(identity.processGroupId)).toBeFalse()
}

/**
 * Guarantees exact process-group cleanup if lifecycle settlement or an assertion fails.
 * @param {{readyPath: string}} fixture - Fixture evidence paths.
 */
async function terminateFixtureIfAlive(fixture) {
  const identity = await fixtureIdentity(fixture, false)

  if (identity == undefined) return
  if (!await signalRecordedProcessGroup(identity, "SIGKILL")) await signalRecordedProcess(identity, "SIGKILL")
  expect(await waitForNoLiveLinuxProcess(identity, 500)).toBeTrue()
  expect(processGroupExists(identity.processGroupId)).toBeFalse()
}

/**
 * Reads the exact identity captured after the fixture installed its TERM handler.
 * @param {{readyPath: string}} fixture - Fixture evidence paths.
 * @param {boolean} [required] - Whether absent evidence fails.
 */
async function fixtureIdentity(fixture, required = true) {
  try {
    return linuxIdentityFromStat(await readFile(fixture.readyPath, "utf8"))
  } catch (error) {
    if (!required && error instanceof Error && "code" in error && error.code == "ENOENT") return undefined
    throw error
  }
}

/**
 * Observes termination of one exact PID after cleanup has sent its final signal.
 * @param {{pid: number, startTime: string}} identity - Exact recorded process identity.
 * @param {number} timeoutMs - Maximum cleanup observation duration.
 */
async function waitForNoLiveLinuxProcess(identity, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let current = await linuxProcessIdentity(identity.pid)

  while (sameProcess(identity, current) && current.state != "Z" && Date.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve))
    current = await linuxProcessIdentity(identity.pid)
  }

  return !sameProcess(identity, current) || current.state == "Z"
}

/** @param {number} pid - Exact Linux process identity. */
async function linuxProcessIdentity(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8")
    return {...linuxIdentityFromStat(stat), state: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0]}
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code == "ENOENT") return undefined
    throw error
  }
}

/** @param {string} stat - Linux `/proc/PID/stat` content. */
function linuxIdentityFromStat(stat) {
  const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(" ")

  return {
    pid: Number.parseInt(stat, 10),
    processGroupId: Number(fields[2]),
    sessionId: Number(fields[3]),
    startTime: fields[19]
  }
}

/**
 * Signals a PID only while its Linux start-time identity still matches.
 * @param {{pid: number, startTime: string}} identity - Recorded process identity.
 * @param {"SIGKILL" | "SIGTERM"} signal - Cleanup signal.
 */
async function signalRecordedProcess(identity, signal) {
  const current = await linuxProcessIdentity(identity.pid)

  if (!sameProcess(identity, current) || current.state == "Z") return false
  process.kill(identity.pid, signal)

  return true
}

/**
 * Signals a process group only while its recorded leader identity still matches.
 * @param {{pid: number, processGroupId: number, startTime: string}} identity - Recorded group-leader identity.
 * @param {"SIGKILL" | "SIGTERM"} signal - Cleanup signal.
 */
async function signalRecordedProcessGroup(identity, signal) {
  const current = await linuxProcessIdentity(identity.pid)

  if (identity.pid != identity.processGroupId || !sameProcess(identity, current) ||
    current.state == "Z" || current.processGroupId != identity.processGroupId) return false
  try {
    process.kill(-identity.processGroupId, signal)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code == "ESRCH") return false
    throw error
  }
}

/** @param {{pid: number, startTime: string}} expected @param {{pid: number, startTime: string} | undefined} current */
function sameProcess(expected, current) {
  return current != undefined && current.pid == expected.pid && current.startTime == expected.startTime
}

/** @param {number} processGroupId - Exact positive process-group identity. */
function processGroupExists(processGroupId) {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code == "ESRCH") return false
    throw error
  }
}
