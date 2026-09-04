// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {
  generate,
  languageCapabilities,
  parse,
  SemantifoldDiagnostic,
  supportedLanguages
} from "../index.js"
import {createLanguageRegistry} from "../src/language-registry.js"

const originalFive = ["php", "ruby", "javascript", "typescript", "java"]

describe("language role registry", () => {
  it("derives stable immutable public discovery from the dispatch registry", () => {
    expect(supportedLanguages).toEqual(originalFive)
    expect(languageCapabilities.map(({id}) => id)).toEqual(originalFive)
    expect(Object.isFrozen(languageCapabilities)).toBeTrue()

    for (const descriptor of languageCapabilities) {
      expect(Object.isFrozen(descriptor)).toBeTrue()
      expect(Object.isFrozen(descriptor.roles)).toBeTrue()
      expect(Object.isFrozen(descriptor.mapping)).toBeTrue()
      expect(Object.isFrozen(descriptor.acceptance)).toBeTrue()
      expect(descriptor.roles).toEqual({
        applicationBackend: false,
        binaryBackend: false,
        frontend: true,
        interoperability: false,
        textBackend: true
      })
      expect(descriptor.artifactMultiplicity).toEqual("single")
      expect(descriptor.roundTrip).toBeTrue()
      expect(descriptor.mapping).toEqual({binaryRanges: false, richText: true, sourceMapV3: true})
      assert.ok(descriptor.acceptance.stages.includes("parse"))
      assert.ok(descriptor.acceptance.stages.includes("generate"))
      assert.ok(descriptor.acceptance.stages.includes("execute"))
    }

    assert.throws(() => {
      // @ts-expect-error Deliberately prove the public descriptors are immutable.
      languageCapabilities[0].roles.frontend = false
    }, TypeError)
  })

  it("routes the original five through the same registered frontend and text-backend records", () => {
    const source = `function choose(flag: boolean, fallback: string): string {
  if (flag) return "yes"
  else return fallback
}
console.log(choose(true, "no"))
`
    const module = parse({filename: "program.ts", language: "typescript", source})

    for (const language of originalFive) {
      const generated = generate({language, module})

      expect(typeof generated).toEqual("string")
      expect(parse({filename: language == "java" ? "Main.java" : `program.${language}`, language, source: generated}).kind).toEqual("Module")
    }
  })

  it("rejects malformed and duplicate records with normalized registry diagnostics", () => {
    const frontend = () => ({kind: "Module"})
    const record = {
      acceptance: {stages: ["parse"], toolchains: []},
      artifactMultiplicity: "single",
      defaultFilename: "program.demo",
      frontend,
      id: "demo",
      mapping: {binaryRanges: false, richText: false, sourceMapV3: false},
      mediaType: "text/x-demo",
      roundTrip: false
    }

    for (const records of [
      [record, record],
      [{...record, id: ""}],
      [{...record, artifactMultiplicity: "many"}],
      [{...record, surprise: true}],
      [{...record, acceptance: {stages: ["execute", "parse"], toolchains: []}}],
      [{...record, acceptance: {stages: ["parse", "parse"], toolchains: []}}],
      [{...record, mapping: {binaryRanges: false, richText: true, sourceMapV3: false}}],
      [{...record, mapping: {binaryRanges: false, richText: false, sourceMapV3: true}}],
      [{...record, roundTrip: true}],
      [{...record, acceptance: {stages: ["parse", "generate"], toolchains: []}}],
      [{...record, frontend: null}],
      [{...record, frontend: null, defaultFilename: null}],
      [{...record, frontend: null, mediaType: null}]
    ]) {
      assert.throws(
        () => createLanguageRegistry(records),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_REGISTRY"
      )
    }
  })

  it("rejects sparse registry acceptance-stage and toolchain arrays", () => {
    const frontend = () => ({kind: "Module"})
    const sparseStages = ["parse"]
    const sparseToolchains = ["demo"]

    Reflect.deleteProperty(sparseStages, "0")
    Reflect.deleteProperty(sparseToolchains, "0")
    const acceptanceDeclarations = [
      {stages: sparseStages, toolchains: []},
      {stages: [], toolchains: sparseToolchains}
    ]
    /** @type {number[]} */
    const accepted = []

    for (const [index, acceptance] of acceptanceDeclarations.entries()) {
      try {
        createLanguageRegistry([{
          acceptance,
          artifactMultiplicity: "single",
          frontend,
          id: `sparse-${index}`,
          mapping: {binaryRanges: false, richText: false, sourceMapV3: false},
          roundTrip: false
        }])
        accepted.push(index)
      } catch (error) {
        assert.ok(error instanceof SemantifoldDiagnostic)
        expect(error.code).toEqual("INVALID_REGISTRY")
      }
    }

    expect(accepted).toEqual([])
  })

  it("validates registry acceptance arrays without dispatching to caller-owned every methods", () => {
    const frontend = () => ({kind: "Module"})
    const invalidStages = ["bogus"]
    const invalidToolchains = [7]
    const calls = {stages: false, toolchains: false}
    const base = {
      artifactMultiplicity: "single",
      frontend,
      mapping: {binaryRanges: false, richText: false, sourceMapV3: false},
      roundTrip: false
    }

    Object.defineProperty(invalidStages, "every", {
      value() {
        calls.stages = true
        return true
      }
    })
    Object.defineProperty(invalidToolchains, "every", {
      value() {
        calls.toolchains = true
        return true
      }
    })

    for (const record of [
      {...base, acceptance: {stages: invalidStages, toolchains: []}, id: "invalid-stages"},
      {...base, acceptance: {stages: [], toolchains: invalidToolchains}, id: "invalid-toolchains"}
    ]) {
      assert.throws(
        () => createLanguageRegistry([record]),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_REGISTRY"
      )
    }

    expect(calls).toEqual({stages: false, toolchains: false})
  })

  it("treats only undefined optional registry fields as omitted", () => {
    const record = {
      acceptance: {stages: [], toolchains: []},
      artifactMultiplicity: "single",
      id: "optional",
      mapping: {binaryRanges: false, richText: false, sourceMapV3: false},
      roundTrip: false
    }

    for (const property of [
      "frontend", "textBackend", "binaryBackend", "applicationBackend", "interoperability", "defaultFilename", "mediaType"
    ]) {
      assert.throws(
        () => createLanguageRegistry([{...record, [property]: null}]),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_REGISTRY"
      )
    }
  })

  it("distinguishes an unknown language from a known language missing a requested role", () => {
    const registry = createLanguageRegistry([{
      acceptance: {stages: [], toolchains: []},
      artifactMultiplicity: "single",
      defaultFilename: "program.known",
      id: "known",
      mapping: {binaryRanges: false, richText: false, sourceMapV3: false},
      mediaType: "text/x-known",
      roundTrip: false,
      textBackend: () => "ok\n"
    }])

    assert.throws(
      () => registry.resolve("missing", "frontend"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_LANGUAGE" && error.language == "missing"
    )
    assert.throws(
      () => registry.resolve("known", "frontend"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_ROLE" && error.language == "known"
    )
    expect(registry.resolve("known", "textBackend")()).toEqual("ok\n")
  })

  it("preserves the original frontend and text-backend unknown-language diagnostics", () => {
    assert.throws(
      // @ts-expect-error Deliberately unknown runtime language ID.
      () => parse({filename: "unknown.txt", language: "unknown", source: ""}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_LANGUAGE" &&
        error.detail == "No frontend adapter is registered for this language."
    )
    assert.throws(
      // @ts-expect-error Deliberately unknown runtime language ID and irrelevant malformed module.
      () => generate({language: "unknown", module: {}}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_LANGUAGE" &&
        error.detail == "No source backend is registered for this language."
    )
  })
})
