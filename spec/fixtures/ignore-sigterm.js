// @ts-check

import {writeFileSync} from "node:fs"

const [readyPath, termPath, safetyPath] = process.argv.slice(2)

if (!readyPath || !termPath || !safetyPath) process.exit(64)

process.on("SIGTERM", () => {
  writeFileSync(termPath, "SIGTERM\n")
})

writeFileSync(readyPath, `${process.pid}\n`)
process.stdout.write("ignore-sigterm 1\n")
setTimeout(() => {
  writeFileSync(safetyPath, "fixture self-exit\n")
  process.exit(97)
}, 2_000)
