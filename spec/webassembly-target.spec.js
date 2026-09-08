// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {decodedMappings, TraceMap} from "@jridgewell/trace-mapping"
import {
  canonicalToolchains,
  generateArtifactSet,
  languageCapabilities,
  parse,
  SemantifoldDiagnostic,
  supportedLanguages
} from "../index.js"

describe("browser-oriented WebAssembly target", () => {
  it("discovers Wasm only as a multi-artifact binary browser target", () => {
    const descriptor = languageCapabilities.find(({id}) => id == "wasm")

    expect(supportedLanguages.includes(/** @type {never} */ ("wasm"))).toBeFalse()
    assert.ok(descriptor)
    expect(descriptor.roles).toEqual({
      applicationBackend: true,
      binaryBackend: true,
      frontend: false,
      interoperability: false,
      textBackend: false
    })
    expect(descriptor.artifactMultiplicity).toEqual("multiple")
    expect(descriptor.mapping).toEqual({binaryRanges: true, richText: true, sourceMapV3: true})
    expect(descriptor.roundTrip).toBeFalse()
    expect(descriptor.acceptance).toEqual({
      stages: ["generate", "validate", "instantiate", "execute"],
      toolchains: ["wasm-validate", "node", "chromium"]
    })
    expect(canonicalToolchains["wasm-validate"]).toMatchObject({
      canonicalCommand: "wasm-validate",
      overrideEnvironmentVariable: "SEMANTIFOLD_WASM_VALIDATE"
    })
    expect(canonicalToolchains.chromium).toMatchObject({
      canonicalCommand: "chromium",
      overrideEnvironmentVariable: "SEMANTIFOLD_CHROMIUM"
    })
  })

  it("distinguishes the known target without a frontend from an unknown near-miss", () => {
    assert.throws(
      // @ts-expect-error Wasm is deliberately target-only.
      () => parse({filename: "program.wasm", language: "wasm", source: ""}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_ROLE" &&
        error.language == "wasm" && error.detail.includes("'frontend'")
    )
    assert.throws(
      // @ts-expect-error Deliberately unknown target ID.
      () => parse({filename: "program.wasn", language: "wasn", source: ""}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_LANGUAGE" && error.language == "wasn"
    )
    const module = parse({filename: "options.js", language: "javascript", source: `/**
 * @param {number} left
 * @param {number} right
 * @returns {number}
 */
function add(left, right) { return left + right }
console.log(add(1, 2))
`})

    for (const options of [
      {filename: "alternate.wasm"},
      {mapDirective: "none"},
      {sourceMapFilename: "alternate.wasm.map"}
    ]) {
      expectUnsupported(() => generateArtifactSet({language: "wasm", module, role: "binary", ...options}), "options.js")
    }
  })

  it("emits deterministic browser artifacts and executes the scalar ABI with Node WebAssembly", async () => {
    const source = `function difference(left: number, right: number): number {
  if (left > right) return left - right
  else return right - left
}
function join(left: string, right: string): string {
  let joined: string = left + right
  return joined + "\\u0000é"
}
console.log(difference(4, 9))
console.log(join("A", "🙂"))
console.log(true)
`
    const module = parse({filename: "program.ts", language: "typescript", source})
    const generated = generateArtifactSet({language: "wasm", module, role: "binary"})
    const repeated = generateArtifactSet({language: "wasm", module, role: "application"})

    expect(generated.artifacts.map(({path}) => path)).toEqual([
      "program.wasm", "program.wasm.map", "semantifold-loader.mjs", "index.html"
    ])
    assert.deepEqual(generated, repeated)
    expect(generated.entry).toEqual("index.html")
    expect(generated.metadata).toEqual({
      abi: "semantifold.browser.v1",
      exports: ["memory", "run"],
      imports: [
        {module: "semantifold", name: "print_i64", parameters: ["i64"], results: []},
        {module: "semantifold", name: "print_bool", parameters: ["i32"], results: []},
        {module: "semantifold", name: "print_string", parameters: ["i32", "i32"], results: []}
      ],
      maximumCallDepth: 64,
      memory: {
        initialPages: generated.metadata.memory.initialPages,
        literalBoundary: generated.metadata.memory.literalBoundary,
        maximumPages: generated.metadata.memory.maximumPages,
        scratchBase: generated.metadata.memory.scratchBase,
        scratchCapacity: 1_048_576
      },
      schema: "SemantifoldBrowserWasmABI",
      version: 1
    })
    expect(generated.metadata.memory.initialPages).toEqual(generated.metadata.memory.maximumPages)
    expect(generated.metadata.memory.scratchBase % 16).toEqual(0)
    assert.equal(generated.artifacts[2].provenance.kind, "text")
    assert.equal(generated.artifacts[3].provenance.kind, "text")
    expect(generated.artifacts[2].provenance.mapping.generated.language).toEqual("javascript")
    expect(generated.artifacts[3].provenance.mapping.generated.language).toEqual("html")
    const html = /** @type {string} */ (generated.artifacts[3].content)

    assert.match(html, /Content-Security-Policy/u)
    assert.match(html, /script-src 'self' 'wasm-unsafe-eval'/u)
    assert.doesNotMatch(html, /script-src[^;]*'unsafe-eval'/u)
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/u)

    const wasm = generated.artifacts[0]

    expect(wasm.contentKind).toEqual("binary")
    expect(wasm.mediaType).toEqual("application/wasm")
    assert.ok(wasm.content instanceof Uint8Array)
    expect(WebAssembly.validate(wasm.content)).toBeTrue()

    /** @type {WebAssembly.Instance | undefined} */
    let instance
    const lines = []
    const imports = {semantifold: {
      print_bool(value) {
        assert.ok(value === 0 || value === 1)
        lines.push(value === 1 ? "true" : "false")
      },
      print_i64(value) {
        lines.push(value.toString(10))
      },
      print_string(pointer, length) {
        assert.ok(instance)
        const memory = /** @type {WebAssembly.Memory} */ (instance.exports.memory)

        lines.push(new TextDecoder("utf-8", {fatal: true}).decode(new Uint8Array(memory.buffer, pointer, length)))
      }
    }}
    const result = await WebAssembly.instantiate(wasm.content, imports)

    instance = result.instance
    expect(Object.keys(instance.exports).sort()).toEqual(["memory", "run"])
    const run = instance.exports.run

    assert.equal(typeof run, "function")
    run()
    expect(lines).toEqual(["5", "A🙂\u0000é", "true"])
  })

  it("implements every Tasks 001-004 operation with canonical scalar results", async () => {
    const source = `function add(left: number, right: number): number { return left + right }
function subtract(left: number, right: number): number { return left - right }
function multiply(left: number, right: number): number { return left * right }
function negate(value: number, unused: number): number { return -value }
function not(value: boolean, unused: boolean): boolean { return !value }
function and(left: boolean, right: boolean): boolean { return left && right }
function or(left: boolean, right: boolean): boolean { return left || right }
function integerEqual(left: number, right: number): boolean { return left === right }
function integerNotEqual(left: number, right: number): boolean { return left !== right }
function less(left: number, right: number): boolean { return left < right }
function lessEqual(left: number, right: number): boolean { return left <= right }
function greater(left: number, right: number): boolean { return left > right }
function greaterEqual(left: number, right: number): boolean { return left >= right }
function booleanEqual(left: boolean, right: boolean): boolean { return left === right }
function booleanNotEqual(left: boolean, right: boolean): boolean { return left !== right }
function concatenate(left: string, right: string): string { return left + right }
function stringEqual(left: string, right: string): boolean { return left === right }
function stringNotEqual(left: string, right: string): boolean { return left !== right }
function boundary(left: number, right: number): number { return left * right + 1023 }
function minimum(left: number, right: number): number { return -(left * right) - 1024 }
function wrapped(left: string, right: string): string { return concatenate(left, right) + "!" }
console.log(add(2, 3))
console.log(subtract(2, 3))
console.log(multiply(-3, 2))
console.log(negate(-4, 0))
console.log(not(true, false))
console.log(and(true, false))
console.log(or(false, true))
console.log(integerEqual(3, 3))
console.log(integerNotEqual(3, 4))
console.log(less(-2, 1))
console.log(lessEqual(2, 2))
console.log(greater(5, 2))
console.log(greaterEqual(5, 5))
console.log(booleanEqual(false, false))
console.log(booleanNotEqual(false, true))
console.log(concatenate("left\\u0000", "🙂right"))
console.log(stringEqual("é", "é"))
console.log(stringNotEqual("é", "e"))
console.log(boundary(9007199254740991, 1024))
console.log(minimum(9007199254740991, 1024))
console.log(wrapped("nested ", "call"))
`
    const set = generateArtifactSet({language: "wasm", module: parse({filename: "operations.ts", language: "typescript", source}), role: "binary"})
    const execution = await executeWithNode(set)

    expect(execution.lines).toEqual([
      "5", "-1", "-6", "4", "false", "false", "true", "true", "true", "true", "true", "true", "true", "true", "true",
      "left\u0000🙂right", "true", "true", "9223372036854775807", "-9223372036854775808", "nested call!"
    ])
  })

  it("executes every canonical Tasks 001-004 JavaScript fixture", async () => {
    const fixtures = [
      ["fixtures/program.js", ["5"]],
      ["fixtures/scalars/program.js", ["yes"]],
      ["fixtures/locals/program.js", ["yes"]],
      ["fixtures/operators/program.js", ["typed:operators"]],
      ["fixtures/statements/program.js", ["checking", "yes", "matched", "fallback"]]
    ]

    for (const [relativePath, expected] of fixtures) {
      assert.equal(typeof relativePath, "string")
      const source = await readFile(new URL(relativePath, import.meta.url), "utf8")
      const module = parse({filename: relativePath, language: "javascript", source})
      const set = generateArtifactSet({language: "wasm", module, role: "binary"})

      expect((await executeWithNode(set)).lines).toEqual(expected)
    }
  })

  it("projects rich byte ranges to generated line zero and references the relative external map", () => {
    const source = `function join(left: string, right: string): string { return left + right }
console.log(join("source", " map"))
`
    const module = parse({filename: "mapping.ts", language: "typescript", source})
    const set = generateArtifactSet({language: "wasm", module, role: "binary"})
    const wasm = set.artifacts[0]
    const sidecar = set.artifacts[1]

    assert.equal(wasm.provenance.kind, "bytes")
    assert.ok(wasm.content instanceof Uint8Array)
    assert.ok(typeof sidecar.content == "string")
    const ranges = wasm.provenance.mapping.ranges
    const projected = JSON.parse(sidecar.content)
    const decoded = decodedMappings(new TraceMap(projected))
    const mappedColumns = decoded.flatMap((line, lineIndex) => line.map((segment) => ({column: segment[0], lineIndex})))
    const starts = new Set(ranges.map(({generated}) => generated.start))

    expect(ranges[0].generated.start).toEqual(0)
    expect(ranges.at(-1)?.generated.end).toEqual(wasm.content.byteLength)
    expect(ranges.every((range, index) => index == 0 || range.generated.start == ranges[index - 1].generated.end)).toBeTrue()
    expect(ranges.some(({role}) => role == "module header")).toBeTrue()
    expect(ranges.some(({role}) => role == "instruction")).toBeTrue()
    expect(ranges.some(({role}) => role == "immediate")).toBeTrue()
    expect(ranges.some(({role}) => role == "immutable UTF-8 literal data")).toBeTrue()
    expect(ranges.some(({role}) => role == "custom section payload")).toBeTrue()
    expect(mappedColumns.every(({column, lineIndex}) => lineIndex == 0 && starts.has(column))).toBeTrue()
    expect(decoded[0][0].length).toBeGreaterThan(1)
    expect(ranges.some(({generated, origin}) => generated.start == decoded[0][0][0] && origin.kind != "synthetic")).toBeTrue()
    expect(decoded[0].some((segment) => segment.length == 1)).toBeTrue()
    expect(decoded[0].some((segment) => segment.length > 1)).toBeTrue()
    expect(projected.names).toContain("join")
    expect(Buffer.from(wasm.content).includes(Buffer.from("sourceMappingURL"))).toBeTrue()
    expect(Buffer.from(wasm.content).includes(Buffer.from("program.wasm.map"))).toBeTrue()

    const operationIds = module.provenance.nodes.filter(({kind}) => kind == "BinaryExpression").map(({id}) => id)
    const mappedNodeIds = new Set(ranges.flatMap(({nodeId}) => nodeId ? [nodeId] : []))

    expect(operationIds.every((id) => mappedNodeIds.has(id))).toBeTrue()
  })

  it("uses the generated loader for exact repeated runs, reentrancy rejection, and poisoned-instance refusal", async () => {
    const source = `function join(left: string, right: string): string { return left + right }
console.log(join("load", "er"))
console.log(false)
`
    const set = generateArtifactSet({language: "wasm", module: parse({filename: "loader.ts", language: "typescript", source}), role: "binary"})
    const loader = await importLoader(set)
    const wasm = /** @type {Uint8Array} */ (set.artifacts[0].content)
    const output = []
    const program = await loader.loadSemantifold("https://example.invalid/program.wasm", {
      fetch: async () => wasmResponse(wasm),
      sink: (line) => output.push(line)
    })
    const memorySize = program.memory.buffer.byteLength

    program.run()
    program.run()
    expect(output).toEqual(["loader\n", "false\n", "loader\n", "false\n"])
    expect(program.memory.buffer.byteLength).toEqual(memorySize)

    /** @type {ReturnType<typeof program.run> | undefined} */
    let reentrantResult
    let reentrantProgram
    reentrantProgram = await loader.loadSemantifold("https://example.invalid/program.wasm", {
      fetch: async () => wasmResponse(wasm),
      sink() {
        try {
          reentrantResult = reentrantProgram.run()
        } catch (error) {
          assert.ok(error instanceof loader.SemantifoldBrowserError)
          expect(error.stage).toEqual("invocation/trap")
        }
      }
    })
    reentrantProgram.run()
    expect(reentrantResult).toEqual(undefined)

    const poisoned = await loader.loadSemantifold("https://example.invalid/program.wasm", {
      fetch: async () => wasmResponse(wasm),
      sink() { throw new Error("sink refusal") }
    })

    assert.throws(() => poisoned.run(), (error) => error instanceof loader.SemantifoldBrowserError && error.stage == "invocation/trap")
    assert.throws(
      () => poisoned.run(),
      (error) => error instanceof loader.SemantifoldBrowserError && error.stage == "invocation/trap" && error.message.includes("poisoned")
    )
  })

  it("fails loader MIME, compile, and timeout stages without semantic fallback", async () => {
    const source = `function choose(flag: boolean, fallback: string): string {
  if (flag) return "yes"
  else return fallback
}
console.log(choose(true, "no"))
`
    const set = generateArtifactSet({language: "wasm", module: parse({filename: "failure.ts", language: "typescript", source}), role: "binary"})
    const loader = await importLoader(set)

    await assert.rejects(
      () => loader.loadSemantifold("https://example.invalid/program.wasm", {
        fetch: async () => new Response("not wasm", {headers: {"content-type": "text/plain"}}),
        sink() {}
      }),
      (error) => error instanceof loader.SemantifoldBrowserError && error.stage == "fetch/MIME"
    )
    await assert.rejects(
      () => loader.loadSemantifold("https://example.invalid/program.wasm", {
        fetch: async () => wasmResponse(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1])),
        sink() {}
      }),
      (error) => error instanceof loader.SemantifoldBrowserError && error.stage == "compile"
    )
    await assert.rejects(
      () => loader.loadSemantifold("https://example.invalid/program.wasm", {
        fetch: async () => await new Promise(() => {}),
        sink() {},
        timeoutMs: 10
      }),
      (error) => error instanceof loader.SemantifoldBrowserError && error.stage == "timeout" && error.cause instanceof Error
    )
    await assert.rejects(
      () => loader.loadSemantifold("https://example.invalid/program.wasm", {
        fetch: async () => wasmResponse(/** @type {Uint8Array} */ (set.artifacts[0].content)),
        sink() {},
        timeoutMs: 2_147_483_648
      }),
      TypeError
    )
  })

  it("rejects malformed import signatures and traps on non-canonical Boolean, bounds, or UTF-8 values", async () => {
    const source = `function identity(left: string, right: string): string { return left }
console.log(true)
console.log("ok")
`
    const module = parse({filename: "malformed-abi.ts", language: "typescript", source})
    const set = generateArtifactSet({language: "wasm", module, role: "binary"})
    const loader = await importLoader(set)
    const wasm = set.artifacts[0]

    assert.equal(wasm.provenance.kind, "bytes")
    assert.ok(wasm.content instanceof Uint8Array)
    const signatureBytes = new Uint8Array(wasm.content)
    const i64Type = wasm.provenance.mapping.ranges.find(({generated, role}) => role == "value type" && signatureBytes[generated.start] == 0x7e)

    assert.ok(i64Type)
    signatureBytes[i64Type.generated.start] = 0x7f
    await assert.rejects(
      () => loader.loadSemantifold("https://example.invalid/program.wasm", {
        fetch: async () => wasmResponse(signatureBytes),
        sink() {}
      }),
      (error) => error instanceof loader.SemantifoldBrowserError && error.stage == "instantiate/import" && error.message.includes("signature")
    )

    const booleanNode = module.provenance.nodes.find(({kind}) => kind == "BooleanLiteral")
    const stringNode = module.provenance.nodes.find(({kind, path}) => kind == "StringLiteral" && path.startsWith("/entryPoint"))

    assert.ok(booleanNode)
    assert.ok(stringNode)
    const malformedCases = [
      {
        expected: /canonical/u,
        expectedStage: "invocation/trap",
        range: wasm.provenance.mapping.ranges.find(({nodeId, role}) => nodeId == booleanNode.id && role == "i32 immediate"),
        value: 2
      },
      {
        expected: /pointer/u,
        expectedStage: "memory bounds/UTF-8",
        range: wasm.provenance.mapping.ranges.find(({nodeId, role}) => nodeId == stringNode.id && role == "string pointer immediate"),
        value: 0x7f
      },
      {
        expected: /utf-?8/iu,
        expectedStage: "memory bounds/UTF-8",
        range: wasm.provenance.mapping.ranges.find(({role}) => role == "immutable UTF-8 literal data"),
        value: 0xff
      }
    ]

    for (const malformed of malformedCases) {
      assert.ok(malformed.range)
      const bytes = new Uint8Array(wasm.content)

      bytes[malformed.range.generated.start] = malformed.value
      const program = await loader.loadSemantifold("https://example.invalid/program.wasm", {
        fetch: async () => wasmResponse(bytes),
        sink() {}
      })

      assert.throws(
        () => program.run(),
        (error) => error instanceof loader.SemantifoldBrowserError && error.stage == malformed.expectedStage &&
          error.cause instanceof Error && malformed.expected.test(`${error.message} ${error.cause.message}`),
        String(malformed.expected)
      )
    }
  })

  it("accepts exact scratch and call-depth limits but rejects i64 overflow, the next byte, or the next active call", async () => {
    const overflow = `function multiply(left: number, right: number): number { return left * right }
console.log(multiply(9007199254740991, 9007199254740991))
`
    const recursion = (depth) => `function descend(depth: number, value: string): string {
  if (depth <= 0) return value
  else return descend(depth - 1, value)
}
console.log(descend(${depth}, "safe"))
`

    expectUnsupported(() => generateArtifactSet({
      language: "wasm",
      module: parse({filename: "overflow.ts", language: "typescript", source: overflow}),
      role: "binary"
    }), "overflow.ts")

    const atLimit = generateArtifactSet({
      language: "wasm",
      module: parse({filename: "depth-63.ts", language: "typescript", source: recursion(63)}),
      role: "binary"
    })

    expect(WebAssembly.validate(/** @type {Uint8Array} */ (atLimit.artifacts[0].content))).toBeTrue()
    expect((await executeWithNode(atLimit)).lines).toEqual(["safe"])
    expectUnsupported(() => generateArtifactSet({
      language: "wasm",
      module: parse({filename: "depth-64.ts", language: "typescript", source: recursion(64)}),
      role: "binary"
    }), "depth-64.ts")

    const allocationSource = `function join(left: string, right: string): string { return left + right }
console.log(join("left", "right"))
`
    const allocationModule = parse({filename: "allocation.ts", language: "typescript", source: allocationSource})
    const print = allocationModule.entryPoint.body.statements[0]

    assert.equal(print.kind, "PrintStatement")
    const call = print.expression

    assert.equal(call.kind, "CallExpression")
    const left = call.arguments[0]
    const right = call.arguments[1]

    assert.equal(left.kind, "StringLiteral")
    assert.equal(right.kind, "StringLiteral")
    left.value = "a".repeat(scratchCapacityForSpec / 2)
    right.value = "b".repeat(scratchCapacityForSpec / 2)
    const exact = generateArtifactSet({language: "wasm", module: allocationModule, role: "binary"})

    expect(WebAssembly.validate(/** @type {Uint8Array} */ (exact.artifacts[0].content))).toBeTrue()
    expect((await executeWithNode(exact)).lines[0].length).toEqual(scratchCapacityForSpec)
    right.value += "b"
    expectUnsupported(() => generateArtifactSet({language: "wasm", module: allocationModule, role: "binary"}), "allocation.ts")
  })

  it("maps semantic bytes to parser-owned tokens while keeping binary name framing synthetic", () => {
    const source = `function add(left: number, right: number): number {
  let result: number = left + right
  return result
}
console.log(add(1, 2))
console.log("literal")
`
    const module = parse({filename: "exact-bytes.ts", language: "typescript", source})
    const set = generateArtifactSet({language: "wasm", module, role: "binary"})
    const wasm = set.artifacts[0]

    assert.equal(wasm.provenance.kind, "bytes")
    assert.ok(wasm.content instanceof Uint8Array)
    const ranges = wasm.provenance.mapping.ranges
    const exactRecords = [
      module.provenance.nodes.find(({kind}) => kind == "BinaryExpression"),
      module.provenance.nodes.find(({kind, path}) => kind == "CallExpression" && path.startsWith("/entryPoint")),
      module.provenance.nodes.find(({kind}) => kind == "LocalDeclaration")
    ]
    const parserRoles = ["operator", "callee", "name"]

    for (let index = 0; index < exactRecords.length; index += 1) {
      const record = exactRecords[index]
      const role = parserRoles[index]

      assert.ok(record)
      const location = record.ranges[role]

      assert.ok(location)
      const mapped = ranges.filter(({nodeId}) => nodeId == record.id)

      expect(mapped.length).toBeGreaterThan(0)
      for (const range of mapped) expect(range.origin).toEqual({kind: "source", location, sourceId: "source:0"})
    }

    const declaration = module.provenance.nodes.find(({kind}) => kind == "FunctionDeclaration")

    assert.ok(declaration)
    assert.ok(declaration.ranges.name)
    const declarationRanges = ranges.filter(({nodeId}) => nodeId == declaration.id)
    const encodedName = declarationRanges.find(({role}) => role == "semantic function name")

    expect(declarationRanges.length).toEqual(1)
    assert.ok(encodedName)
    expect(encodedName.origin).toEqual({kind: "source", location: declaration.ranges.name, sourceId: "source:0"})
    assert.deepEqual(wasm.content.slice(encodedName.generated.start, encodedName.generated.end), new TextEncoder().encode("add"))
    const lengthPrefix = ranges.find(({generated}) => generated.end == encodedName.generated.start)

    assert.ok(lengthPrefix)
    expect(lengthPrefix.origin.kind).toEqual("synthetic")
    expect(wasm.content[lengthPrefix.generated.start]).toEqual(3)

    const string = module.provenance.nodes.find(({kind}) => kind == "StringLiteral")
    const data = ranges.find(({role}) => role == "immutable UTF-8 literal data")

    assert.ok(string)
    assert.ok(string.ranges.literal)
    assert.ok(data)
    expect(data.origin).toEqual({kind: "source", location: string.ranges.literal, sourceId: "source:0"})
  })

  it("rejects cyclic and excessively deep caller IR before recursive backend validation", () => {
    const source = `function add(left: number, right: number): number { return left + right }
console.log(add(1, 2))
`
    const cyclic = parse({filename: "cyclic.ts", language: "typescript", source})
    const cyclicReturn = cyclic.functions[0].body.statements[0]

    assert.equal(cyclicReturn.kind, "ReturnStatement")
    assert.equal(cyclicReturn.expression.kind, "BinaryExpression")
    cyclicReturn.expression.left = cyclicReturn.expression
    expectUnsupported(() => generateArtifactSet({language: "wasm", module: cyclic, role: "binary"}), "cyclic.ts")

    const deep = parse({filename: "deep.ts", language: "typescript", source})
    const deepReturn = deep.functions[0].body.statements[0]

    assert.equal(deepReturn.kind, "ReturnStatement")
    let expression = deepReturn.expression

    for (let depth = 0; depth < 513; depth += 1) {
      expression = /** @type {any} */ ({kind: "UnaryExpression", location: deepReturn.location, operand: expression,
        operation: "IntegerNegate", type: "integer"})
    }
    deepReturn.expression = expression
    expectUnsupported(() => generateArtifactSet({language: "wasm", module: deep, role: "binary"}), "deep.ts")
  })

  it("rejects known i64 overflow in unused functions and statically unreachable branches", () => {
    const programs = [
      `function unused(left: number, right: number): number { return 9007199254740991 * 2048 }
function safe(left: number, right: number): number { return left + right }
console.log(safe(1, 2))
`,
      `function unreachable(left: number, right: number): number {
  if (false) return 9007199254740991 * 2048
  else return left
}
function safe(left: number, right: number): number { return left + right }
console.log(safe(1, 2))
`
    ]

    for (let index = 0; index < programs.length; index += 1) {
      const filename = `module-overflow-${index}.ts`
      const module = parse({filename, language: "typescript", source: programs[index]})

      expectUnsupported(() => generateArtifactSet({language: "wasm", module, role: "binary"}), filename)
    }
  })

  it("starts native instantiateStreaming before parallel ABI inspection without exposing unapproved host imports", async () => {
    const module = parse({filename: "streaming.ts", language: "typescript", source: `function add(left: number, right: number): number { return left + right }
console.log(add(1, 2))
`})
    const set = generateArtifactSet({language: "wasm", module, role: "binary"})
    const loader = await importLoader(set, {mode: "observed-streaming"})
    const response = wasmResponse(/** @type {Uint8Array} */ (set.artifacts[0].content))
    const clone = response.clone.bind(response)
    let streamingStarted = false

    Object.defineProperty(response, "semantifoldStreamingStarted", {value() { streamingStarted = true }})
    Object.defineProperty(response, "clone", {value() {
      const copy = clone()
      const arrayBuffer = copy.arrayBuffer.bind(copy)

      Object.defineProperty(copy, "arrayBuffer", {value() {
        return streamingStarted ? arrayBuffer() : Promise.reject(new Error("ABI inspection blocked streaming startup."))
      }})

      return copy
    }})
    const output = []
    const program = await loader.loadSemantifold("https://example.invalid/program.wasm", {
      fetch: async () => response,
      sink: (line) => output.push(line)
    })

    program.run()
    expect(streamingStarted).toBeTrue()
    expect(output).toEqual(["3\n"])

    assert.equal(set.artifacts[0].provenance.kind, "bytes")
    const codeSection = set.artifacts[0].provenance.mapping.ranges.find(({role}) => role == "code section")

    assert.ok(codeSection)
    const original = /** @type {Uint8Array} */ (set.artifacts[0].content)
    const withStart = new Uint8Array(original.byteLength + 3)

    withStart.set(original.subarray(0, codeSection.generated.start))
    withStart.set([0x08, 0x01, 10], codeSection.generated.start)
    withStart.set(original.subarray(codeSection.generated.start), codeSection.generated.start + 3)
    expect(WebAssembly.validate(withStart)).toBeTrue()
    const unapprovedOutput = []

    await assert.rejects(
      () => loader.loadSemantifold("https://example.invalid/program.wasm", {
        fetch: async () => wasmResponse(withStart),
        sink: (line) => unapprovedOutput.push(line)
      }),
      (error) => error instanceof loader.SemantifoldBrowserError && error.stage == "instantiate/import"
    )
    expect(unapprovedOutput).toEqual([])
  })

  it("preserves a valid leading BOM in exact string output", async () => {
    const source = `function choose(left: string, right: string): string { return left }
console.log(choose("\\uFEFFleading", "unused"))
`
    const set = generateArtifactSet({language: "wasm", module: parse({filename: "bom.ts", language: "typescript", source}), role: "binary"})
    const loader = await importLoader(set)
    const output = []
    const program = await loader.loadSemantifold("https://example.invalid/program.wasm", {
      fetch: async () => wasmResponse(/** @type {Uint8Array} */ (set.artifacts[0].content)),
      sink: (line) => output.push(line)
    })

    program.run()
    expect(output).toEqual(["\uFEFFleading\n"])
  })

  it("accepts dollar-prefixed JavaScript and TypeScript identifiers", async () => {
    const source = `function $add($left: number, $right: number): number {
  let $result: number = $left + $right
  return $result
}
console.log($add(1, 2))
`
    const set = generateArtifactSet({language: "wasm", module: parse({filename: "dollar.ts", language: "typescript", source}), role: "binary"})

    expect((await executeWithNode(set)).lines).toEqual(["3"])
  })

  it("preserves timeout classification across body, streaming, and compatibility aborts", async () => {
    const source = `function add(left: number, right: number): number { return left + right }
console.log(add(1, 2))
`
    const set = generateArtifactSet({language: "wasm", module: parse({filename: "timeouts.ts", language: "typescript", source}), role: "binary"})
    const bytes = /** @type {Uint8Array} */ (set.artifacts[0].content)
    const nativeLoader = await importLoader(set)
    const streamingLoader = await importLoader(set, {mode: "controlled-streaming"})
    const compatibilityLoader = await importLoader(set, {mode: "controlled-compatibility"})
    const cases = [
      {
        loader: nativeLoader,
        response(signal) {
          const response = wasmResponse(bytes)

          Object.defineProperty(response, "clone", {value: () => ({arrayBuffer: () => abortOperation(signal)})})
          return response
        }
      },
      {
        loader: streamingLoader,
        response(signal) {
          const response = wasmResponse(bytes)

          Object.defineProperty(response, "semantifoldAbortOperation", {value: abortOperation(signal)})
          return response
        }
      },
      {
        loader: compatibilityLoader,
        response(signal) {
          Object.defineProperty(globalThis, "__semantifoldCompatibilityAbortOperation", {
            configurable: true,
            value: abortOperation(signal)
          })
          return wasmResponse(bytes)
        }
      }
    ]

    const errors = []

    for (const testCase of cases) {
      try {
        await testCase.loader.loadSemantifold("https://example.invalid/program.wasm", {
          fetch: async (_url, {signal}) => testCase.response(signal),
          sink() {},
          timeoutMs: 10
        })
        errors.push(null)
      } catch (error) {
        errors.push(error)
      }
    }
    Reflect.deleteProperty(globalThis, "__semantifoldCompatibilityAbortOperation")

    for (let index = 0; index < errors.length; index += 1) {
      const error = errors[index]

      assert.ok(error instanceof cases[index].loader.SemantifoldBrowserError)
      expect(error.stage).toEqual("timeout")
      assert.ok(error.cause instanceof Error)
    }

    const unrelatedBody = wasmResponse(bytes)

    Object.defineProperty(unrelatedBody, "clone", {value: () => ({
      arrayBuffer: () => Promise.reject(new DOMException("Independent body abort.", "AbortError"))
    })})
    await assert.rejects(
      () => nativeLoader.loadSemantifold("https://example.invalid/program.wasm", {
        fetch: async () => unrelatedBody,
        sink() {}
      }),
      (error) => error instanceof nativeLoader.SemantifoldBrowserError && error.stage == "fetch/MIME"
    )

    const unrelatedStreaming = wasmResponse(bytes)

    Object.defineProperty(unrelatedStreaming, "semantifoldAbortOperation", {
      value: Promise.reject(new DOMException("Independent streaming abort.", "AbortError"))
    })
    await assert.rejects(
      () => streamingLoader.loadSemantifold("https://example.invalid/program.wasm", {
        fetch: async () => unrelatedStreaming,
        sink() {}
      }),
      (error) => error instanceof streamingLoader.SemantifoldBrowserError && error.stage == "instantiate/import"
    )
  })

  it("classifies valid Wasm with an f32 ABI signature as instantiate/import failure", async () => {
    const source = `function choose(left: boolean, right: boolean): boolean { return left }
console.log(false)
`
    const set = generateArtifactSet({language: "wasm", module: parse({filename: "f32-abi.ts", language: "typescript", source}), role: "binary"})
    const loader = await importLoader(set)
    const wasm = set.artifacts[0]

    assert.equal(wasm.provenance.kind, "bytes")
    assert.ok(wasm.content instanceof Uint8Array)
    const bytes = new Uint8Array(wasm.content)
    const i64Type = wasm.provenance.mapping.ranges.find(({generated, role}) => role == "value type" && bytes[generated.start] == 0x7e)

    assert.ok(i64Type)
    bytes[i64Type.generated.start] = 0x7d
    expect(WebAssembly.validate(bytes)).toBeTrue()
    await assert.rejects(
      () => loader.loadSemantifold("https://example.invalid/program.wasm", {fetch: async () => wasmResponse(bytes), sink() {}}),
      (error) => error instanceof loader.SemantifoldBrowserError && error.stage == "instantiate/import"
    )
  })
})

const scratchCapacityForSpec = 1_048_576

/**
 * Instantiates one generated set through Node's standard WebAssembly API.
 * @param {import("../src/semantic/types.js").GeneratedArtifactSet} set - Generated Wasm set.
 * @returns {Promise<{instance: WebAssembly.Instance, lines: string[]}>} Execution result.
 */
async function executeWithNode(set) {
  const wasm = set.artifacts[0].content

  assert.ok(wasm instanceof Uint8Array)
  /** @type {WebAssembly.Instance | undefined} */
  let instance
  const lines = []
  const result = await WebAssembly.instantiate(wasm, {semantifold: {
    print_bool(value) {
      assert.ok(value === 0 || value === 1)
      lines.push(value === 1 ? "true" : "false")
    },
    print_i64(value) { lines.push(value.toString(10)) },
    print_string(pointer, length) {
      assert.ok(instance)
      const memory = /** @type {WebAssembly.Memory} */ (instance.exports.memory)

      assert.ok(Number.isInteger(pointer) && pointer >= 0 && Number.isInteger(length) && length >= 0 && pointer + length <= memory.buffer.byteLength)
      lines.push(new TextDecoder("utf-8", {fatal: true}).decode(new Uint8Array(memory.buffer, pointer, length)))
    }
  }})

  instance = result.instance
  const run = instance.exports.run

  assert.equal(typeof run, "function")
  run()

  return {instance, lines}
}

/**
 * Imports the generated ESM loader without writing an artifact to disk.
 * @param {import("../src/semantic/types.js").GeneratedArtifactSet} set - Generated set.
 * @param {{mode?: "native" | "observed-streaming" | "controlled-streaming" | "controlled-compatibility"}} [options] - Loader environment options.
 * @returns {Promise<{loadSemantifold: Function, SemantifoldBrowserError: typeof Error}>} Loader exports.
 */
async function importLoader(set, {mode = "native"} = {}) {
  const source = set.artifacts.find(({path}) => path == "semantifold-loader.mjs")?.content

  assert.equal(typeof source, "string")
  const instantiate = mode == "controlled-compatibility"
    ? "() => globalThis.__semantifoldCompatibilityAbortOperation"
    : "globalThis.WebAssembly.instantiate.bind(globalThis.WebAssembly)"
  const instantiateStreaming = mode == "observed-streaming"
    ? "(response, imports) => { response.semantifoldStreamingStarted(); return globalThis.WebAssembly.instantiateStreaming(response, imports) }"
    : mode == "controlled-streaming" ? "(response) => response.semantifoldAbortOperation"
    : mode == "controlled-compatibility" ? "undefined" : "globalThis.WebAssembly.instantiateStreaming.bind(globalThis.WebAssembly)"
  const environment = mode == "native" ? "" : `const WebAssembly = {
  CompileError: globalThis.WebAssembly.CompileError,
  Memory: globalThis.WebAssembly.Memory,
  Module: globalThis.WebAssembly.Module,
  instantiate: ${instantiate},
  instantiateStreaming: ${instantiateStreaming},
  validate: globalThis.WebAssembly.validate.bind(globalThis.WebAssembly)
}
`
  const url = `data:text/javascript;base64,${Buffer.from(environment + source).toString("base64")}`

  return import(url)
}

/**
 * Constructs one successful Wasm HTTP response.
 * @param {Uint8Array} bytes - Module bytes.
 * @returns {Response} Response with the required MIME type.
 */
function wasmResponse(bytes) {
  return new Response(bytes, {headers: {"content-type": "application/wasm"}})
}

/**
 * Constructs an operation that aborts with the loader-owned fetch signal.
 * @param {AbortSignal} signal - Loader-owned fetch signal.
 * @returns {Promise<ArrayBuffer>} Pending operation.
 */
function abortOperation(signal) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Wasm operation aborted.", "AbortError")), {once: true})
  })
}

/**
 * Requires one located Wasm capability diagnostic.
 * @param {() => unknown} callback - Generation callback.
 * @param {string} filename - Expected source filename.
 * @returns {void}
 */
function expectUnsupported(callback, filename) {
  assert.throws(callback, (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
    error.language == "wasm" && error.location?.filename == filename)
}
