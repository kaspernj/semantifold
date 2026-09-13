// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {SemantifoldDiagnostic} from "../index.js"
import {createStdlibContractRegistry, listStdlibModules, resolveStdlibModule} from "../src/semantic/stdlib.js"

const probeIdentity = "semantifold.task034.resource-probe"
const probeOperationFields = "dependencies,effects,evaluationOrder,failures,name,parameters,resourceFlow,returnType,semantics"

describe("versioned canonical stdlib contract registry", () => {
  it("exposes the built-in probe contract as public, inspectable, versioned declarations", () => {
    const modules = listStdlibModules()

    expect(modules).toEqual([{identity: probeIdentity, versions: ["1.0.0"]}])
    expect(Object.isFrozen(modules)).toBe(true)
    expect(Object.isFrozen(modules[0])).toBe(true)
    expect(Object.isFrozen(modules[0].versions)).toBe(true)

    const contract = resolveStdlibModule(probeIdentity, "1.0.0")

    expect(contract.identity).toEqual(probeIdentity)
    expect(contract.version).toEqual("1.0.0")
    expect(contract.schema).toEqual("SemantifoldStdlibContract")
    expect(contract.schemaVersion).toEqual(1)
    expect(contract.resources).toEqual([{name: "ProbeResource"}])
    expect(contract.failures).toEqual([
      {name: "ProbeOperationFailure"},
      {name: "ProbeAcquireFailure"},
      {name: "ProbeReadFailure"},
      {name: "ProbeCloseFailure"},
      {name: "ProbeResourceClosed"}
    ])
    expect(contract.operations.map(({name}) => name)).toEqual([
      "probeEffect", "probeAcquire", "probeRead", "probeClose", "probeTrace"
    ])

    for (const operation of contract.operations) {
      expect(Object.keys(operation).sort().join(",")).toEqual(probeOperationFields)
      expect(operation.effects).toEqual(["host"])
      expect(operation.evaluationOrder).toEqual("left-to-right")
      expect(Array.isArray(operation.dependencies)).toBe(true)
      const semantics = operation.semantics

      expect(Object.keys(semantics).sort().join(",")).toEqual(
        "blocking,close,encoding,eof,newline,ownership,timeout")
    }
    expect(Object.isFrozen(contract)).toBe(true)
    expect(Object.isFrozen(contract.operations[0].semantics)).toBe(true)
  })

  it("declares the probe operation semantics as closed canonical contract fields", () => {
    const contract = resolveStdlibModule(probeIdentity, "1.0.0")
    const byName = new Map(contract.operations.map((operation) => [operation.name, operation]))

    expect(byName.get("probeRead").semantics).toEqual({
      blocking: "synchronous",
      close: "use-after-close-fails",
      eof: "absent-value",
      encoding: "utf-8",
      newline: "strip-line-terminator",
      ownership: "borrowed",
      timeout: "none"
    })
    expect(byName.get("probeClose").semantics).toEqual({
      blocking: "synchronous",
      close: "repeated-close-fails",
      eof: "not-applicable",
      encoding: "not-applicable",
      newline: "not-applicable",
      ownership: "consumed",
      timeout: "none"
    })
    expect(byName.get("probeEffect").semantics).toEqual({
      blocking: "synchronous",
      close: "not-applicable",
      eof: "not-applicable",
      encoding: "not-applicable",
      newline: "not-applicable",
      ownership: "not-applicable",
      timeout: "none"
    })
    expect(byName.get("probeAcquire").semantics.ownership).toEqual("acquired")
    expect(byName.get("probeTrace").dependencies).toEqual([])
  })

  it("resolves references by identity plus a compatible version range", () => {
    expect(resolveStdlibModule(probeIdentity, "1").version).toEqual("1.0.0")
    expect(resolveStdlibModule(probeIdentity, "1.0").version).toEqual("1.0.0")
    expect(resolveStdlibModule(probeIdentity, "1.0.0").version).toEqual("1.0.0")
    expect(resolveStdlibModule(probeIdentity, undefined).version).toEqual("1.0.0")

    assert.throws(
      () => resolveStdlibModule(probeIdentity, "2"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_VERSION_INCOMPATIBLE"
    )
    assert.throws(
      () => resolveStdlibModule(probeIdentity, "1.0.1"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_VERSION_INCOMPATIBLE"
    )
    assert.throws(
      () => resolveStdlibModule(probeIdentity, "0.9.9"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_VERSION_INCOMPATIBLE"
    )
  })

  it("selects the highest registered version satisfying the declared range", () => {
    const registry = createStdlibContractRegistry([
      moduleRecord("example.demo", "1.0.0"),
      moduleRecord("example.demo", "1.2.3"),
      moduleRecord("example.demo", "2.0.0"),
      moduleRecord("example.other", "1.0.0")
    ])

    expect(registry.resolveModule("example.demo", "1").version).toEqual("1.2.3")
    expect(registry.resolveModule("example.demo", "1.0").version).toEqual("1.0.0")
    expect(registry.resolveModule("example.demo", "1.2").version).toEqual("1.2.3")
    expect(registry.resolveModule("example.demo", "2").version).toEqual("2.0.0")
    expect(registry.resolveModule("example.demo", undefined).version).toEqual("2.0.0")
    assert.throws(
      () => registry.resolveModule("example.demo", "1.2.4"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_VERSION_INCOMPATIBLE"
    )
  })

  it("reports unknown canonical identities and malformed versions or ranges", () => {
    assert.throws(
      () => resolveStdlibModule("example.unknown", "1"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_MODULE_UNKNOWN"
    )
    assert.throws(
      () => resolveStdlibModule(probeIdentity, ""),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_VERSION_MALFORMED"
    )
    for (const range of ["v1", "1.0.0.0", "01.0.0", "1.", ".0", "1.0.0-beta", "1..0", 7, null, {}]) {
      assert.throws(
        () => resolveStdlibModule(probeIdentity, range),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_VERSION_MALFORMED",
        `range ${JSON.stringify(range)}`
      )
    }
  })

  it("rejects malformed canonical contract records with normalized diagnostics", () => {
    const valid = moduleRecord("example.demo", "1.0.0")

    for (const records of [
      "nope",
      [valid, valid],
      [moduleRecord("example.demo", "1.0.0.0")],
      [{...valid, identity: "Example.Demo", version: "1.0.0", operations: []}],
      [{...valid, identity: "example.demo", version: "1.0.0", operations: null}],
      [{...valid, identity: "example.demo", version: "1.0.0", operations: "nope"}],
      [{...valid, identity: "example.demo", version: "1.0.0", operations: [{...valid.operations[0], parameters: null}]}],
      [{...valid, identity: "example.demo", version: "1.0.0", operations: [{...valid.operations[0], surprise: true}]}],
      [{...valid, identity: "example.demo", version: "1.0.0",
        operations: [{...valid.operations[0], failures: ["UndeclaredFailure"]}]}],
      [{...valid, identity: "example.demo", version: "1.0.0",
        operations: [{...valid.operations[0], parameters: [{name: "value", type: "resource"}]}]}],
      [{...valid, identity: "example.demo", version: "1.0.0",
        operations: [{...valid.operations[0], dependencies: [{module: "example.missing", range: "1", operation: "nope"}]}]}],
      [{...valid, identity: "example.demo", version: "1.0.0",
        operations: [{...valid.operations[0], semantics: {...valid.operations[0].semantics, blocking: "async-later"}}]}],
      [moduleRecord("example.demo", "1.0.0", [{name: "first", parameters: [], returnType: "void", effects: ["host"],
        failures: [], resourceFlow: {kind: "none"}, dependencies: [{module: "example.demo", range: "1", operation: "first"}]}])]
    ]) {
      assert.throws(
        () => createStdlibContractRegistry(records),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_CONTRACT_INVALID",
        `record set ${JSON.stringify(records)?.slice(0, 80)}`
      )
    }
  })

  it("keeps registry contents detached from caller-owned record objects", () => {
    const candidate = moduleRecord("example.demo", "1.0.0")
    const registry = createStdlibContractRegistry([candidate])

    candidate.identity = "forged"
    candidate.operations[0].name = "forged"
    expect(registry.resolveModule("example.demo", "1").identity).toEqual("example.demo")
    expect(registry.resolveModule("example.demo", "1").operations[0].name).toEqual("first")
  })
})

function moduleRecord(identity, version, operations = undefined) {
  const resource = identity == probeIdentity ? [{name: "ProbeResource"}] : []
  const failure = identity == probeIdentity ? [{name: "ProbeOperationFailure"}] : []

  return {
    failures: failure,
    identity,
    operations: operations ?? [{
      dependencies: [],
      effects: ["host"],
      evaluationOrder: "left-to-right",
      failures: identity == probeIdentity ? ["ProbeOperationFailure"] : [],
      name: identity == probeIdentity ? "probeEffect" : "first",
      parameters: identity == probeIdentity
        ? [{name: "label", type: "string"}, {name: "value", type: "integer"}] : [{name: "value", type: "integer"}],
      resourceFlow: {kind: "none"},
      returnType: identity == probeIdentity ? "integer" : "void",
      semantics: {
        blocking: "synchronous",
        close: "not-applicable",
        eof: "not-applicable",
        encoding: "not-applicable",
        newline: "not-applicable",
        ownership: "not-applicable",
        timeout: "none"
      }
    }],
    resources: resource,
    version
  }
}
