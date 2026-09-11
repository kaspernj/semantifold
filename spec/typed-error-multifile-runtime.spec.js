// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {discoverCanonicalToolchain, generateProgramArtifactSet, parseProgram, runAcceptanceStages} from "../index.js"

function sourceProgram() {
  return parseProgram({
    entryModule: "main",
    sources: [{
      filename: "src/validation_error.ts",
      id: "validation_error",
      language: "typescript",
      source: "export class ValidationError extends Error {}\n"
    }, {
      filename: "src/processing_error.ts",
      id: "processing_error",
      language: "typescript",
      source: "export class ProcessingError extends Error {}\n"
    }, {
      filename: "src/worker.ts",
      id: "worker",
      language: "typescript",
      source: `import {ProcessingError} from "./processing_error.js"
import {ValidationError} from "./validation_error.js"
export function perform(mode: number): string {
  if (mode === 0) return "ok"
  if (mode === 1) throw new ValidationError("bad")
  throw new ProcessingError("deep")
}
`
    }, {
      filename: "src/service.ts",
      id: "service",
      language: "typescript",
      source: `import {perform} from "./worker.js"
export function validate(mode: number): string {
  return perform(mode)
}
`
    }, {
      filename: "src/main.ts",
      id: "main",
      language: "typescript",
      source: `import {ProcessingError} from "./processing_error.js"
import {ValidationError} from "./validation_error.js"
import {validate} from "./service.js"
console.log(validate(0))
try {
  try {
    console.log(validate(1))
  } catch (validationError) {
    if (!(validationError instanceof ValidationError)) { throw validationError }
    console.log(validationError.message)
    console.log(validate(2))
  }
} catch (processingError) {
  if (!(processingError instanceof ProcessingError)) { throw processingError }
  console.log(processingError.message)
}
`
    }]
  })
}

/** @param {string} target - Target language. @param {string} artifactPath - Generated module path. */
function moduleId(target, artifactPath) {
  const withoutExtension = artifactPath.replace(/\.[^./]+$/u, "")

  return target == "java"
    ? withoutExtension.replace(/^semantifold\/generated\//u, "").split("/").slice(0, -1).join(".")
    : withoutExtension.replaceAll("/", ".")
}

describe("typed error multi-file runtime acceptance", () => {
  it("preserves imported nominal identities while reparsing and executing every original-five target", async () => {
    const program = sourceProgram()
    const php = await discoverCanonicalToolchain("php")
    const ruby = await discoverCanonicalToolchain("ruby")
    const node = await discoverCanonicalToolchain("node")
    const tsc = await discoverCanonicalToolchain("tsc")
    const javac = await discoverCanonicalToolchain("javac")
    const java = await discoverCanonicalToolchain("java")
    const requests = [{
      stages: [{arguments: ["main.php"], stage: /** @type {const} */ ("execute"), tool: php}],
      target: /** @type {const} */ ("php")
    }, {
      stages: [{arguments: ["main.rb"], stage: /** @type {const} */ ("execute"), tool: ruby}],
      target: /** @type {const} */ ("ruby")
    }, {
      stages: [{arguments: ["main.js"], stage: /** @type {const} */ ("execute"), tool: node}],
      target: /** @type {const} */ ("javascript")
    }, {
      stages: [{
        arguments: [
          "--target", "ES2024", "--module", "ES2022", "--moduleResolution", "bundler", "--outDir", "dist",
          "validation_error.ts", "processing_error.ts", "worker.ts", "service.ts", "main.ts"
        ],
        stage: /** @type {const} */ ("compile"),
        tool: tsc
      }, {arguments: ["dist/main.js"], stage: /** @type {const} */ ("execute"), tool: node}],
      target: /** @type {const} */ ("typescript")
    }, {
      stages: [{
        arguments: [
          "semantifold/generated/validation_error/ValidationError.java",
          "semantifold/generated/processing_error/ProcessingError.java",
          "semantifold/generated/worker/Worker.java",
          "semantifold/generated/service/Service.java",
          "semantifold/generated/main/Main.java"
        ],
        stage: /** @type {const} */ ("compile"),
        tool: javac
      }, {arguments: ["-cp", ".", "semantifold.generated.main.Main"], stage: /** @type {const} */ ("execute"), tool: java}],
      target: /** @type {const} */ ("java")
    }]

    for (const request of requests) {
      const artifacts = generateProgramArtifactSet({language: request.target, program})
      const reparsed = parseProgram({
        entryModule: "main",
        sources: artifacts.artifacts.filter(({role}) => role == "source" || role == "entry").map((artifact) => ({
          filename: artifact.path,
          id: moduleId(request.target, artifact.path),
          language: request.target,
          source: String(artifact.content)
        }))
      })
      const validationError = reparsed.modules.find(({id}) => id == "validation_error")?.errors?.[0]
      const processingError = reparsed.modules.find(({id}) => id == "processing_error")?.errors?.[0]
      const worker = reparsed.modules.find(({id}) => id == "worker")

      assert(worker?.functions[0])
      const workerBody = worker.functions[0].body
      const validationRaise = /** @type {import("../src/semantic/types.js").RaiseStatement} */ (
        /** @type {import("../src/semantic/types.js").IfStatement} */ (workerBody.statements[1]).consequent.statements[0])
      const processingRaise = /** @type {import("../src/semantic/types.js").RaiseStatement} */ (workerBody.statements[2])

      expect({
        processingDeclarationId: processingRaise.error.error.declarationId,
        processingErrorId: processingError?.id,
        target: request.target,
        validationDeclarationId: validationRaise.error.error.declarationId,
        validationErrorId: validationError?.id
      }).toEqual({
        processingDeclarationId: "processing_error#error:0",
        processingErrorId: "processing_error#error:0",
        target: request.target,
        validationDeclarationId: "validation_error#error:0",
        validationErrorId: "validation_error#error:0"
      })
      const result = await runAcceptanceStages({artifacts, stages: request.stages, target: request.target, timeoutMs: 20_000})

      expect({output: result.stages.at(-1)?.stdout, target: request.target}).toEqual({output: "ok\nbad\ndeep\n", target: request.target})
    }
  })
})
