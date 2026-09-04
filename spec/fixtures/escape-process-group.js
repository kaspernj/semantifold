// @ts-check

import {spawn} from "node:child_process"
import {readFileSync, writeFileSync} from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"

const [mode, stateDirectory] = process.argv.slice(2)
const fixturePath = fileURLToPath(import.meta.url)

if (process.platform != "linux" || !stateDirectory || (mode != "parent" && mode != "helper")) process.exit(64)

if (mode == "helper") {
  let pipeClosed = false

  process.on("SIGTERM", () => writeEvidence("helper.term", "SIGTERM\n"))
  process.stdout.on("error", (error) => {
    if (!pipeClosed && "code" in error && error.code == "EPIPE") {
      pipeClosed = true
      writeEvidence("pipe.closed", "EPIPE\n")
    }
  })
  writeIdentity("helper")
  if (process.send) process.send("ready")
  const output = setInterval(() => process.stdout.write("."), 25)

  setTimeout(() => {
    clearInterval(output)
    writeEvidence("helper.safety", "fixture self-exit\n")
    process.exit(97)
  }, 4_000)
} else {
  process.once("SIGTERM", () => {
    writeEvidence("parent.term", "SIGTERM\n")
    process.kill(process.pid, "SIGTERM")
  })
  writeIdentity("parent")
  const helper = spawn("/usr/bin/setsid", [process.execPath, fixturePath, "helper", stateDirectory], {
    stdio: ["ignore", "inherit", "inherit", "ipc"]
  })

  helper.once("message", (message) => {
    if (message != "ready") process.exit(65)
    writeEvidence("ready", "escaped helper ready\n")
    process.stdout.write("escaped-helper 1\n")
  })
  helper.once("error", () => process.exit(66))
  setTimeout(() => {
    writeEvidence("parent.safety", "fixture self-exit\n")
    process.exit(98)
  }, 4_000)
}

/** @param {string} name */
function writeIdentity(name) {
  const stat = readFileSync("/proc/self/stat", "utf8")
  const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(" ")

  writeEvidence(`${name}.identity`, `${JSON.stringify({
    pid: process.pid,
    processGroupId: Number(fields[2]),
    sessionId: Number(fields[3]),
    startTime: fields[19]
  })}\n`)
}

/** @param {string} filename @param {string} content */
function writeEvidence(filename, content) {
  writeFileSync(path.join(stateDirectory, filename), content)
}
