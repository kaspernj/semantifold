// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {
  createStdlibFacadeRegistry, listStdlibFacades, resolveStdlibFacade, SemantifoldDiagnostic
} from "../index.js"

const languages = ["php", "ruby", "javascript", "typescript", "java"]
const probeContract = "semantifold.task034.resource-probe"

describe("versioned language compatibility stdlib facade registry", () => {
  it("exposes immutable executable definitions and matching public declarations for the original five", () => {
    const facades = listStdlibFacades()

    expect(facades).toHaveLength(17)
    expect(Object.isFrozen(facades)).toBe(true)
    for (const language of languages) {
      const publicFacade = resolveStdlibFacade(language, nativeProbeModule(language), publicProbeName(language), "1")

      expect(publicFacade).toMatchObject({
        dependencies: [{identity: `semantifold.task036.${language}.probe-runner`, range: "1"}],
        identity: `semantifold.task036.${language}.probe`,
        language,
        publicDeclarations: [{
          effects: ["host"],
          failures: [],
          forms: ["direct-call"],
          kind: "function",
          name: publicProbeName(language),
          ownership: "not-applicable",
          parameters: [{name: "label", type: "string"}],
          returnType: "string"
        }],
        requirements: [],
        runtimeProfile: `${language}-task036-v1`,
        source: {id: `semantifold.facade.${language}.probe`},
        version: "1.0.0",
        visibility: "public"
      })
      expect(publicFacade.nativeModules).toEqual([{identity: nativeProbeModule(language), kind: "module", symbols: [publicProbeName(language)]}])
      expect(typeof publicFacade.source.content).toBe("string")
      expect(publicFacade.source.content.length > 0).toBe(true)
      expect(Object.isFrozen(publicFacade)).toBe(true)

      const runner = facades.find(({identity}) => identity == `semantifold.task036.${language}.probe-runner`)

      expect(runner).toMatchObject({
        language,
        nativeModules: [],
        requirements: [{module: probeContract, operations: ["probeEffect", "probeTrace"], range: "1"}],
        visibility: "internal"
      })
      expect(facades.some(({identity}) => identity == `semantifold.task036.${language}.unused`)).toBe(true)
    }
  })

  it("resolves the highest compatible facade version by exact native module and symbol identity", () => {
    const registry = createStdlibFacadeRegistry([
      record("1.0.0", "return value"),
      record("1.1.0", "return value")
    ])

    expect(registry.resolveFacade("typescript", "node:example", "echo", "1").version).toBe("1.1.0")
    expect(registry.resolveFacade("typescript", "node:example", "echo", "1.0").version).toBe("1.0.0")
    assert.throws(
      () => registry.resolveFacade("typescript", "node:example", "echo", "2"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_FACADE_VERSION_INCOMPATIBLE"
    )
  })

  it("rejects unproved identities, unsupported members, malformed definitions, and caller mutation", () => {
    assert.throws(
      () => resolveStdlibFacade("typescript", "node:unknown", "echo"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_FACADE_IDENTITY_UNPROVED"
    )
    assert.throws(
      () => resolveStdlibFacade("typescript", "semantifold:task036/probe", "missing"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_FACADE_MEMBER_UNSUPPORTED"
    )

    const mutable = record("1.0.0", "return value")
    const registry = createStdlibFacadeRegistry([mutable])

    mutable.source.content = "changed"
    mutable.publicDeclarations[0].parameters[0].name = "changed"
    expect(registry.resolveFacade("typescript", "node:example", "echo").source.content).toContain("return value")
    expect(registry.resolveFacade("typescript", "node:example", "echo").publicDeclarations[0].parameters[0].name).toBe("value")

    for (const invalid of [
      {...record("1.0.0", "return value"), version: "01.0.0"},
      {...record("1.0.0", "return value"), requirements: [{module: probeContract, operations: ["missing"], range: "1"}]},
      {...record("1.0.0", "return value"), nativeModules: [{identity: "node:example", kind: "module", symbols: ["missing"]}]},
      {...record("1.0.0", "return value"), source: {...record("1.0.0", "return value").source, content: ""}}
    ]) {
      assert.throws(
        () => createStdlibFacadeRegistry([invalid]),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_FACADE_INVALID"
      )
    }
  })

  it("rejects version-resolved facade dependency cycles before selection", () => {
    const first = identifiedRecord("example.typescript.first", "first")
    const second = identifiedRecord("example.typescript.second", "second")

    first.dependencies = [{identity: second.identity, range: "1"}]
    second.dependencies = [{identity: first.identity, range: "1"}]
    assert.throws(
      () => createStdlibFacadeRegistry([first, second]),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_FACADE_INVALID"
    )
  })
})

function nativeProbeModule(language) {
  if (language == "php") return "Semantifold\\Task036\\Probe"
  if (language == "ruby") return "semantifold/task036/probe"
  if (language == "java") return "semantifold.task036.Probe"
  return "semantifold:task036/probe"
}

function publicProbeName(language) {
  return language == "php" || language == "ruby" ? "compatibility_probe" : "compatibilityProbe"
}

function record(version, body) {
  return {
    dependencies: [],
    identity: "example.typescript.echo",
    language: "typescript",
    nativeModules: [{identity: "node:example", kind: "module", symbols: ["echo"]}],
    publicDeclarations: [{
      effects: [], failures: [], forms: ["direct-call"], kind: "function", name: "echo",
      ownership: "not-applicable", parameters: [{name: "value", type: "string"}], returnType: "string"
    }],
    requirements: [],
    runtimeProfile: "typescript-example-v1",
    source: {
      content: `export function echo(value: string): string { ${body} }\n`,
      filename: "__semantifold_facades__/typescript/example.ts",
      id: "semantifold.facade.typescript.example"
    },
    version,
    visibility: "public"
  }
}

function identifiedRecord(identity, suffix) {
  const candidate = record("1.0.0", "return value")

  candidate.identity = identity
  candidate.nativeModules = [{identity: `node:${suffix}`, kind: "module", symbols: ["echo"]}]
  candidate.source = {
    ...candidate.source,
    filename: `__semantifold_facades__/typescript/${suffix}.ts`,
    id: `semantifold.facade.typescript.${suffix}`
  }
  return candidate
}
