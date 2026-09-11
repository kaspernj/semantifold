// @ts-check

import {constants} from "node:fs"
import {cp, mkdir, mkdtemp, rm} from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const fixtureEntries = [
  ".npmrc", "LICENSE", "README.md", "docs", "index.js", "package-lock.json", "package.json", "packages", "scripts",
  "src", "tsconfig.json", "node_modules"
]

/**
 * Runs the root package's real packing lifecycle.
 *
 * @param {(executable: string, arguments_: string[], options: object) => Promise<{stdout: string, stderr: string}>} executeFile
 * @param {string} repositoryRoot
 * @param {string} packDirectory
 */
export async function packRootPackage(executeFile, repositoryRoot, packDirectory) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "semantifold-pack-source-"))
  const workspaceBuild = path.join(repositoryRoot, "packages/tree-sitter-legacy/build")

  try {
    await mkdir(path.join(fixtureRoot, "packages"))
    for (const entry of fixtureEntries) {
      await cp(path.join(repositoryRoot, entry), path.join(fixtureRoot, entry), {
        recursive: true,
        verbatimSymlinks: true,
        mode: constants.COPYFILE_FICLONE,
        filter: (source) => source != workspaceBuild && !source.startsWith(`${workspaceBuild}${path.sep}`)
      })
    }
    return await executeFile("npm", ["pack", "--pack-destination", packDirectory, "--json"], {
      cwd: fixtureRoot,
      maxBuffer: 20 * 1024 * 1024
    })
  } finally {
    await rm(fixtureRoot, {force: true, recursive: true})
  }
}
