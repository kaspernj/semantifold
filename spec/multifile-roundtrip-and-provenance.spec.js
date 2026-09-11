// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {generateProgramArtifactSet, parseProgram} from "../index.js"

function sourceProgram() {
  return parseProgram({
    entryModule: "main",
    sources: [{
      filename: "src/main.ts",
      id: "main",
      language: "typescript",
      source: `import {User} from "./model.js"
import {label} from "./math_tools.js"
const user: User = new User("Ada")
console.log(label(user))
`
    }, {
      filename: "src/math_tools.ts",
      id: "math_tools",
      language: "typescript",
      source: `import type {User} from "./model.js"
export function label(user: User): string { return user.name }
`
    }, {
      filename: "src/model.ts",
      id: "model",
      language: "typescript",
      source: "export class User { constructor(readonly name: string) {} }\n"
    }]
  })
}

/** @param {import("../src/semantic/types.js").SemanticProgram} program - Resolved program. */
function meaning(program) {
  return JSON.parse(JSON.stringify(program, (key, value) => [
    "callee", "location", "localName", "provenance", "sourceFilename", "sourceProvenance", "sources", "typeOnly"
  ].includes(key) ? undefined : value))
}

/** @param {string} target - Target language. @param {string} artifactPath - Generated module path. */
function moduleId(target, artifactPath) {
  const withoutExtension = artifactPath.replace(/\.[^./]+$/u, "")

  return target == "java"
    ? withoutExtension.replace(/^semantifold\/generated\//u, "").split("/").slice(0, -1).join(".")
    : withoutExtension.replaceAll("/", ".")
}

describe("multi-file semantic round-trip and provenance", () => {
  it("reparses every generated target project to the same resolved declaration graph", () => {
    const program = sourceProgram()

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

      expect({language, program: meaning(reparsed)}).toEqual({language, program: meaning(program)})
    }
  })

  it("retains parser-owned import/export token provenance in semantic nodes and generated mappings", () => {
    const program = sourceProgram()
    const main = /** @type {import("../src/semantic/types.js").SemanticProgramModule} */ (
      program.modules.find(({id}) => id == "main"))
    const math = /** @type {import("../src/semantic/types.js").SemanticProgramModule} */ (
      program.modules.find(({id}) => id == "math_tools"))
    const imported = main.imports[0]
    const exported = math.exports[0]

    expect(imported.sourceProvenance?.origin).toEqual({
      kind: "source",
      location: imported.location,
      sourceId: "source:0"
    })
    expect(Object.keys(imported.sourceProvenance?.ranges ?? {}).sort()).toEqual([
      "declaration", "importedName", "localName", "path"
    ])
    expect(exported.sourceProvenance?.origin).toEqual({
      kind: "source",
      location: exported.location,
      sourceId: "source:1"
    })
    expect(math.provenance?.sources.map(({filename, id}) => ({filename, id}))).toEqual([
      {filename: "src/main.ts", id: "source:0"},
      {filename: "src/math_tools.ts", id: "source:1"},
      {filename: "src/model.ts", id: "source:2"}
    ])
    expect(Object.keys(exported.sourceProvenance?.ranges ?? {}).sort()).toEqual([
      "declaration", "exportedName", "localName"
    ])

    const generated = generateProgramArtifactSet({language: "typescript", program})
    const mainArtifact = generated.artifacts.find(({path}) => path == "main.ts")

    expect(mainArtifact?.provenance.kind).toEqual("text")
    if (mainArtifact?.provenance.kind == "text") {
      expect(mainArtifact.provenance.mapping.spans.some((span) => span.role == "importedName" &&
        span.origin.kind == "source" && span.origin.location.filename == "src/main.ts")).toBeTrue()
    }
  })
})
