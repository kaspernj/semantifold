// @ts-check

import {createHash} from "node:crypto"
import {lstat, mkdir, open, readFile, readdir, realpath, rm} from "node:fs/promises"
import path from "node:path"

const ownedPrefix = "generated/flutter-app/"

/**
 * Materializes Flutter artifacts only inside one caller-created empty private acceptance root.
 * This is test/infrastructure support, not a public package writer.
 * @param {import("../src/semantic/types.js").GeneratedArtifactSet} artifactSet - Validated Flutter artifact set.
 * @param {string} acceptanceRoot - Fresh private acceptance directory.
 * @returns {Promise<{projectDirectory: string, verifiedPaths: string[]}>} Materialized project identity.
 */
export async function materializeFlutterAcceptanceProject(artifactSet, acceptanceRoot) {
  const failure = "Flutter acceptance materialization requires a fresh non-symlink mode-0700 directory."
  let information

  try {
    information = await lstat(acceptanceRoot)
  } catch (error) {
    throw new Error(failure, {cause: error})
  }
  if (!information.isDirectory() || information.isSymbolicLink() || (information.mode & 0o777) != 0o700 ||
    await realpath(acceptanceRoot) != path.resolve(acceptanceRoot) || (await readdir(acceptanceRoot)).length != 0) {
    throw new Error(failure)
  }
  if (artifactSet.target != "flutter" || artifactSet.artifacts.length == 0 ||
    artifactSet.artifacts.some(({path: artifactPath}) => !artifactPath.startsWith(ownedPrefix))) {
    throw new Error("Flutter acceptance materialization requires one validated fixed-root Flutter artifact set.")
  }
  const root = path.resolve(acceptanceRoot)
  const cleanupRoot = path.join(root, "generated")
  /** @type {string[]} */
  const verifiedPaths = []

  try {
    for (const artifact of artifactSet.artifacts) {
      const destination = path.resolve(root, artifact.path)

      if (!destination.startsWith(`${root}${path.sep}`)) throw new Error(`Artifact '${artifact.path}' escapes the acceptance root.`)
      await mkdir(path.dirname(destination), {mode: 0o700, recursive: true})
      const handle = await open(destination, "wx", 0o600)

      try {
        await handle.writeFile(artifact.content)
      } finally {
        await handle.close()
      }
      const written = await readFile(destination)
      const expected = typeof artifact.content == "string" ? Buffer.from(artifact.content, "utf8") : Buffer.from(artifact.content)

      if (written.length != expected.length ||
        createHash("sha256").update(written).digest("hex") != createHash("sha256").update(expected).digest("hex")) {
        throw new Error(`Checksum readback failed for Flutter artifact '${artifact.path}'.`)
      }
      verifiedPaths.push(artifact.path)
    }
  } catch (error) {
    await rm(cleanupRoot, {force: true, recursive: true})
    throw error
  }

  return {projectDirectory: path.join(root, "generated", "flutter-app"), verifiedPaths}
}
