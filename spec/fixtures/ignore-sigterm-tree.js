// @ts-check

import {spawn} from "node:child_process"
import {writeFileSync} from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"

const [mode, stateDirectory] = process.argv.slice(2)
const fixturePath = fileURLToPath(import.meta.url)

if (!stateDirectory || (mode != "parent" && mode != "grandchild")) process.exit(64)

if (mode == "grandchild") {
  process.on("SIGTERM", () => writeEvidence("grandchild.term", "SIGTERM\n"))
  writeEvidence("grandchild.pid", `${process.pid}\n`)
  if (process.send) process.send("ready")
  setTimeout(() => {
    writeEvidence("grandchild.safety", "fixture self-exit\n")
    process.exit(97)
  }, 4_000)
} else {
  process.on("SIGTERM", () => writeEvidence("parent.term", "SIGTERM\n"))
  writeEvidence("parent.pid", `${process.pid}\n`)
  const grandchild = spawn(process.execPath, [fixturePath, "grandchild", stateDirectory], {
    stdio: ["ignore", "inherit", "inherit", "ipc"]
  })

  grandchild.once("message", (message) => {
    if (message != "ready") process.exit(65)
    writeEvidence("ready", "parent and grandchild ready\n")
    process.stdout.write("ignore-sigterm-tree 1\n")
  })
  grandchild.once("error", () => process.exit(66))
  setTimeout(() => {
    writeEvidence("parent.safety", "fixture self-exit\n")
    process.exit(98)
  }, 4_000)
}

/** @param {string} filename @param {string} content */
function writeEvidence(filename, content) {
  writeFileSync(path.join(stateDirectory, filename), content)
}
