// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {createCapabilityAuthority, parse, parseProgram, SemantifoldDiagnostic} from "../index.js"
import {task034AuthorityInput} from "./support/task034-authority.js"

const authorityInput = task034AuthorityInput

describe("canonical stdlib calls and protected native binding authority", () => {
  it("resolves protected provider entry names to canonical operations under authority", () => {
    const module = parse({
      capabilityAuthority: createCapabilityAuthority(authorityInput()),
      filename: "protected.ts",
      language: "typescript",
      source: "console.log(__semantifold_provider_typescript_probeTrace())"
    })
    const call = module.entryPoint.body.statements[0].expression

    expect(call.kind).toBe("EffectCallExpression")
    expect(call.operation).toBe("capability:0/operation:4")
    expect(call.resolution.operationId).toBe("capability:0/operation:4")
    expect(call.effectSiteId).toBe("effect:0")
  })

  it("rejects portable attempts to access, forge, or capture the protected binding", () => {
    const cases = [
      {
        detail: "protected entry name without authority",
        input: () => parse({filename: "noauth.ts", language: "typescript",
          source: "console.log(__semantifold_provider_typescript_probeTrace())"})
      },
      {
        detail: "protected entry name for an undeclared operation",
        input: () => parse({
          capabilityAuthority: createCapabilityAuthority(authorityInput()),
          filename: "bogus.ts",
          language: "typescript",
          source: "console.log(__semantifold_provider_typescript_probeBogus())"
        })
      },
      {
        detail: "source declaration capturing a protected entry name",
        input: () => parse({
          capabilityAuthority: createCapabilityAuthority(authorityInput()),
          filename: "capture.ts",
          language: "typescript",
          source: "function __semantifold_provider_typescript_probeTrace(): string { return \"forged\" }\nconsole.log('x')"
        })
      },
      {
        detail: "record declaration capturing the protected prefix",
        input: () => parse({
          capabilityAuthority: createCapabilityAuthority(authorityInput()),
          filename: "capture-record.ts",
          language: "typescript",
          source: "class __semantifold_provider_typescript_probeTrace { constructor(readonly value: string) {} }\nconsole.log('x')"
        })
      }
    ]

    for (const {detail, input} of cases) {
      assert.throws(
        input,
        (error) => error instanceof SemantifoldDiagnostic &&
          error.code == "STDLIB_PROTECTED_BINDING_ACCESS" &&
          !/__semantifold_provider_\w+(?!\b)/u.test(error.message.replace("__semantifold_provider_typescript_probeTrace", "")),
        detail
      )
    }
  })

  it("keeps source functions winning over canonical and protected spellings", () => {
    const module = parse({
      capabilityAuthority: createCapabilityAuthority(authorityInput()),
      filename: "ordinary.ts",
      language: "typescript",
      source: "function probeTrace(): string { return \"ordinary\" }\nconsole.log(probeTrace())"
    })
    const call = module.entryPoint.body.statements[0].expression

    expect(call.kind).toBe("CallExpression")
    expect(call.effectSiteId).toBe(undefined)
  })

  it("accepts compiler authority in the Task 010 program profile with a stdlib contract descriptor", () => {
    const authority = createCapabilityAuthority(authorityInput())
    const program = parseProgram({
      capabilityAuthority: authority,
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: "export function run(): string { return probeTrace() }\nconsole.log(run())\n"
      }]
    })

    expect(program.stdlibContract).toEqual({identity: "semantifold.task034.resource-probe"})
    expect(program.modules[0].capabilities).toBe(authority.capabilities)
    const call = program.modules[0].functions[0].body.statements[0].expression

    expect(call.kind).toBe("EffectCallExpression")
    expect(call.operation).toBe("capability:0/operation:4")
  })

  it("carries the declared contract version range on the authority and program descriptor", () => {
    const versioned = createCapabilityAuthority({...authorityInput(), contractVersion: "1"})

    expect(versioned.contractVersion).toBe("1")
    const program = parseProgram({
      capabilityAuthority: versioned,
      entryModule: "main",
      sources: [{filename: "main.ts", id: "main", language: "typescript", source: "console.log('x')\n"}]
    })

    expect(program.stdlibContract).toEqual({contractVersion: "1", identity: "semantifold.task034.resource-probe"})
    assert.throws(
      () => createCapabilityAuthority({...authorityInput(), contractVersion: "bogus"}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_VERSION_MALFORMED"
    )
    assert.throws(
      () => createCapabilityAuthority({...authorityInput(), contractVersion: 1}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_VERSION_MALFORMED"
    )
  })

  it("rejects protected binding capture in program modules", () => {
    assert.throws(() => parseProgram({
      capabilityAuthority: createCapabilityAuthority(authorityInput()),
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: "export function __semantifold_provider_typescript_probeTrace(): string { return \"forged\" }\nconsole.log('x')\n"
      }]
    }), (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_PROTECTED_BINDING_ACCESS")
  })
})
