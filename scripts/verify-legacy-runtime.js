// @ts-check

import {execFile} from "node:child_process"
import {lstat, readFile, readdir} from "node:fs/promises"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"

const executeFile = promisify(execFile)

/**
 * Rejects a materialized local dependency whose shipped payload no longer matches its source.
 * @param {string} repositoryRoot - Root containing the source and npm-installed dependency.
 * @returns {Promise<void>} Resolves only when every shipped file matches byte for byte.
 */
export async function verifyLegacyRuntime(repositoryRoot) {
  const sourceRoot = path.join(repositoryRoot, "packages/tree-sitter-legacy/runtime")
  const installedRoot = path.join(repositoryRoot, "node_modules/semantifold-tree-sitter-legacy-internal")
  const packed = await executeFile("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
    cwd: sourceRoot, maxBuffer: 10 * 1024 * 1024
  })
  /** @type {{files: {path: string}[]}[]} */
  const packages = JSON.parse(packed.stdout)

  if (packages.length != 1) throw new Error("Expected exactly one internal runtime source package")
  const sourceFiles = packages[0].files.map(({path: filename}) => filename).sort()
  const recovery = "Run npm ci from the repository root to reinstall the current payload before testing or packing."

  try {
    if (!(await lstat(installedRoot)).isDirectory()) throw new Error("installed package is not a materialized directory")
    const installedFiles = (await payloadFiles(installedRoot)).sort()

    if (JSON.stringify(sourceFiles) != JSON.stringify(installedFiles)) {
      throw new Error(`file inventory (source: ${sourceFiles.join(", ")}; installed: ${installedFiles.join(", ")})`)
    }
    for (const filename of sourceFiles) {
      const [source, installed] = await Promise.all([
        readFile(path.join(sourceRoot, filename)), readFile(path.join(installedRoot, filename))
      ])

      if (!source.equals(installed)) throw new Error(filename)
    }
  } catch (error) {
    throw new Error(`Legacy runtime payload differs: ${error instanceof Error ? error.message : error}. ${recovery}`, {
      cause: error
    })
  }
}

/**
 * Enumerates the materialized package payload, excluding its separately owned dependency subtree.
 * @param {string} directory - Installed package directory.
 * @param {string} relative - Relative directory within the package.
 * @returns {Promise<string[]>} Regular payload files with package-relative paths.
 */
async function payloadFiles(directory, relative = "") {
  /** @type {string[]} */
  const files = []

  for (const entry of await readdir(path.join(directory, relative), {withFileTypes: true})) {
    if (relative == "" && entry.name == "node_modules") continue
    const filename = relative ? `${relative}/${entry.name}` : entry.name

    if (entry.isDirectory()) files.push(...await payloadFiles(directory, filename))
    else if (entry.isFile()) files.push(filename)
    else throw new Error(`non-regular payload entry ${filename}`)
  }
  return files
}

if (process.argv[1] && path.resolve(process.argv[1]) == fileURLToPath(import.meta.url)) {
  await verifyLegacyRuntime(fileURLToPath(new URL("../", import.meta.url)))
}
