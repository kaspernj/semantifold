// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {SemantifoldDiagnostic} from "../index.js"
import {createStdlibContractRegistry} from "../src/semantic/stdlib.js"
import {createStdlibProviderRegistry, protectedEntryName} from "../src/stdlib-providers.js"
import {negotiateStdlibProviders} from "../src/stdlib-negotiation.js"

const probeIdentity = "semantifold.task034.resource-probe"
const probeOperations = ["probeEffect", "probeAcquire", "probeRead", "probeClose", "probeTrace"]

describe("stdlib capability negotiation", () => {
  it("selects the one compatible provider set for every adopted target", () => {
    for (const target of ["php", "ruby", "javascript", "typescript", "java"]) {
      const result = negotiateStdlibProviders({
        requirements: [{module: probeIdentity, operations: [...probeOperations]}],
        target
      })

      expect(result.target).toEqual(target)
      expect(result.modules).toEqual([{identity: probeIdentity, operations: probeOperations, version: "1.0.0"}])
      expect(result.providers).toHaveLength(1)
      const provider = result.providers[0]

      expect(provider.identity).toEqual(`semantifold.provider.${target}.${probeIdentity}`)
      expect(provider.target).toEqual(target)
      expect(provider.module).toEqual(probeIdentity)
      expect(provider.version).toEqual("1.0.0")
      expect(provider.operations).toEqual(probeOperations)
      expect(provider.nativeEntries).toEqual(Object.fromEntries(probeOperations.map((operation) => [
        operation, protectedEntryName(target, operation)
      ])))
      expect(Object.isFrozen(result)).toBe(true)
      expect(Object.isFrozen(result.modules[0])).toBe(true)
      expect(Object.isFrozen(result.providers[0].nativeEntries)).toBe(true)
    }
  })

  it("selects deterministically regardless of requirement order and repeated calls", () => {
    const first = negotiateStdlibProviders({
      requirements: [{module: probeIdentity, operations: ["probeRead", "probeAcquire", "probeClose"]}],
      target: "php"
    })
    const second = negotiateStdlibProviders({
      requirements: [{module: probeIdentity, operations: ["probeClose", "probeRead", "probeAcquire"]}],
      target: "php"
    })
    const third = negotiateStdlibProviders({
      requirements: [{module: probeIdentity, operations: ["probeAcquire", "probeRead", "probeClose"]}],
      target: "php"
    })

    expect(second).toEqual(first)
    expect(third).toEqual(first)
    expect(first.modules[0].operations).toEqual(["probeAcquire", "probeRead", "probeClose"])
  })

  it("reports exact missing, ambiguous, and undeclared-operation conditions before generation", () => {
    const contracts = createStdlibContractRegistry([
      contract("example.gamma", "1.0.0", [operation("gOne")])
    ])
    const providers = createStdlibProviderRegistry([])

    assert.throws(
      () => negotiateStdlibProviders({
        contracts,
        providers,
        requirements: [{module: "example.gamma", operations: ["gOne"]}],
        target: "php"
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_PROVIDER_MISSING"
    )

    const ambiguousContracts = createStdlibContractRegistry([contract("example.gamma", "1.0.0", [operation("gOne")])])
    const ambiguousProviders = createStdlibProviderRegistry([
      providerRecord("php", "semantifold.provider.php.example.gamma", "example.gamma", ["gOne"]),
      providerRecord("php", "semantifold.provider.php.example.gamma.b", "example.gamma", ["gOne"])
    ])

    assert.throws(
      () => negotiateStdlibProviders({
        contracts: ambiguousContracts,
        providers: ambiguousProviders,
        requirements: [{module: "example.gamma", operations: ["gOne"]}],
        target: "php"
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_PROVIDER_AMBIGUOUS"
    )

    const removedContracts = createStdlibContractRegistry([
      contract("example.alpha", "1.0.0", [operation("aBase"), operation("aHelper")]),
      contract("example.alpha", "1.1.0", [operation("aBase")]),
      contract("example.beta", "1.0.0", [operation("bUse", "example.alpha", "1", "aHelper")])
    ])

    assert.throws(
      () => negotiateStdlibProviders({
        contracts: removedContracts,
        providers: createStdlibProviderRegistry([
          providerRecord("php", "semantifold.provider.php.example.alpha", "example.alpha", ["aBase", "aHelper"]),
          providerRecord("php", "semantifold.provider.php.example.beta", "example.beta", ["bUse"])
        ]),
        requirements: [{module: "example.beta", operations: ["bUse"]}],
        target: "php"
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_OPERATION_UNDECLARED"
    )

    assert.throws(
      () => negotiateStdlibProviders({requirements: [{module: "example.nope", operations: ["x"]}], target: "php"}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_MODULE_UNKNOWN"
    )
    assert.throws(
      () => negotiateStdlibProviders({
        requirements: [{module: probeIdentity, operations: ["probeRead"], range: "bogus"}],
        target: "php"
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_VERSION_MALFORMED"
    )
  })

  it("computes the complete transitive closure across canonical dependencies", () => {
    const contracts = createStdlibContractRegistry([
      contract("example.alpha", "1.0.0", [operation("aBase"), operation("aHelper", "example.alpha", "1.0", "aBase")]),
      contract("example.beta", "1.0.0", [operation("bUse", "example.alpha", "1", "aHelper")])
    ])
    const providers = createStdlibProviderRegistry([
      providerRecord("php", "semantifold.provider.php.example.alpha", "example.alpha", ["aBase", "aHelper"]),
      providerRecord("php", "semantifold.provider.php.example.beta", "example.beta", ["bUse"],
        [{module: "example.alpha", range: "1"}])
    ])

    const result = negotiateStdlibProviders({
      contracts,
      providers,
      requirements: [{module: "example.beta", operations: ["bUse"]}],
      target: "php"
    })

    expect(result.modules).toEqual([
      {identity: "example.alpha", operations: ["aBase", "aHelper"], version: "1.0.0"},
      {identity: "example.beta", operations: ["bUse"], version: "1.0.0"}
    ])
    expect(result.providers.map(({identity}) => identity)).toEqual([
      "semantifold.provider.php.example.alpha",
      "semantifold.provider.php.example.beta"
    ])
  })

  it("fails with STDLIB_PROVIDER_MISSING when the selected provider does not cover every required operation", () => {
    const contracts = createStdlibContractRegistry([
      contract("example.alpha", "1.0.0", [operation("aBase"), operation("aHelper")])
    ])
    const providers = createStdlibProviderRegistry([
      providerRecord("php", "semantifold.provider.php.example.alpha", "example.alpha", ["aBase"])
    ])

    assert.throws(
      () => negotiateStdlibProviders({
        contracts,
        providers,
        requirements: [{module: "example.alpha", operations: ["aBase", "aHelper"]}],
        target: "php"
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_PROVIDER_MISSING"
    )
  })

  it("traverses provider-only dependency modules through selection and result closure", () => {
    const contracts = createStdlibContractRegistry([
      contract("example.alpha", "1.0.0", [operation("aOne")]),
      contract("example.beta", "1.0.0", [operation("bOne")])
    ])
    const providers = createStdlibProviderRegistry([
      providerRecord("php", "semantifold.provider.php.example.alpha", "example.alpha", ["aOne"]),
      providerRecord("php", "semantifold.provider.php.example.beta", "example.beta", ["bOne"],
        [{module: "example.alpha", range: "1"}])
    ])

    const result = negotiateStdlibProviders({
      contracts,
      providers,
      requirements: [{module: "example.beta", operations: ["bOne"]}],
      target: "php"
    })

    expect(result.modules).toEqual([
      {identity: "example.alpha", operations: [], version: "1.0.0"},
      {identity: "example.beta", operations: ["bOne"], version: "1.0.0"}
    ])
    expect(result.providers.map(({identity, operations, nativeEntries}) => ({identity, operations, nativeEntries}))).toEqual([
      {identity: "semantifold.provider.php.example.alpha", operations: [], nativeEntries: {}},
      {identity: "semantifold.provider.php.example.beta", operations: ["bOne"],
        nativeEntries: {bOne: protectedEntryName("php", "bOne")}}
    ])
  })

  it("rejects provider-only dependency cycles with STDLIB_PROVIDER_CYCLE", () => {
    const contracts = createStdlibContractRegistry([
      contract("example.alpha", "1.0.0", [operation("aOne")]),
      contract("example.beta", "1.0.0", [operation("bOne")])
    ])
    const providers = createStdlibProviderRegistry([
      providerRecord("php", "semantifold.provider.php.example.alpha", "example.alpha", ["aOne"],
        [{module: "example.beta", range: "1"}]),
      providerRecord("php", "semantifold.provider.php.example.beta", "example.beta", ["bOne"],
        [{module: "example.alpha", range: "1"}])
    ])

    assert.throws(
      () => negotiateStdlibProviders({
        contracts,
        providers,
        requirements: [{module: "example.beta", operations: ["bOne"]}],
        target: "php"
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_PROVIDER_CYCLE"
    )
  })

  it("fails deterministically on dependency cycles, missing dependencies, and conflicting versions", () => {
    const cycled = createStdlibContractRegistry([
      contract("example.alpha", "1.0.0", [operation("aOne", "example.beta", "1", "bOne")]),
      contract("example.beta", "1.0.0", [operation("bOne", "example.alpha", "1", "aOne")])
    ])
    const cycleProviders = createStdlibProviderRegistry([
      providerRecord("php", "semantifold.provider.php.example.alpha", "example.alpha", ["aOne"]),
      providerRecord("php", "semantifold.provider.php.example.beta", "example.beta", ["bOne"])
    ])

    assert.throws(
      () => negotiateStdlibProviders({
        contracts: cycled,
        providers: cycleProviders,
        requirements: [{module: "example.alpha", operations: ["aOne"]}],
        target: "php"
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_PROVIDER_CYCLE"
    )

    const missingDependency = createStdlibContractRegistry([contract("example.beta", "1.0.0", [operation("bUse")])])
    const missingDependencyProviders = createStdlibProviderRegistry([
      providerRecord("php", "semantifold.provider.php.example.beta", "example.beta", ["bUse"],
        [{module: "example.missing", range: "1"}])
    ])

    assert.throws(
      () => negotiateStdlibProviders({
        contracts: missingDependency,
        providers: missingDependencyProviders,
        requirements: [{module: "example.beta", operations: ["bUse"]}],
        target: "php"
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_PROVIDER_DEPENDENCY_MISSING"
    )

    const conflicting = createStdlibContractRegistry([
      contract("example.alpha", "1.0.0", [operation("aHelper")]),
      contract("example.alpha", "1.1.0", [operation("aBase")]),
      contract("example.beta", "1.0.0", [operation("bUse", "example.alpha", "1.0", "aHelper")])
    ])
    const conflictProviders = createStdlibProviderRegistry([
      providerRecord("php", "semantifold.provider.php.example.alpha", "example.alpha", ["aBase", "aHelper"]),
      providerRecord("php", "semantifold.provider.php.example.beta", "example.beta", ["bUse"])
    ])

    assert.throws(
      () => negotiateStdlibProviders({
        contracts: conflicting,
        providers: conflictProviders,
        requirements: [
          {module: "example.alpha", operations: ["aBase"], range: "1.1"},
          {module: "example.beta", operations: ["bUse"]}
        ],
        target: "php"
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_VERSION_INCOMPATIBLE"
    )
  })
})

function contract(identity, version, operations) {
  return {failures: [], identity, operations, resources: [], version}
}

function operation(name, module = undefined, range = undefined, dependencyOperation = undefined) {
  return {
    dependencies: module ? [{module, operation: dependencyOperation, range}] : [],
    effects: ["host"],
    evaluationOrder: "left-to-right",
    failures: [],
    name,
    parameters: [],
    resourceFlow: {kind: "none"},
    returnType: "void",
    semantics: {
      blocking: "synchronous",
      close: "not-applicable",
      eof: "not-applicable",
      encoding: "not-applicable",
      newline: "not-applicable",
      ownership: "not-applicable",
      timeout: "none"
    }
  }
}

function providerRecord(target, identity, module, operations, dependencies = []) {
  return {
    artifact: {mediaType: "application/x-httpd-php", path: `providers/${target}/example/${module.split(".")[1]}.php`},
    dependencies,
    identity,
    nativeEntries: Object.fromEntries(operations.map((name) => [name, protectedEntryName(target, name)])),
    provides: [{module, operations, version: "1.0.0"}],
    target
  }
}
