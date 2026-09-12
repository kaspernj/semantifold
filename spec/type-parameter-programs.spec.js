// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {generateProgramArtifactSet, parseProgram} from "../index.js"

function genericProgram() {
  return parseProgram({
    entryModule: "main",
    sources: [{
      filename: "model.ts",
      id: "model",
      language: "typescript",
      source: "export class Batch<T> { constructor(readonly values: ReadonlyArray<T>) {} }\n"
    }, {
      filename: "library.ts",
      id: "library",
      language: "typescript",
      source: `import type {Batch} from "./model.js"
export function passthrough<T>(value: Batch<T>): Batch<T> { return value }
export function identity<T>(value: T): T { return value }
`
    }, {
      filename: "main.ts",
      id: "main",
      language: "typescript",
      source: `import {Batch} from "./model.js"
import {passthrough, identity} from "./library.js"
const batch: Batch<string> = new Batch<string>(["a", "b"])
console.log(identity("ok"))
console.log(passthrough(batch).values.length)
`
    }]
  })
}

/** @param {import("../src/semantic/types.js").SemanticProgram} program - Resolved program. */
function meaning(program) {
  return JSON.parse(JSON.stringify(program, (key, value) => [
    "callee", "location", "localName", "provenance", "sourceFilename", "sourceProvenance", "sources", "typeOnly"
  ].includes(key) ? undefined : value))
}

/** @param {string} target - Target language. @param {string} artifactPath - Generated artifact path. */
function moduleId(target, artifactPath) {
  const withoutExtension = artifactPath.replace(/\.[^./]+$/u, "")

  return target == "java"
    ? withoutExtension.replace(/^semantifold\/generated\//u, "").split("/").slice(0, -1).join(".")
    : withoutExtension.replaceAll("/", ".")
}

describe("type parameter programs", () => {
  it("rekeys scoped identities and round-trips imported generic declarations and applications in every cohort target", () => {
    const program = genericProgram()
    const model = program.modules.find(({id}) => id == "model")
    const library = program.modules.find(({id}) => id == "library")

    expect(model?.records?.[0].typeParameters?.[0].id).toEqual("model#record:0:type:0")
    expect(library?.functions[0].typeParameters?.[0].id).toEqual("library#function:0:type:0")
    expect(library?.functions[0].parameters[0].type).toMatchObject({
      arguments: [{kind: "TypeVariableReference", parameterId: "library#function:0:type:0"}],
      declarationId: "model#record:0",
      kind: "RecordType"
    })

    for (const language of ["php", "ruby", "javascript", "typescript", "java"]) {
      const target = /** @type {"php" | "ruby" | "javascript" | "typescript" | "java"} */ (language)
      const artifacts = generateProgramArtifactSet({language: target, program})
      const reparsed = parseProgram({
        entryModule: "main",
        sources: artifacts.artifacts.filter(({role}) => role == "source" || role == "entry").map((artifact) => ({
          filename: artifact.path,
          id: moduleId(target, artifact.path),
          language: target,
          source: String(artifact.content)
        }))
      })

      expect({language: target, program: meaning(reparsed)}).toEqual({language: target, program: meaning(program)})
    }
  })
})
