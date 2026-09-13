// @ts-check

import {describe, expect, it} from "@velocious/testing"
import assert from "node:assert/strict"
import {createCapabilityAuthority, generateProgramArtifactSet, parse, parseProgram, SemantifoldDiagnostic} from "../index.js"
import {task034AuthorityInput} from "./support/task034-authority.js"

describe("effectful capability semantic contract", () => {
  it("creates a detached deeply frozen authority with deterministic declaration identities", () => {
    const input = task034AuthorityInput()
    const authority = createCapabilityAuthority(input)

    input.capabilities[0].name = "Forged"
    expect(authority.id).toBe("semantifold.task034.resource-probe")
    expect(authority.capabilities[0].id).toBe("capability:0")
    expect(authority.capabilities[0].name).toBe("ResourceProbe")
    expect(authority.capabilities[0].resources[0].id).toBe("capability:0/resource:0")
    expect(authority.capabilities[0].failures[2].id).toBe("capability:0/failure:2")
    expect(authority.capabilities[0].operations[2].id).toBe("capability:0/operation:2")
    expect(authority.capabilities[0].operations[2].failureIds).toEqual([
      "capability:0/failure:2", "capability:0/failure:4"
    ])
    expect(Object.isFrozen(authority)).toBe(true)
    expect(Object.isFrozen(authority.capabilities[0].operations[2].resourceFlow)).toBe(true)
  })

  it("resolves authorized calls, owned resource types, borrows, failures, and ordered effect sites", () => {
    const authority = createCapabilityAuthority(task034AuthorityInput())
    const module = parse({
      capabilityAuthority: authority,
      filename: "probe.ts",
      language: "typescript",
      source: [
        "function run(value: number): number {",
        "  return probeEffect(\"body\", value, false)",
        "}",
        "const value: number = run(probeEffect(\"argument\", 1, false))",
        "const resource: ProbeResource = probeAcquire(false)",
        "try {",
        "  const line: string | null = probeRead(resource, false)",
        "  probeClose(resource, false)",
        "} catch (error) {",
        "  if (!(error instanceof ProbeReadFailure)) { throw error }",
        "  probeClose(resource, false)",
        "}",
        "console.log(probeTrace())"
      ].join("\n")
    })
    const bodyCall = module.functions[0].body.statements[0].expression
    const nestedCall = module.entryPoint.body.statements[0]
    const acquire = module.entryPoint.body.statements[1]
    const attempt = module.entryPoint.body.statements[2]
    const read = attempt.body.statements[0]
    const close = attempt.body.statements[1]
    const recoveryClose = attempt.catchBody.statements[0]

    expect(module.capabilities).toBe(authority.capabilities)
    expect(bodyCall.kind).toBe("EffectCallExpression")
    expect(bodyCall.effectSiteId).toBe("effect:0")
    expect(acquire.type.kind).toBe("OwnedResourceType")
    expect(acquire.type.resourceId).toBe("capability:0/resource:0")
    expect(acquire.type.sourceProvenance.ranges.type.start.line).toBe(5)
    expect(nestedCall.initializer.arguments[0].effectSiteId).toBe("effect:1")
    expect(nestedCall.initializer.effectSiteId).toBe("effect:2")
    expect(acquire.initializer.effectSiteId).toBe("effect:3")
    expect(read.initializer.arguments[0].kind).toBe("OwnedBorrowExpression")
    expect(read.initializer.arguments[0].mode).toBe("shared")
    expect(read.initializer.effectSiteId).toBe("effect:4")
    expect(close.expression.arguments[0].mode).toBe("exclusive")
    expect(close.expression.effectSiteId).toBe("effect:5")
    expect(recoveryClose.expression.effectSiteId).toBe("effect:6")
    expect(close.expression.resolution.failureIds).toEqual([
      "capability:0/failure:3", "capability:0/failure:4"
    ])
  })

  it("does not grant authority to an ordinary same-named source function", () => {
    const module = parse({
      capabilityAuthority: createCapabilityAuthority(task034AuthorityInput()),
      filename: "ordinary.ts",
      language: "typescript",
      source: "function probeTrace(): string { return \"ordinary\" }\nconsole.log(probeTrace())"
    })
    const call = module.entryPoint.body.statements[0].expression

    expect(call.kind).toBe("CallExpression")
    expect(call.effectSiteId).toBe(undefined)
  })

  it("propagates host effects through resolved method-to-method calls", () => {
    const module = parse({
      capabilityAuthority: createCapabilityAuthority(task034AuthorityInput()),
      filename: "method-effects.ts",
      language: "typescript",
      source: `class Counter {
  private value: number
  constructor(value: number) { this.value = value }
  read(): number { return probeEffect("read", this.value, false) }
  wrapped(): number { return this.read() }
}
const counter: Counter = new Counter(1)
function use(counter: Counter): number { return counter.wrapped() }
console.log(use(counter))`
    })
    const wrappedCall = module.classes[0].methods[1].body.statements[0].expression
    const useCall = module.functions[0].body.statements[0].expression
    const entryCall = module.entryPoint.body.statements[1].expression

    expect(wrappedCall.effectSiteId).toBe("effect:1")
    expect(wrappedCall.effects).toEqual(["host"])
    expect(wrappedCall.failureIds).toEqual(["capability:0/failure:0"])
    expect(useCall.effectSiteId).toBe("effect:2")
    expect(useCall.failureIds).toEqual(["capability:0/failure:0"])
    expect(entryCall.effectSiteId).toBe("effect:3")
    expect(entryCall.failureIds).toEqual(["capability:0/failure:0"])
  })

  it("rejects capability spelling without authority and malformed authority payloads", () => {
    assert.throws(() => parse({filename: "missing.ts", language: "typescript",
      source: "function run(): string { return probeTrace() }\nconsole.log(run())"}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "MISSING_CAPABILITY_AUTHORITY")
    assert.throws(() => createCapabilityAuthority(null),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_CAPABILITY_AUTHORITY")
    assert.throws(() => createCapabilityAuthority({...task034AuthorityInput(), schemaVersion: 2}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_CAPABILITY_AUTHORITY")

    const undeclaredTerminal = task034AuthorityInput()
    undeclaredTerminal.capabilities[0].operations[2].failures = ["ProbeReadFailure"]
    assert.throws(() => createCapabilityAuthority(undeclaredTerminal),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_CAPABILITY_AUTHORITY")

    const mismatchedAcquisition = task034AuthorityInput()
    mismatchedAcquisition.capabilities[0].operations[1].returnType = "integer"
    assert.throws(() => createCapabilityAuthority(mismatchedAcquisition),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_CAPABILITY_AUTHORITY")

    const untrackedResourceParameter = task034AuthorityInput()
    untrackedResourceParameter.capabilities[0].operations[0].parameters[0].type =
      {kind: "OwnedResourceType", resource: "ProbeResource"}
    assert.throws(() => createCapabilityAuthority(untrackedResourceParameter),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_CAPABILITY_AUTHORITY")

    const ambiguous = task034AuthorityInput()
    ambiguous.capabilities.push({...structuredClone(ambiguous.capabilities[0]), name: "OtherProbe"})
    assert.throws(() => createCapabilityAuthority(ambiguous),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_CAPABILITY_AUTHORITY")
  })

  it("keeps Task 034 authority outside the Task 010 multi-module profile", () => {
    const authority = createCapabilityAuthority(task034AuthorityInput())

    assert.throws(() => parseProgram({
      capabilityAuthority: authority,
      entryModule: "main",
      sources: [{filename: "main.ts", id: "main", language: "typescript",
        source: "export function run(): string { return \"ok\" }\nconsole.log(run())\n"}]
    }), (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY")

    const program = parseProgram({
      entryModule: "main",
      sources: [{filename: "main.ts", id: "main", language: "typescript",
        source: "export function run(): string { return \"ok\" }\nconsole.log(run())\n"}]
    })
    program.modules[0].capabilities = authority.capabilities
    assert.throws(() => generateProgramArtifactSet({language: "javascript", program}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY")
  })
})
