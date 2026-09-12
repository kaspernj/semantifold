// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, it} from "@velocious/testing"
import {generate, generateProgramArtifactSet, parse, parseProgram, SemantifoldDiagnostic} from "../index.js"

function rejected(module, detail) {
  assert.throws(
    () => generate({language: "typescript", module}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
      error.language == "typescript" && error.detail.toLowerCase().includes(detail) && error.location != undefined
  )
}

describe("reference class backend validation", () => {
  it("rejects malformed class, constructor, field, method, and resolution shapes before emission", async () => {
    const source = await readFile(new URL("fixtures/reference-classes/program.ts", import.meta.url), "utf8")
    const original = parse({filename: "program.ts", language: "typescript", source})
    const mutations = [
      ["invalid reference class declaration", (module) => { module.classes[0].kind = "RecordDeclaration" }],
      ["invalid private field", (module) => { module.classes[0].fields[0].kind = "RecordField" }],
      ["invalid reference class declaration", (module) => {
        module.classes[0].fields = []
        module.classes[0].constructor.parameters = []
        module.classes[0].constructor.body.statements = []
      }],
      ["invalid constructor declaration", (module) => { module.classes[0].constructor.id = "class:9:constructor" }],
      ["invalid method declaration", (module) => { module.classes[0].methods[0].id = "class:0:method:9" }],
      ["invalid constructor parameter", (module) => { module.classes[0].constructor.parameters[0].kind = "ValueBinding" }],
      ["reference class declaration location", (module) => { module.classes[0].location = null }],
      ["private field location", (module) => { module.classes[0].fields[0].location = null }],
      ["constructor declaration location", (module) => { module.classes[0].constructor.location = null }],
      ["method declaration location", (module) => { module.classes[0].methods[0].location = null }],
      ["constructor parameter location", (module) => { module.classes[0].constructor.parameters[0].location = null }],
      ["parameter identifier", (module) => { module.classes[0].methods[0].parameters[0].name = "class" }],
      ["target class member collision", (module) => { module.classes[0].methods[0].name = "value" }],
      ["reserved reference lifecycle method", (module) => { module.classes[0].methods[0].name = "constructor" }],
      ["resolved constructor signature", (module) => {
        module.entryPoint.body.statements[0].initializer.resolution.declarationId = "class:9"
      }],
      ["resolved method signature", (module) => {
        module.entryPoint.body.statements[3].expression.resolution.declarationId = "class:0:method:9"
      }]
    ]

    for (const [detail, mutate] of mutations) {
      const module = structuredClone(original)

      mutate(module)
      rejected(module, detail)
    }

    const targetHooks = [
      ["javascript", "toString"],
      ["typescript", "toString"],
      ["php", "__invoke"],
      ["ruby", "method_missing"],
      ["ruby", "size"],
      ["ruby", "value="],
      ["java", "equals"]
    ]

    for (const [language, name] of targetHooks) {
      const module = structuredClone(original)

      module.classes[0].methods[0].name = name
      assert.throws(
        () => generate({language, module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == language && error.detail.includes("reserved reference method")
      )
    }

    const phpCollision = structuredClone(original)

    phpCollision.errors = [{id: "error:0", kind: "ErrorDeclaration", location: phpCollision.classes[0].location, name: "counter"}]
    assert.throws(
      () => generate({language: "php", module: phpCollision}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.detail.includes("reference class collision")
    )
  })

  it("rejects non-receiver private access and invalid private-field identity", async () => {
    const source = await readFile(new URL("fixtures/reference-classes/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const write = module.classes[0].methods[0].body.statements[0]

    write.receiver.kind = "IdentifierExpression"
    write.receiver.name = "value"
    rejected(module, "private field receiver")

    const second = parse({filename: "program.ts", language: "typescript", source})

    second.classes[0].methods[0].body.statements[0].field = "class:1:field:0"
    rejected(second, "private field identity")
  })

  it("rejects caller-added reference classes from Task 010 program generation", async () => {
    const source = await readFile(new URL("fixtures/reference-classes/program.ts", import.meta.url), "utf8")
    const referenceModule = parse({filename: "program.ts", language: "typescript", source})
    const program = parseProgram({
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: "function keep(): number { return 0 }\nconsole.log(keep())\n"
      }]
    })

    Reflect.set(program.modules[0], "classes", structuredClone(referenceModule.classes))
    assert.throws(
      () => generateProgramArtifactSet({language: "typescript", program}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.detail.includes("Task 033 reference classes")
    )
  })

  it("protects target runtime scaffolding inside reference methods", async () => {
    const source = await readFile(new URL("fixtures/reference-classes/program.ts", import.meta.url), "utf8")
    const module = parse({filename: "program.ts", language: "typescript", source})
    const method = module.classes[0].methods[2]

    method.body.statements.unshift({
      initializer: {entries: [], kind: "MapLiteral", location: method.location},
      kind: "LocalDeclaration",
      location: method.location,
      mutable: false,
      name: "Map",
      type: {
        keyType: {kind: "TypeReference", name: "string"},
        kind: "MapType",
        valueType: {kind: "TypeReference", name: "integer"}
      }
    })
    assert.throws(
      () => generate({language: "javascript", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.detail.includes("method local 'Map' captures backend scaffolding")
    )
  })
})
