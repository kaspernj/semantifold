// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {languageCapabilities, SemantifoldDiagnostic} from "../index.js"
import {
  createStdlibProviderRegistry,
  listStdlibProviders,
  protectedEntryName,
  stdlibProviderRegistry
} from "../src/stdlib-providers.js"

const probeIdentity = "semantifold.task034.resource-probe"
const probeOperations = ["probeEffect", "probeAcquire", "probeRead", "probeClose", "probeTrace"]
const originalFive = ["php", "ruby", "javascript", "typescript", "java"]

describe("target host provider registry", () => {
  it("marks only adopted targets with the provider role in truthful public descriptors", () => {
    for (const descriptor of languageCapabilities) {
      expect(descriptor.roles.provider).toBe(originalFive.includes(descriptor.id))
    }
  })

  it("registers one deterministic provider per adopted target for the probe contract", () => {
    const providers = listStdlibProviders()

    expect(providers.map(({target}) => target)).toEqual(originalFive)
    expect(Object.isFrozen(providers)).toBe(true)

    for (const provider of providers) {
      expect(provider.identity).toEqual(`semantifold.provider.${provider.target}.${probeIdentity}`)
      expect(provide(providers, provider.target))
    }

    function provide(all, target) {
      const record = all.find(({target: candidate}) => candidate == target)

      expect(record.target).toEqual(target)
      expect(record.provides).toEqual([{module: probeIdentity, operations: probeOperations, version: "1.0.0"}])
      expect(record.dependencies).toEqual([])
      expect(record.artifact.path).toEqual(
        `providers/${target}/semantifold/task034/resource-probe.${target == "php" ? "php" :
          target == "ruby" ? "rb" : target == "javascript" ? "js" : target == "typescript" ? "ts" : "java"}`)
      expect(record.nativeEntries).toEqual(Object.fromEntries(probeOperations.map((operation) => [
        operation,
        protectedEntryName(target, operation)
      ])))
      expect(Object.isFrozen(record)).toBe(true)
      expect(Object.isFrozen(record.provides[0])).toBe(true)
      return true
    }
  })

  it("derives protected native entry names deterministically from target and operation", () => {
    expect(protectedEntryName("php", "probeRead")).toEqual("__semantifold_provider_php_probeRead")
    expect(protectedEntryName("javascript", "probeTrace")).toEqual("__semantifold_provider_javascript_probeTrace")
    expect(protectedEntryName("java", "probeEffect")).toEqual("__semantifold_provider_java_probeEffect")
    expect(stdlibProviderRegistry.providersFor("php", probeIdentity, "1.0.0")).toHaveLength(1)
    expect(stdlibProviderRegistry.providersFor("python", probeIdentity, "1.0.0")).toEqual([])
  })

  it("rejects malformed provider records, duplicates, and role overstatement", () => {
    const valid = providerRecord("php")

    const invalid = [
      "nope",
      [valid, valid],
      [providerRecord("python")],
      [{...valid, identity: "semantifold.provider.php.example.unknown",
        provides: [{module: "example.unknown", operations: ["first"], version: "1.0.0"}],
        nativeEntries: {first: "__semantifold_provider_php_first"}}],
      [{...valid, identity: "semantifold.provider.php.example.unknown",
        provides: [{module: "example.unknown", operations: ["first"], version: "1.0.0"}],
        nativeEntries: {first: "__semantifold_provider_php_first"}}],
      [{...valid, identity: "example.provider.php", provides: [{module: probeIdentity, operations: ["probeEffect"], version: "1.0.0"}],
        nativeEntries: {probeEffect: protectedEntryName("php", "probeEffect")}}],
      [{...valid, provides: [{module: probeIdentity, operations: ["probeBogus"], version: "1.0.0"}],
        nativeEntries: {probeBogus: "__semantifold_provider_php_probeBogus"}}],
      [{...valid, provides: [{module: probeIdentity, operations: ["probeEffect"], version: "1.0.0.0"}],
        nativeEntries: {probeEffect: protectedEntryName("php", "probeEffect")}}],
      [{...valid, provides: [{module: probeIdentity, operations: ["probeEffect"], version: "1.0.1"}],
        nativeEntries: {probeEffect: protectedEntryName("php", "probeEffect")}}],
      [{...valid, nativeEntries: {probeEffect: "probeEffect"}}],
      [{...valid, artifact: {...valid.artifact, path: "../escape.php"}}],
      [{...valid, artifact: {...valid.artifact, path: "providers/php/probe.js"}}],
      [{...valid, dependencies: [{module: "example.missing", range: "bogus"}]}]
    ]

    for (const records of invalid) {
      assert.throws(
        () => createStdlibProviderRegistry(records),
        (error) => error instanceof SemantifoldDiagnostic &&
          ["STDLIB_PROVIDER_INVALID", "STDLIB_OPERATION_UNDECLARED", "STDLIB_VERSION_MALFORMED"].includes(error.code),
        `records ${JSON.stringify(records)?.slice(0, 80)}`
      )
    }
  })

  it("accepts a provider record whose target declares the provider role", () => {
    const registry = createStdlibProviderRegistry([providerRecord("ruby")])
    const provider = registry.providersFor("ruby", probeIdentity, "1.0.0")

    expect(provider).toHaveLength(1)
    expect(provider[0].target).toEqual("ruby")
  })

  it("keeps registry contents detached from caller-owned record objects", () => {
    const candidate = providerRecord("php")
    const registry = createStdlibProviderRegistry([candidate])

    candidate.identity = "forged"
    candidate.provides[0].module = "forged"
    expect(registry.providersFor("php", probeIdentity, "1.0.0")).toHaveLength(1)
    expect(registry.providersFor("php", "forged", "1.0.0")).toEqual([])
  })
})

function providerRecord(target) {
  return {
    artifact: {
      mediaType: target == "php" ? "application/x-httpd-php" : target == "ruby" ? "text/x-ruby" :
        target == "javascript" ? "text/javascript" : target == "typescript" ? "text/typescript" : "text/x-java-source",
      path: `providers/${target}/semantifold/task034/resource-probe.${target == "php" ? "php" :
        target == "ruby" ? "rb" : target == "javascript" ? "js" : target == "typescript" ? "ts" : "java"}`
    },
    dependencies: [],
    identity: `semantifold.provider.${target}.${probeIdentity}`,
    nativeEntries: Object.fromEntries(["probeEffect"].map((operation) => [operation, protectedEntryName(target, operation)])),
    provides: [{module: probeIdentity, operations: ["probeEffect"], version: "1.0.0"}],
    target
  }
}
