// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, it} from "@velocious/testing"
import {generate, generateArtifact, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const fixture = async () => readFile(new URL("fixtures/records/program.ts", import.meta.url), "utf8")

const javascriptParameter = `class User {
  /** @param {string} name */
  constructor(name) {
    /** @readonly */
    this.name = name
    Object.freeze(this)
  }
}

/**
 * @param {string} User
 * @returns {User}
 */
function make(User) {
  return new User("Ada")
}

console.log(make("shadow").name)
`

const typescriptLocal = `class User {
  constructor(readonly name: string) {}
}

function make(): User {
  const User: string = "shadow"
  return new User("Ada")
}

console.log(make().name)
`

describe("closed record constructor-name collisions", () => {
  it("rejects JavaScript-family source parameters and locals at their exact binding names", () => {
    for (const [language, filename, source] of [
      ["javascript", "parameter.js", javascriptParameter],
      ["typescript", "local.ts", typescriptLocal]
    ]) {
      assert.throws(
        () => parse({filename, language, source}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "DUPLICATE_BINDING" &&
          error.language == language && error.location?.filename == filename &&
          source.slice(error.location.start.offset, error.location.end.offset) == "User"
      )
    }
  })

  it("rejects caller-supplied parameter and local captures before JavaScript-family output", async () => {
    const source = await fixture()
    const mutations = [
      (module) => {
        module.functions[0].parameters[0].name = "User"
        return module.functions[0].parameters[0].sourceProvenance?.ranges.name ?? module.functions[0].parameters[0].location
      },
      (module) => {
        const local = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.entryPoint.body.statements[0])

        local.name = "User"
        return local.sourceProvenance?.ranges.name ?? local.location
      }
    ]

    for (const language of ["javascript", "typescript"]) {
      for (const mutate of mutations) {
        for (const api of [generate, generateArtifact, generateArtifactSet]) {
          const module = parse({filename: "program.ts", language: "typescript", source})
          const location = mutate(module)

          assert.throws(
            () => api({language, module}),
            (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
              error.language == language && error.location === location && error.detail.includes("captures record constructor")
          )
        }
      }
    }
  })
})
