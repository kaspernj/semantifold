// @ts-check

import {spawn} from "node:child_process"

if (process.argv[2] == "child") {
  process.stdout.write("late stdout\n")
  process.stderr.write("late stderr\n")
} else {
  const child = spawn(process.execPath, [process.argv[1], "child"], {
    stdio: ["ignore", "inherit", "inherit"]
  })

  child.unref()
  process.stdout.write("parent stdout\n")
  process.stderr.write("parent stderr\n")
}
