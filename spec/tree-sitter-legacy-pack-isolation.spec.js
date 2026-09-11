// @ts-check

import {execFile} from "node:child_process"
import {mkdtemp, open, rm, stat} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {packRootPackage} from "./support/root-package-pack.js"

const executeFile = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

describe("root package pack isolation", () => {
  it("does not replace shared legacy declarations while exercising prepack", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "semantifold-pack-isolation-"))
    const declarationPath = path.join(repositoryRoot, "packages/tree-sitter-legacy/build/c.d.ts")
    const declaration = await open(declarationPath, "r")

    try {
      const before = await declaration.stat()

      await packRootPackage(executeFile, repositoryRoot, temporaryRoot)
      const after = await stat(declarationPath)

      expect({device: after.dev, inode: after.ino}).toEqual({device: before.dev, inode: before.ino})
    } finally {
      await declaration.close()
      await rm(temporaryRoot, {force: true, recursive: true})
    }
  })
})
