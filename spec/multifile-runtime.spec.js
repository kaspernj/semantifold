// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {
  createGeneratedArtifactSet,
  discoverCanonicalToolchain,
  generateProgramArtifactSet,
  parseProgram,
  runAcceptanceStages,
  SemantifoldDiagnostic
} from "../index.js"

function project() {
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

function privateHelperProject() {
  return parseProgram({
    entryModule: "main",
    sources: [{
      filename: "library.ts",
      id: "library",
      language: "typescript",
      source: `function hidden(): string { return "secret" }
export function exposed(): string { return "public" }
`
    }, {
      filename: "main.ts",
      id: "main",
      language: "typescript",
      source: `import {exposed} from "./library.js"
console.log(exposed())
`
    }]
  })
}

/**
 * Adds one generated native visibility probe without changing the generated entry artifact.
 * @param {import("../src/semantic/types.js").GeneratedArtifactSet} artifacts - Generated project.
 * @param {string} path - Probe path.
 * @param {string} content - Native probe source.
 */
function withProbe(artifacts, path, content) {
  return createGeneratedArtifactSet({
    artifacts: [...artifacts.artifacts, {
      content,
      contentKind: /** @type {const} */ ("text"),
      mediaType: "text/plain",
      ownership: /** @type {const} */ ("generated"),
      path,
      provenance: {
        kind: /** @type {const} */ ("synthetic"),
        reason: "Native visibility probe for a non-exported semantic declaration.",
        relatedOrigins: []
      },
      role: /** @type {const} */ ("support")
    }],
    target: artifacts.target
  })
}

describe("multi-file generated project execution", () => {
  it("executes dependency-first artifact sets with every required real toolchain", async () => {
    const program = project()
    const php = await discoverCanonicalToolchain("php")
    const ruby = await discoverCanonicalToolchain("ruby")
    const node = await discoverCanonicalToolchain("node")
    const tsc = await discoverCanonicalToolchain("tsc")
    const javac = await discoverCanonicalToolchain("javac")
    const java = await discoverCanonicalToolchain("java")
    const requests = [{
      stages: [{arguments: ["main.php"], stage: /** @type {const} */ ("execute"), tool: php}],
      target: "php"
    }, {
      stages: [{arguments: ["main.rb"], stage: /** @type {const} */ ("execute"), tool: ruby}],
      target: "ruby"
    }, {
      stages: [{arguments: ["main.js"], stage: /** @type {const} */ ("execute"), tool: node}],
      target: "javascript"
    }, {
      stages: [
        {
          arguments: [
            "--target", "ES2024", "--module", "ES2022", "--moduleResolution", "bundler", "--outDir", "dist",
            "model.ts", "math_tools.ts", "main.ts"
          ],
          stage: /** @type {const} */ ("compile"),
          tool: tsc
        },
        {arguments: ["dist/main.js"], stage: /** @type {const} */ ("execute"), tool: node}
      ],
      target: "typescript"
    }, {
      stages: [
        {
          arguments: [
            "semantifold/generated/model/User.java",
            "semantifold/generated/math_tools/MathTools.java",
            "semantifold/generated/main/Main.java"
          ],
          stage: /** @type {const} */ ("compile"),
          tool: javac
        },
        {arguments: ["-cp", ".", "semantifold.generated.main.Main"], stage: /** @type {const} */ ("execute"), tool: java}
      ],
      target: "java"
    }]

    for (const request of requests) {
      const target = /** @type {"php" | "ruby" | "javascript" | "typescript" | "java"} */ (request.target)
      const artifacts = generateProgramArtifactSet({language: target, program})
      const result = await runAcceptanceStages({artifacts, stages: request.stages, target, timeoutMs: 20_000})

      expect({output: result.stages.at(-1)?.stdout, target}).toEqual({output: "Ada\n", target})
    }
  })

  it("executes direct-plus-alias exports and mixed type/value record imports", async () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: `import type {User as UserType} from "./model.js"
import {User as UserValue} from "./model.js"
import {display} from "./library.js"
const user: UserType = new UserValue("Ada")
console.log(display(user))
`
      }, {
        filename: "library.ts",
        id: "library",
        language: "typescript",
        source: `import type {User} from "./model.js"
export function label(user: User): string { return user.name }
export {label as display}
`
      }, {
        filename: "model.ts",
        id: "model",
        language: "typescript",
        source: "export class User { constructor(readonly name: string) {} }\n"
      }]
    })
    const node = await discoverCanonicalToolchain("node")
    const tsc = await discoverCanonicalToolchain("tsc")
    const javascript = await runAcceptanceStages({
      artifacts: generateProgramArtifactSet({language: "javascript", program}),
      stages: [{arguments: ["main.js"], stage: "execute", tool: node}],
      target: "javascript",
      timeoutMs: 20_000
    })
    const typescript = await runAcceptanceStages({
      artifacts: generateProgramArtifactSet({language: "typescript", program}),
      stages: [{
        arguments: [
          "--target", "ES2024", "--module", "ES2022", "--moduleResolution", "bundler", "--outDir", "dist",
          "model.ts", "library.ts", "main.ts"
        ],
        stage: "compile",
        tool: tsc
      }, {arguments: ["dist/main.js"], stage: "execute", tool: node}],
      target: "typescript",
      timeoutMs: 20_000
    })

    expect(javascript.stages.at(-1)?.stdout).toEqual("Ada\n")
    expect(typescript.stages.at(-1)?.stdout).toEqual("Ada\n")
  })

  it("makes non-exported Ruby helpers inaccessible through the native module", async () => {
    const ruby = await discoverCanonicalToolchain("ruby")
    const artifacts = withProbe(
      generateProgramArtifactSet({language: "ruby", program: privateHelperProject()}),
      "probe.rb",
      "require_relative \"library\"\nprint Library.hidden\n"
    )

    await assert.rejects(
      () => runAcceptanceStages({
        artifacts,
        stages: [{arguments: ["probe.rb"], stage: "execute", tool: ruby}],
        target: "ruby"
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "ACCEPTANCE_NONZERO_EXIT"
    )
  })

  it("makes non-exported Java helpers inaccessible through the generated public class", async () => {
    const javac = await discoverCanonicalToolchain("javac")
    const artifacts = withProbe(
      generateProgramArtifactSet({language: "java", program: privateHelperProject()}),
      "Probe.java",
      `import semantifold.generated.library.Library;
public final class Probe {
  public static void main(String[] args) { System.out.print(Library.hidden()); }
}
`
    )

    await assert.rejects(
      () => runAcceptanceStages({
        artifacts,
        stages: [{
          arguments: ["semantifold/generated/library/Library.java", "Probe.java"],
          stage: "compile",
          tool: javac
        }],
        target: "java"
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "ACCEPTANCE_NONZERO_EXIT"
    )
  })

  it("rejects PHP modules whose non-exported declarations cannot be made module-private", () => {
    assert.throws(
      () => generateProgramArtifactSet({language: "php", program: privateHelperProject()}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "php" && error.detail.includes("non-exported declaration")
    )
  })
})
