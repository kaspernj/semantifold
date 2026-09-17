// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifact, generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"
import {isZigIdentifier} from "../src/backends/identifiers.js"

const moduleFrom = source => parse({language: "typescript", filename: "source.ts", source})
const meaning = value => JSON.parse(JSON.stringify(value, (key, nested) =>
  ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : nested))
const failure = error => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "zig"
const sourceFailure = error => error instanceof SemantifoldDiagnostic && error.language == "zig" &&
  ["UNSUPPORTED_SYNTAX", "PARSE_ERROR"].includes(error.code) && error.location?.filename == "src/main.zig"

describe("Zig transactional native project backend", () => {
  it("protects every Zig 0.15.2 primitive spelling during preflight", () => {
    for (const name of [
      "anyerror", "anyframe", "anyopaque", "bool", "c_char", "c_int", "c_long", "c_longdouble", "c_longlong",
      "c_short", "c_uint", "c_ulong", "c_ulonglong", "c_ushort", "comptime_float", "comptime_int", "f16", "f32",
      "f64", "f80", "f128", "false", "isize", "noreturn", "null", "true", "type", "undefined", "usize", "void",
      "i0", "i1", "i64", "i99999999999999", "u0", "u8", "u99999999999999"
    ]) expect(isZigIdentifier(name)).toEqual(false)
  })

  it("returns deterministic build configuration before one rich mapped entry", () => {
    const module = moduleFrom("function sum(left: number, right: number): number { return left + right; } console.log(sum(4, 9));")
    const before = structuredClone(module)
    const set = generateArtifactSet({language: "zig", module})

    expect(set.artifacts.map(({path, role}) => ({path, role}))).toEqual([
      {path: "build.zig", role: "manifest"}, {path: "src/main.zig", role: "entry"}
    ])
    expect(set.artifacts[0].content).toContain("standardOptimizeOption")
    expect(set.artifacts[0].content).not.toContain("dependency")
    expect(set.artifacts[0].provenance.kind).toEqual("synthetic")
    expect(set.artifacts[1].provenance.kind).toEqual("text")
    expect(set.artifacts[1].provenance.sourceMap.version).toEqual(3)
    expect(generateArtifactSet({language: "zig", module})).toEqual(set)
    expect(module).toEqual(before)
    expect(meaning(parse({language: "zig", filename: "src/main.zig", source: set.artifacts[1].content}))).toEqual(meaning(module))
    for (const api of [generate, generateArtifact]) assert.throws(() => api({language: "zig", module}),
      error => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_ROLE" && error.language == "zig")
  })

  it("supports Task-005 arbitrary required arity and void calls", () => {
    const module = moduleFrom(`function zero(): number { return 0; }
function sum3(first: number, second: number, third: number): number { return first + second + third; }
function announce(value: string): void { console.log(value); }
function noop(): void { return; }
announce("ready"); noop(); console.log(sum3(zero(), 2, 3));`)
    const entry = generateArtifactSet({language: "zig", module}).artifacts[1]

    expect(meaning(parse({language: "zig", filename: entry.path, source: entry.content}))).toEqual(meaning(module))
  })

  it("emits complete typed ordered regions and rejects malformed or partial scaffold variants", () => {
    const module = moduleFrom(`function mark(label: string, value: number): number { console.log(label); return value; }
function flag(label: string, value: boolean): boolean { console.log(label); return value; }
function combine(first: number, second: number, third: number): number { return first + second * third; }
console.log(combine(mark("first", 1), mark("second", 2), mark("third", 3)));
console.log(mark("left", 4) + mark("right", 5));
console.log(flag("and-left", false) && flag("and-right", true));`)
    const source = String(generateArtifactSet({language: "zig", module}).artifacts[1].content)
    const first = source.match(/^(\s*)const (semantifold_ordered_[0-9]{6}): i64 = mark\("first", 1\);$/mu)
    const second = source.match(/^(\s*)const (semantifold_ordered_[0-9]{6}): i64 = mark\("second", 2\);$/mu)
    const shortCircuitLeft = source.match(/^(\s*)const (semantifold_ordered_[0-9]{6}): bool = flag\("and-left", false\);$/mu)
    const shortCircuit = shortCircuitLeft && source.match(new RegExp(
      `^\\s*var (semantifold_ordered_[0-9]{6}): bool = ${shortCircuitLeft[2]};$`, "mu"))

    assert.match(source, /^\/\/ semantifold:program:zig:v1$/mu)
    assert.match(source, /^\s*\/\/ semantifold:ordered-expression:zig:v1 begin [0-9]{6} [0-9a-f]{64}$/mu)
    assert.ok(first && second && shortCircuitLeft && shortCircuit)
    assert.ok(source.indexOf(first[0]) < source.indexOf(second[0]))
    assert.match(source, new RegExp(`combine\\(${first[2]}, ${second[2]}, semantifold_ordered_[0-9]{6}\\)`))
    assert.match(source, new RegExp(`if \\(${shortCircuit[1]}\\) \\{`))
    assert.doesNotMatch(source, /combine\(mark\(/u)
    assert.doesNotMatch(source, /semantifold_integer_add\(mark\(/u)
    expect(meaning(parse({language: "zig", filename: "src/main.zig", source}))).toEqual(meaning(module))

    const begin = source.match(/^\s*\/\/ semantifold:ordered-expression:zig:v1 begin [^\n]+\n/mu)?.[0]
    const inverted = `if (!${shortCircuit[1]}) {`
    const reordered = first && second ? source.replace(first[0], "__FIRST__").replace(second[0], first[0]).replace("__FIRST__", second[0]) : source
    const mutations = [
      begin ? source.replace(begin, "") : source,
      first ? source.replace(first[0], first[0].replace(": i64", ": bool")) : source,
      source.replace(`if (${shortCircuit[1]}) {`, inverted),
      reordered
    ]

    for (const mutation of mutations) {
      assert.notEqual(mutation, source)
      assert.throws(() => parse({language: "zig", filename: "src/main.zig", source: mutation}), sourceFailure)
    }
  })

  it("accepts exact known i64 extrema and rejects literal-only overflow before emission", () => {
    const maximum = "9007199254740991 * 1024 + 1023"
    const minimum = `-(${maximum}) - 1`
    const moduleWith = expression => moduleFrom(`function value(): number { return ${expression}; } console.log(value());`)

    for (const expression of [maximum, minimum]) {
      expect(generateArtifactSet({language: "zig", module: moduleWith(expression)}).artifacts[1].content)
        .toContain("semantifold_print_integer")
    }
    for (const expression of ["9007199254740991 * 2048", `-(${maximum}) - 2`]) {
      assert.throws(() => generateArtifactSet({language: "zig", module: moduleWith(expression)}), failure)
    }
  })

  it("rejects malformed graphs, unsafe scalar values, protected names and options before returning artifacts", () => {
    for (const change of [
      module => { module.location = undefined },
      module => { module.functions[0].body.statements[0].expression.left = null },
      module => { module.functions[0].body.statements[0].expression.operation = "Divide" },
      module => { module.functions[0].parameters[0].type.name = "reference" },
      ...["std", "i64", "bool", "u8", "void", "noreturn", "main", "fn", "comptime", "anytype", "undefined", "unreachable", "semantifold_integer_add", "_", "bad-name"].map(name => module => { module.functions[0].name = name }),
      ...[-0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "1"].map(value => module => { module.entryPoint.body.statements[0].expression.arguments[0].value = value })
    ]) {
      const module = moduleFrom("function sum(left: number, right: number): number { return left + right; } console.log(sum(4, 9));")

      change(module)
      assert.throws(() => generateArtifactSet({language: "zig", module}), failure)
    }
    for (const options of [{filename: "main.zig"}, {filename: "../src/main.zig"}, {filename: "build.zig"},
      {mapDirective: "none"}, {mapDirective: "inline"}, {sourceMapFilename: "other.map"}]) {
      assert.throws(() => generateArtifactSet({language: "zig", module: moduleFrom("function keep(value: number): number { return value; } console.log(keep(1));"), ...options}), failure)
    }
  })
})
