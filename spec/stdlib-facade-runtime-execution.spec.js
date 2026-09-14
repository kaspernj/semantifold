// @ts-check

import assert from "node:assert/strict"
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {dirname, join} from "node:path"
import {spawnSync} from "node:child_process"
import {describe, expect, it} from "@velocious/testing"
import {generateProgramArtifactSet, parseProgram} from "../index.js"
import {task036FacadeProgram} from "./support/task036-facade-programs.js"

const languages = ["php", "ruby", "javascript", "typescript", "java"]

describe("stdlib facade real runtime execution", () => {
  it("executes every supported source-to-target lane through compiled facades and real providers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "semantifold-task036-"))

    try {
      for (const sourceLanguage of languages) {
        const program = parseProgram(task036FacadeProgram(sourceLanguage, sourceLanguage))

        for (const targetLanguage of languages) {
          const lane = join(directory, `${sourceLanguage}-to-${targetLanguage}`)
          const set = generateProgramArtifactSet({language: targetLanguage, program})

          await mkdir(lane, {recursive: true})
          expect(await execute(targetLanguage, set, lane)).toBe(`effect:${sourceLanguage}`)
        }
      }
    } finally {
      await rm(directory, {force: true, recursive: true})
    }
  })

  it("keeps same-language protected providers isolated from compatibility aliases", async () => {
    const directory = await mkdtemp(join(tmpdir(), "semantifold-task036-isolation-"))

    try {
      for (const language of languages) {
        const lane = join(directory, language)
        const set = generateProgramArtifactSet({language, program: parseProgram(task036FacadeProgram(language, "once"))})
        const provider = set.artifacts.find(({path}) => path.includes("providers/")) ??
          set.artifacts.find(({path}) => path.includes("probe_runner"))

        assert.ok(provider, `Missing protected provider carrier for '${language}'.`)
        expect(provider.content).not.toContain(language == "php" || language == "ruby" ? "compatibility_probe" : "compatibilityProbe")
        await mkdir(lane, {recursive: true})
        expect(await execute(language, set, lane)).toBe("effect:once")
      }
    } finally {
      await rm(directory, {force: true, recursive: true})
    }
  })
})

async function write(set, directory) {
  for (const artifact of set.artifacts) {
    const path = join(directory, artifact.path)

    await mkdir(dirname(path), {recursive: true})
    await writeFile(path, artifact.content, "utf8")
  }
}

async function execute(target, set, directory) {
  await write(set, directory)

  if (target == "php") return run("php", [set.entry], directory)
  if (target == "ruby") return run("ruby", [set.entry], directory)
  if (target == "javascript") return run("node", [set.entry], directory)
  if (target == "typescript") {
    const files = set.artifacts.filter(({path}) => path.endsWith(".ts")).map(({path}) => path)
    const output = join(directory, "out")

    run("tsc", ["--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--types", "node",
      "--typeRoots", join(process.cwd(), "node_modules", "@types"), "--skipLibCheck", "--outDir", output, ...files], directory)
    return run("node", [join(output, set.entry.replace(/\.ts$/u, ".js"))], directory)
  }
  const files = set.artifacts.filter(({path}) => path.endsWith(".java")).map(({path}) => path)
  const entryClass = set.entry.replace(/\.java$/u, "").replaceAll("/", ".")

  run("javac", files, directory)
  return run("java", ["-cp", directory, entryClass], directory)
}

function run(command, arguments_, cwd) {
  const result = spawnSync(command, arguments_, {cwd, encoding: "utf8", env: process.env})

  assert.equal(result.error, undefined, `Required real tool '${command}' is unavailable: ${result.error?.message}`)
  assert.equal(result.status, 0, `${command} ${arguments_.join(" ")} failed:\n${result.stdout}${result.stderr}`)
  return result.stdout.trimEnd()
}
