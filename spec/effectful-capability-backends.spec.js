// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {createCapabilityAuthority, generate, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"
import {task034AuthorityInput} from "./support/task034-authority.js"

const authority = createCapabilityAuthority(task034AuthorityInput())

async function fixtureModule() {
  const source = await readFile(new URL("fixtures/effectful-capabilities/program.ts", import.meta.url), "utf8")
  return parse({capabilityAuthority: authority, filename: "program.ts", language: "typescript", source})
}

describe("effectful capability backend preflight and generation", () => {
  it("emits deterministic protected conformance support for the original five targets", async () => {
    const module = await fixtureModule()

    for (const language of ["php", "ruby", "javascript", "typescript", "java"]) {
      const first = generate({language, module})
      const second = generate({language, module})

      expect(second).toBe(first)
      expect(first.includes("semantifold-task034-support")).toBe(true)
      expect(first.includes("SEMANTIFOLD_TASK034_PROBE_PATH")).toBe(true)
      expect(first.includes("ProbeResourceClosed")).toBe(true)
      expect(first.includes("probeAcquire")).toBe(true)
      expect(first.includes("probeClose")).toBe(true)
    }

    const php = generate({language: "php", module})

    expect(php.includes("@fopen")).toBe(true)
    expect(php.includes("@fgets")).toBe(true)
    expect(php.includes("@fclose")).toBe(true)
    expect(php.includes("feof($resource->handle)")).toBe(true)
  })

  it("emits protected resource support for a transfer-only owned signature", () => {
    const module = parse({
      capabilityAuthority: authority,
      filename: "transfer-only.ts",
      language: "typescript",
      source: `function transfer(resource: ProbeResource): ProbeResource { return resource }
console.log("ok")`
    })

    for (const language of ["php", "ruby", "javascript", "typescript", "java"]) {
      expect(generate({language, module}).includes("semantifold-task034-support")).toBe(true)
    }
  })

  it("fails unsupported targets and arbitrary authorities transactionally", async () => {
    const module = await fixtureModule()
    assert.throws(() => generate({language: "python", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.location?.filename == "program.ts")
    assert.throws(() => generateArtifactSet({language: "c", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.detail.includes("Task 034") && error.location?.filename == "program.ts")

    const otherInput = task034AuthorityInput()
    otherInput.id = "example.other-authority"
    const other = createCapabilityAuthority(otherInput)
    const otherModule = parse({
      capabilityAuthority: other,
      filename: "other.ts",
      language: "typescript",
      source: "function run(): string { return probeTrace() }\nconsole.log(run())"
    })
    assert.throws(() => generate({language: "javascript", module: otherModule}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY")

    const forgedInput = task034AuthorityInput()
    forgedInput.capabilities[0].operations[0].returnType = "string"
    const forgedModule = parse({
      capabilityAuthority: createCapabilityAuthority(forgedInput),
      filename: "forged.ts",
      language: "typescript",
      source: "function run(): string { return probeTrace() }\nconsole.log(run())"
    })
    assert.throws(() => generate({language: "javascript", module: forgedModule}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.detail.includes("unbound Task 034 capability authority"))
  })

  it("rejects ordinary declarations that collide with required protected support", () => {
    const module = parse({
      capabilityAuthority: authority,
      filename: "support-collision.ts",
      language: "typescript",
      source: `function probeTrace(): string { return "ordinary" }
function run(): number { return probeEffect("effect", 1, false) }
console.log(probeTrace())
console.log(run())`
    })

    assert.throws(() => generate({language: "javascript", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.detail.includes("protected Task 034 support") && error.location?.filename == "support-collision.ts")
  })

  it("rejects stale effect order and excluded conditional effect contexts before emission", async () => {
    const module = structuredClone(await fixtureModule())
    module.functions[0].body.statements[0].expression.effectSiteId = "effect:99"
    assert.throws(() => generate({language: "javascript", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.detail.includes("effect"))

    const source = `function run(): boolean {
  return probeEffect("left", 1, false) === 1 && probeEffect("right", 2, false) === 2
}
console.log(run())`
    const conditional = parse({capabilityAuthority: authority, filename: "conditional.ts", language: "typescript", source})
    assert.throws(() => generate({language: "javascript", module: conditional}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.location?.filename == "conditional.ts")

    const malformed = /** @type {any} */ (structuredClone(await fixtureModule()))
    malformed.functions = null
    assert.throws(() => generate({language: "javascript", module: malformed}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.location?.filename == "program.ts")
  })

  it("distinguishes a forged typed failure boundary from a forged effect", async () => {
    const module = structuredClone(await fixtureModule())
    const close = module.functions[0].body.statements[0].expression

    close.resolution.failureIds = ["capability:0/failure:0"]
    assert.throws(() => generate({language: "javascript", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.detail.includes("UNDECLARED_FAILURE"))
  })

  it("rejects Task 034 IR whose capability authority graph is missing", async () => {
    const module = /** @type {any} */ (structuredClone(await fixtureModule()))

    delete module.capabilities
    assert.throws(() => generate({language: "javascript", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.detail.includes("MISSING_CAPABILITY_AUTHORITY") && error.location?.filename == "program.ts")
    assert.throws(() => generateArtifactSet({language: "c", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.detail.includes("MISSING_CAPABILITY_AUTHORITY") && error.location?.filename == "program.ts")
  })

  it("rejects a caller-authored borrow that escapes through ownership transfer", async () => {
    const module = structuredClone(await fixtureModule())
    const transfer = module.entryPoint.body.statements[1].expression.arguments[0]

    transfer.kind = "OwnedBorrowExpression"
    transfer.mode = "shared"
    assert.throws(() => generate({language: "javascript", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.detail.includes("BORROW_ESCAPE"))

    const wrongMode = structuredClone(await fixtureModule())
    wrongMode.functions[0].body.statements[0].expression.arguments[0].mode = "shared"
    assert.throws(() => generate({language: "javascript", module: wrongMode}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.detail.includes("INVALID_RESOURCE_BORROW"))
  })

  it("lowers nested effects to collision-safe temporaries in semantic evaluation order", () => {
    const module = parse({
      capabilityAuthority: authority,
      filename: "order.ts",
      language: "typescript",
      source: `function combine(first: number, second: number): number { return first * 10 + second }
console.log(combine(probeEffect("left", 1, false), probeEffect("right", 2, false)))`
    })

    for (const language of ["php", "ruby", "javascript", "typescript", "java"]) {
      const code = generate({language, module})
      const left = code.indexOf('probeEffect("left", 1, false)')
      const right = code.indexOf('probeEffect("right", 2, false)')
      const combine = code.lastIndexOf("combine(")

      expect(code.includes("__semantifold_effect_0")).toBe(true)
      expect(code.includes("__semantifold_effect_1")).toBe(true)
      expect(left < right).toBe(true)
      expect(right < combine).toBe(true)
    }

    const mapModule = parse({
      capabilityAuthority: authority,
      filename: "map.ts",
      language: "typescript",
      source: `function mapping(): ReadonlyMap<string, number> {
  return new Map([["value", probeEffect("map", 1, false)]])
}
console.log(mapping().size)`
    })
    const filenames = new Map([
      ["php", "program.php"], ["ruby", "program.rb"], ["javascript", "program.js"],
      ["typescript", "program.ts"], ["java", "Main.java"]
    ])

    for (const language of ["php", "ruby", "javascript", "typescript", "java"]) {
      const code = generate({language, module: mapModule})

      parse({capabilityAuthority: authority, filename: filenames.get(language), language, source: code})
    }
  })
})
