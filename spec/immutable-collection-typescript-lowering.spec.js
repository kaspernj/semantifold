// @ts-check

import {execFile} from "node:child_process"
import {mkdtemp, rm, writeFile} from "node:fs/promises"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {generate, parse, SemantifoldDiagnostic} from "../index.js"

const execFileAsync = promisify(execFile)

describe("immutable collection TypeScript lowering", () => {
  it("typechecks a proven map lookup where a concrete value is required", async () => {
    const module = parse({
      filename: "lookup.ts",
      language: "typescript",
      source: `function answer(): number {
  const values: ReadonlyMap<string, number> = new Map([["answer", 42]])
  return values.get("answer")
}
console.log(answer())
`
    })
    const generated = generate({language: "typescript", module})
    const directory = await mkdtemp(path.join(os.tmpdir(), "semantifold-task006-typescript-"))

    try {
      const filename = path.join(directory, "lookup.ts")

      await writeFile(filename, generated)
      try {
        await execFileAsync(path.resolve("node_modules/.bin/tsc"), [
          filename, "--target", "ES2024", "--module", "nodenext", "--noEmit", "--strict"
        ], {cwd: directory})
      } catch (error) {
        const details = error && typeof error == "object"
          ? `${Reflect.get(error, "stdout") ?? ""}${Reflect.get(error, "stderr") ?? ""}`.trim()
          : ""

        throw new Error(details || String(error), {cause: error})
      }
      expect(generated).toContain("values.get(\"answer\")!")
      expect(parse({filename: "lookup.ts", language: "typescript", source: generated}).functions).toHaveLength(1)
    } finally {
      await rm(directory, {force: true, recursive: true})
    }
  })

  it("does not treat the target type wrapper as a map-presence proof", () => {
    const source = `function read(values: ReadonlyMap<string, number>, key: string): number {
  return values.get(key)!
}
console.log(read(new Map([["answer", 42]]), "answer"))
`

    assert.throws(
      () => parse({filename: "unchecked.ts", language: "typescript", source}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNCHECKED_COLLECTION_ACCESS"
    )
  })
})
