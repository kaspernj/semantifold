// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, it} from "@velocious/testing"
import {generate, generateArtifact, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const moduleFromFixture = async () => parse({
  filename: "program.ts",
  language: "typescript",
  source: await readFile(new URL("fixtures/records/program.ts", import.meta.url), "utf8")
})

const rejected = (language) => (error) => error instanceof SemantifoldDiagnostic &&
  error.code == "UNSUPPORTED_CAPABILITY" && error.language == language && error.location?.filename == "program.ts"

describe("closed record backend validation", () => {
  it("rejects malformed identities, names, fields, locations, and complete type graphs before every output API", async () => {
    const mutations = [
      (module) => { module.records[0].id = "record:9" },
      (module) => { module.records[0].name = "address" },
      (module) => { module.records[0].fields[0].id = "record:0:field:9" },
      (module) => { module.records[0].fields[1].name = module.records[0].fields[0].name },
      (module) => { Reflect.set(module.records[0], "hidden", true) },
      (module) => { Reflect.set(module.records[0].fields[0], "hidden", true) },
      (module) => { Reflect.deleteProperty(module.records[0].fields[0], "location") },
      (module) => { module.records[1].fields[1].type = {declarationId: "record:99", kind: "RecordType"} },
      (module) => { module.records[0].fields[0].type = {declarationId: "record:0", kind: "RecordType"} },
      (module) => { module.records[0].fields[0].type = /** @type {any} */ ({kind: "TypeReference", name: "void"}) },
      (module) => { module.functions[0] = /** @type {any} */ (null) }
    ]

    for (const mutate of mutations) {
      for (const api of [generate, generateArtifact, generateArtifactSet]) {
        const module = await moduleFromFixture()

        mutate(module)
        assert.throws(() => api({language: "typescript", module}), rejected("typescript"))
      }
    }
  })

  it("rejects target-specific declaration, field, and inherited-method collisions", async () => {
    const cases = [
      ["php", (module) => { module.records[0].name = "Pass" }],
      ["php", (module) => { module.records[0].fields[0].name = "__get" }],
      ["ruby", (module) => { module.records[0].name = "String" }],
      ["ruby", (module) => { module.records[0].fields[0].name = "send" }],
      ["javascript", (module) => { module.records[0].name = "Object" }],
      ["javascript", (module) => { module.records[0].fields[0].name = "constructor" }],
      ["typescript", (module) => { module.records[0].name = "Map" }],
      ["typescript", (module) => { module.records[0].fields[0].name = "prototype" }],
      ["java", (module) => { module.records[0].name = "String" }],
      ["java", (module) => { module.records[0].fields[0].name = "toString" }]
    ]

    for (const [language, mutate] of cases) {
      const module = await moduleFromFixture()

      mutate(module)
      assert.throws(() => generateArtifactSet({language, module}), rejected(language), language)
    }
  })

  it("rejects stale construction and member identities plus Java target file constraints", async () => {
    const constructionModule = await moduleFromFixture()
    const construction = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (
      constructionModule.entryPoint.body.statements[0]
    ).initializer

    if (construction.kind != "RecordConstruction") throw new Error("Expected record construction fixture.")
    construction.record.declarationId = "record:99"
    assert.throws(() => generate({language: "typescript", module: constructionModule}), rejected("typescript"))

    const memberModule = await moduleFromFixture()
    const member = /** @type {import("../src/semantic/types.js").PrintStatement} */ (
      memberModule.entryPoint.body.statements.at(-1)
    ).expression

    if (member.kind != "MemberRead") throw new Error("Expected member read fixture.")
    member.field = "record:0:field:99"
    assert.throws(() => generate({language: "typescript", module: memberModule}), rejected("typescript"))

    const javaModule = await moduleFromFixture()

    assert.throws(() => generateArtifact({filename: "Records.java", language: "java", module: javaModule}), rejected("java"))
  })
})
