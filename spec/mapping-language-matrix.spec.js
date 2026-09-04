// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {describe, it} from "@velocious/testing"
import {decodedMappings, originalPositionFor as traceOriginalPositionFor, TraceMap} from "@jridgewell/trace-mapping"
import {discoverCanonicalToolchain, generate, generateArtifact, parse} from "../index.js"

const execFileAsync = promisify(execFile)
const fixtures = [
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"],
  ["python", "program.py"]
]
const targets = ["php", "ruby", "javascript", "typescript", "java", "python"]

describe("six-language mapping acceptance", () => {
  it("maps all 36 input-output combinations at semantic-token granularity", async () => {
    for (const [inputLanguage, inputFilename] of fixtures) {
      const source = await readFile(new URL(`fixtures/locals/${inputFilename}`, import.meta.url), "utf8")
      const module = parse({filename: inputFilename, language: inputLanguage, source})

      for (const outputLanguage of targets) {
        const artifact = generateArtifact({language: outputLanguage, module})
        const functionOffset = artifact.code.indexOf("select")
        const generatedPoint = lineColumnAt(artifact.code, functionOffset)
        const traced = traceOriginalPositionFor(new TraceMap(artifact.sourceMap), {
          column: generatedPoint.column - 1,
          line: generatedPoint.line
        })
        const roles = new Set(artifact.mapping.spans.map((span) => span.role).filter(Boolean))

        assert.equal(artifact.code, generate({language: outputLanguage, module}))
        assert.equal(artifact.code.includes("\r"), false)
        assert.equal(artifact.mapping.spans[0].generated.start.offset, 0)
        assert.equal(artifact.mapping.spans.at(-1).generated.end.offset, artifact.code.length)
        artifact.mapping.spans.slice(1).forEach((span, index) => {
          assert.equal(span.generated.start.offset, artifact.mapping.spans[index].generated.end.offset)
        })
        assert.deepEqual([...roles].sort(), ["callee", "literal", "name", "operator", "type"])
        assert.ok(artifact.mapping.spans.some((span) => span.mappingKind == "synthetic"))
        assert.ok(artifact.mapping.spans.some((span) => span.mappingKind == "anchor"))
        assert.ok(decodedMappings(new TraceMap(artifact.sourceMap)).flat().length > 0)
        assert.equal(traced.source, inputFilename)
        assert.equal(traced.name, "select")
      }
    }
  })

  it("preserves astral UTF-16 source coordinates and exact sourcesContent", async () => {
    const fixture = await readFile(new URL("fixtures/scalars/program.ts", import.meta.url), "utf8")
    const source = fixture.replace('"yes"', '"😀"')
    const module = parse({filename: "astral.ts", language: "typescript", source})
    const artifact = generateArtifact({language: "java", module})
    const literal = module.functions[0].body.statements.at(-1).consequent.statements.at(-1).expression
    const record = module.provenance.nodes.find((node) => node.path == "/functions/0/body/statements/0/consequent/statements/0/expression")

    assert.equal(source.slice(record.origin.location.start.offset, record.origin.location.end.offset).includes("😀"), true)
    assert.equal(record.origin.location.end.offset - record.origin.location.start.offset, literal.location.end.offset - literal.location.start.offset)
    assert.deepEqual(artifact.sourceMap.sourcesContent, [source])
  })

  it("executes one mapped artifact with every real target toolchain", async () => {
    const source = await readFile(new URL("fixtures/locals/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of targets) {
      const artifact = generateArtifact({language, module})

      assert.equal(await executeArtifact(language, artifact.code), "yes\n")
      assert.ok(artifact.mapping.spans.length > 0)
    }
  })
})

/**
 * Returns a one-based UTF-16 point.
 * @param {string} source - Source.
 * @param {number} offset - UTF-16 offset.
 * @returns {{line: number, column: number}} Point.
 */
function lineColumnAt(source, offset) {
  const before = source.slice(0, offset)

  return {column: before.length - before.lastIndexOf("\n"), line: before.split("\n").length}
}

/**
 * Executes a generated mapped artifact with the real target toolchain.
 * @param {string} language - Target language.
 * @param {string} source - Generated source.
 * @returns {Promise<string>} Standard output.
 */
async function executeArtifact(language, source) {
  const directory = await mkdtemp(path.join(tmpdir(), "semantifold-mapped-runtime-"))

  try {
    if (language == "php") {
      const filename = path.join(directory, "program.php")

      await writeFile(filename, source)
      return (await execFileAsync("php", [filename])).stdout
    }
    if (language == "ruby") {
      const filename = path.join(directory, "program.rb")

      await writeFile(filename, source)
      return (await execFileAsync("ruby", [filename])).stdout
    }
    if (language == "javascript") {
      const filename = path.join(directory, "program.js")

      await writeFile(filename, source)
      return (await execFileAsync(process.execPath, [filename])).stdout
    }
    if (language == "typescript") {
      const filename = path.join(directory, "program.ts")
      const compiler = path.resolve("node_modules/.bin/tsc")

      await writeFile(filename, source)
      await execFileAsync(compiler, [filename, "--target", "ES2024", "--module", "nodenext"], {cwd: directory})
      return (await execFileAsync(process.execPath, [path.join(directory, "program.js")])).stdout
    }
    if (language == "python") {
      const filename = path.join(directory, "program.py")
      const python = await discoverCanonicalToolchain("python")
      const environment = {LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", TZ: "UTC"}

      await writeFile(filename, source)
      await execFileAsync(python.executable, ["-m", "py_compile", filename], {cwd: directory, env: environment})
      return (await execFileAsync(python.executable, [filename], {cwd: directory, env: environment})).stdout
    }

    const filename = path.join(directory, "Main.java")

    await writeFile(filename, source)
    await execFileAsync("javac", [filename], {cwd: directory})
    return (await execFileAsync("java", ["-cp", directory, "Main"])).stdout
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}
