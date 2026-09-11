// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {
  discoverCanonicalToolchain,
  generateProgramArtifactSet,
  parseProgram,
  runAcceptanceStages
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
})
