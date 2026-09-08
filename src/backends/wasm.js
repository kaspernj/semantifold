// @ts-check

import {addSegment, GenMapping, maybeAddSegment, setSourceContent, toEncodedMap} from "@jridgewell/gen-mapping"
import {createByteMapping} from "../binary-mapping.js"
import {unsupportedCapability} from "../diagnostic.js"
import {finalizeMapping, toSourceMapV3} from "../mapping.js"
import {createGenerationIndex, primaryLocation, semanticEntries} from "../semantic/provenance.js"
import {validateNativeGraph} from "./native-validation.js"
import {validateBackendModule} from "./shared.js"
import {SourceWriter} from "./writer.js"

/** @typedef {import("../semantic/types.js").SemanticModule} SemanticModule */
/** @typedef {import("../semantic/types.js").SemanticNode} SemanticNode */
/** @typedef {import("../semantic/types.js").Expression} Expression */
/** @typedef {import("../semantic/types.js").SemanticTypeName} Scalar */
/** @typedef {import("../semantic/types.js").GeneratedByteRange} GeneratedByteRange */
/** @typedef {import("../semantic/types.js").SemanticNodeProvenance} SemanticNodeProvenance */
/** @typedef {{type: Scalar, knownBoolean?: boolean, knownInteger?: bigint, knownString?: string, stringLength?: number}} AbstractValue */
/** @typedef {{allocated: number, env: Map<string, AbstractValue>, returned?: AbstractValue}} AnalysisState */
/** @typedef {{type: Scalar, indexes: number[]}} LocalBinding */

const encoder = new TextEncoder()
const scratchCapacity = 1_048_576
const maximumCallDepth = 64
const wasmPageSize = 65_536
const maximumAnalysisSteps = 100_000
const valueTypes = Object.freeze({i32: 0x7f, i64: 0x7e})
const helperNames = Object.freeze(["$concat", "$string_equal", "$checked_add", "$checked_subtract", "$checked_multiply", "$checked_negate"])
const helperCount = helperNames.length
const importCount = 3
const concatFunctionIndex = importCount
const stringEqualFunctionIndex = concatFunctionIndex + 1
const checkedAddFunctionIndex = stringEqualFunctionIndex + 1
const checkedSubtractFunctionIndex = checkedAddFunctionIndex + 1
const checkedMultiplyFunctionIndex = checkedSubtractFunctionIndex + 1
const checkedNegateFunctionIndex = checkedMultiplyFunctionIndex + 1
const cursorGlobalIndex = 0
const depthGlobalIndex = 1
const activeGlobalIndex = 2

/**
 * Generates the complete deterministic browser Wasm artifact set.
 * @param {{filename?: string, mapDirective?: unknown, module: SemanticModule, sourceMapFilename?: unknown, sources?: {filename: string, content: string, language?: import("../semantic/types.js").SemanticLanguage}[]}} input - Backend request.
 * @returns {{artifacts: import("../semantic/types.js").GeneratedSetArtifact[], metadata: Readonly<Record<string, unknown>>, target: string}} Candidate artifact set.
 */
export function generateBrowserWasm({filename, mapDirective, module, sourceMapFilename, sources}) {
  validateNativeGraph(module, "wasm")
  validateBackendModule(module, "wasm")
  if (filename !== undefined && filename != "program.wasm") {
    unsupportedCapability("wasm", "artifact filename other than program.wasm", module.location)
  }
  if (mapDirective !== undefined) unsupportedCapability("wasm", "source-map directive option", module.location)
  if (sourceMapFilename !== undefined) unsupportedCapability("wasm", "alternate source-map filename", module.location)
  analyzeScratchUse(module)

  const index = createGenerationIndex(module, sources)
  const literalLayout = collectLiteralLayout(module, index)
  const scratchBase = align(literalLayout.boundary, 16)
  const memoryBytes = checkedSize(scratchBase + scratchCapacity, module, "linear memory size")
  const memoryPages = Math.ceil(memoryBytes / wasmPageSize)
  const encoded = encodeModule(module, index, literalLayout, scratchBase, memoryPages)

  validateEncodedModule(encoded.bytes, module)
  const byteMapping = createByteMapping({byteLength: encoded.bytes.byteLength, path: "program.wasm", ranges: encoded.ranges})
  const wasmMap = createWasmSourceMap(byteMapping, index.provenance)
  const loader = textArtifact(semantifoldLoader, "semantifold-loader.mjs", "javascript", "loader", module, sources,
    "Versioned browser Wasm ABI loader and exact scalar bridge.")
  const html = textArtifact(browserHarness, "index.html", "html", "entry", module, sources,
    "Deterministic local browser acceptance harness.")
  const metadata = /** @type {const} */ ({
    abi: "semantifold.browser.v1",
    exports: ["memory", "run"],
    imports: [
      {module: "semantifold", name: "print_i64", parameters: ["i64"], results: []},
      {module: "semantifold", name: "print_bool", parameters: ["i32"], results: []},
      {module: "semantifold", name: "print_string", parameters: ["i32", "i32"], results: []}
    ],
    maximumCallDepth,
    memory: {
      initialPages: memoryPages,
      literalBoundary: literalLayout.boundary,
      maximumPages: memoryPages,
      scratchBase,
      scratchCapacity
    },
    schema: "SemantifoldBrowserWasmABI",
    version: 1
  })

  return {
    artifacts: [{
      content: encoded.bytes,
      contentKind: "binary",
      mediaType: "application/wasm",
      ownership: "generated",
      path: "program.wasm",
      provenance: {kind: "bytes", mapping: byteMapping},
      role: "resource"
    }, {
      content: `${JSON.stringify(wasmMap)}\n`,
      contentKind: "text",
      mediaType: "application/json",
      ownership: "generated",
      path: "program.wasm.map",
      provenance: {
        kind: "synthetic",
        reason: "Source Map v3 projection of program.wasm byte provenance.",
        relatedOrigins: relatedOrigins(index.recordFor(module, ""))
      },
      role: "mapping"
    }, loader, html],
    metadata,
    target: "wasm"
  }
}

/**
 * Independently checks the completed module before any bytes enter an artifact.
 * @param {Uint8Array} bytes - Completed module bytes.
 * @param {SemanticModule} module - Related semantic module.
 * @returns {void}
 */
function validateEncodedModule(bytes, module) {
  const moduleBytes = new Uint8Array(bytes.byteLength)

  moduleBytes.set(bytes)
  if (!WebAssembly.validate(moduleBytes)) unsupportedCapability("wasm", "invalid encoded section, index, stack, or control shape", module.location)

  /** @type {WebAssembly.Module} */
  let compiled

  try {
    compiled = new WebAssembly.Module(moduleBytes)
  } catch (_error) {
    unsupportedCapability("wasm", "invalid completed WebAssembly module", module.location)
  }
  const imports = WebAssembly.Module.imports(compiled).map(({kind, module: namespace, name}) => [namespace, name, kind])
  const exports = WebAssembly.Module.exports(compiled).map(({kind, name}) => [name, kind])

  if (JSON.stringify(imports) != JSON.stringify([
    ["semantifold", "print_i64", "function"],
    ["semantifold", "print_bool", "function"],
    ["semantifold", "print_string", "function"]
  ]) || JSON.stringify(exports) != JSON.stringify([["memory", "memory"], ["run", "function"]])) {
    unsupportedCapability("wasm", "invalid encoded ABI import or export set", module.location)
  }
}

/**
 * Encodes one validated semantic module directly to portable core WebAssembly.
 * @param {SemanticModule} module - Validated module.
 * @param {ReturnType<typeof createGenerationIndex>} index - Canonical provenance index.
 * @param {ReturnType<typeof collectLiteralLayout>} literals - Static literal layout.
 * @param {number} scratchBase - Aligned scratch arena base.
 * @param {number} memoryPages - Fixed memory page count.
 * @returns {{bytes: Uint8Array, ranges: GeneratedByteRange[]}} Encoded module and rich byte ranges.
 */
function encodeModule(module, index, literals, scratchBase, memoryPages) {
  const writer = new BinaryWriter(index)
  const root = {node: module, path: ""}

  writer.synthetic([0x00, 0x61, 0x73, 0x6d], "WebAssembly binary magic", root, "module header")
  writer.synthetic([0x01, 0x00, 0x00, 0x00], "Pinned WebAssembly core binary version 1", root, "module header")

  const types = new TypePool()
  const importTypes = [
    types.add(["i64"], []),
    types.add(["i32"], []),
    types.add(["i32", "i32"], [])
  ]
  const helperTypes = [
    types.add(["i32", "i32", "i32", "i32"], ["i32", "i32"]),
    types.add(["i32", "i32", "i32", "i32"], ["i32"]),
    types.add(["i64", "i64"], ["i64"]),
    types.add(["i64", "i64"], ["i64"]),
    types.add(["i64", "i64"], ["i64"]),
    types.add(["i64"], ["i64"])
  ]
  const semanticTypeIndexes = module.functions.map((declaration) => types.add(
    declaration.parameters.flatMap(({type}) => wasmTypes(type.name)),
    wasmTypes(declaration.returnType.name)
  ))
  const runType = types.add([], [])
  const functionIndexes = new Map(module.functions.map((declaration, offset) => [declaration.name, importCount + helperCount + offset]))
  const runFunctionIndex = importCount + helperCount + module.functions.length

  appendSection(writer, 1, "type", encodeTypeSection(types, index, root), root)
  appendSection(writer, 2, "import", encodeImportSection(importTypes, index, root), root)
  appendSection(writer, 3, "function", encodeFunctionSection(helperTypes, semanticTypeIndexes, runType, module, index), root)
  appendSection(writer, 5, "memory", encodeMemorySection(memoryPages, index, root), root)
  appendSection(writer, 6, "global", encodeGlobalSection(scratchBase, index, root), root)
  appendSection(writer, 7, "export", encodeExportSection(runFunctionIndex, index, root), root)

  const code = new BinaryWriter(index)

  code.synthetic(u32(helperCount + module.functions.length + 1), "Defined function count", root, "function count")
  appendFunctionBody(code, helperConcat(index, module, scratchBase), ["i32", "i32", "i32", "i32"], root, "$concat")
  appendFunctionBody(code, helperStringEqual(index, module), ["i32"], root, "$string_equal")
  appendFunctionBody(code, helperCheckedAdd(index, module), ["i64"], root, "$checked_add")
  appendFunctionBody(code, helperCheckedSubtract(index, module), ["i64"], root, "$checked_subtract")
  appendFunctionBody(code, helperCheckedMultiply(index, module), ["i64"], root, "$checked_multiply")
  appendFunctionBody(code, helperCheckedNegate(index, module), [], root, "$checked_negate")

  for (let functionOffset = 0; functionOffset < module.functions.length; functionOffset += 1) {
    const declaration = module.functions[functionOffset]
    const path = `/functions/${functionOffset}`
    const emitter = new FunctionEmitter({functionIndexes, index, literals: literals.byValue, module, scratchBase})

    emitter.bindParameters(declaration.parameters)
    emitter.block(declaration.body, `${path}/body`)
    emitter.syntheticUnreachable(declaration, path)
    emitter.syntheticEnd(declaration, path)
    appendFunctionBody(code, emitter.writer, emitter.locals, {node: declaration, path}, declaration.name)
  }

  const runEmitter = new FunctionEmitter({functionIndexes, index, literals: literals.byValue, module, scratchBase})

  runEmitter.run(module.entryPoint, "/entryPoint")
  appendFunctionBody(code, runEmitter.writer, runEmitter.locals, {node: module.entryPoint, path: "/entryPoint"}, "run")
  appendSection(writer, 10, "code", code, root)
  appendSection(writer, 11, "data", encodeDataSection(literals.entries, index, root), root)
  appendCustomSection(writer, "name", encodeNamePayload(module, runFunctionIndex, index), root)
  appendCustomSection(writer, "sourceMappingURL", namedPayload("program.wasm.map", index, root), root)

  return {bytes: writer.finish(), ranges: writer.ranges}
}

/** Direct semantic function and entry-point instruction emitter. */
class FunctionEmitter {
  /**
   * Creates an instruction emitter.
   * @param {object} options - Encoding context.
   * @param {Map<string, number>} options.functionIndexes - Semantic function indexes.
   * @param {ReturnType<typeof createGenerationIndex>} options.index - Provenance index.
   * @param {Map<string, {address: number, bytes: Uint8Array}>} options.literals - Literal addresses.
   * @param {SemanticModule} options.module - Complete module.
   * @param {number} options.scratchBase - Scratch base.
   */
  constructor({functionIndexes, index, literals, module, scratchBase}) {
    this.functionIndexes = functionIndexes
    this.functions = new Map(module.functions.map((declaration) => [declaration.name, declaration]))
    this.index = index
    this.literals = literals
    this.module = module
    this.scratchBase = scratchBase
    this.writer = new BinaryWriter(index)
    /** @type {("i32" | "i64")[]} */
    this.locals = []
    /** @type {Map<string, LocalBinding>} */
    this.bindings = new Map()
    this.parameterCount = 0
  }

  /**
   * Binds flattened semantic parameters to Wasm parameter indexes.
   * @param {import("../semantic/types.js").Parameter[]} parameters - Semantic parameters.
   * @returns {void}
   */
  bindParameters(parameters) {
    let index = 0

    for (const parameter of parameters) {
      const types = wasmTypes(parameter.type.name)
      const indexes = types.map(() => index++)

      this.bindings.set(parameter.name, {indexes, type: parameter.type.name})
    }
    this.parameterCount = index
  }

  /**
   * Emits the guarded exported run body.
   * @param {import("../semantic/types.js").EntryPoint} entryPoint - Semantic entry point.
   * @param {string} path - Entry-point path.
   * @returns {void}
   */
  run(entryPoint, path) {
    this.syntheticOp(0x23, entryPoint, path, "active guard read")
    this.syntheticImmediate(u32(activeGlobalIndex), entryPoint, path, "active guard global index")
    this.syntheticOp(0x04, entryPoint, path, "active guard branch")
    this.syntheticImmediate([0x40], entryPoint, path, "empty block type")
    this.syntheticOp(0x00, entryPoint, path, "reentrant invocation trap")
    this.syntheticOp(0x0b, entryPoint, path, "active guard branch end")
    this.syntheticI32(1, entryPoint, path, "mark run active")
    this.syntheticGlobalSet(activeGlobalIndex, entryPoint, path, "active guard")
    this.syntheticI32(this.scratchBase, entryPoint, path, "reset scratch cursor")
    this.syntheticGlobalSet(cursorGlobalIndex, entryPoint, path, "scratch cursor")
    this.syntheticI32(0, entryPoint, path, "reset semantic call depth")
    this.syntheticGlobalSet(depthGlobalIndex, entryPoint, path, "call depth")
    this.block(entryPoint.body, `${path}/body`)
    this.syntheticI32(0, entryPoint, path, "clear semantic call depth")
    this.syntheticGlobalSet(depthGlobalIndex, entryPoint, path, "call depth")
    this.syntheticI32(0, entryPoint, path, "mark run inactive")
    this.syntheticGlobalSet(activeGlobalIndex, entryPoint, path, "active guard")
    this.syntheticEnd(entryPoint, path)
  }

  /**
   * Emits one semantic block.
   * @param {import("../semantic/types.js").Block} block - Semantic block.
   * @param {string} path - Occurrence path.
   * @returns {void}
   */
  block(block, path) {
    for (let index = 0; index < block.statements.length; index += 1) {
      const statement = block.statements[index]
      const statementPath = `${path}/statements/${index}`

      if (statement.kind == "LocalDeclaration") {
        this.expression(statement.initializer, `${statementPath}/initializer`)
        const binding = this.allocateBinding(statement.type.name)

        this.bindings.set(statement.name, binding)
        this.setBinding(binding, statement, statementPath, "name")
      } else if (statement.kind == "AssignmentStatement") {
        this.expression(statement.expression, `${statementPath}/expression`)
        const binding = this.bindings.get(statement.target.name)

        if (!binding) throw new Error("Validated Wasm assignment omitted its binding.")
        this.setBinding(binding, statement.target, `${statementPath}/target`, "name")
      } else if (statement.kind == "PrintStatement") {
        const type = expressionType(statement.expression, this.bindings, this.functions)

        this.expression(statement.expression, `${statementPath}/expression`)
        const importIndex = type == "integer" ? 0 : type == "boolean" ? 1 : 2

        this.mappedOp(0x10, statement, statementPath, "print instruction")
        this.mappedImmediate(u32(importIndex), statement, statementPath, "print import index")
      } else if (statement.kind == "ReturnStatement") {
        this.expression(statement.expression, `${statementPath}/expression`)
        this.mappedOp(0x0f, statement, statementPath, "return instruction")
      } else {
        this.expression(statement.condition, `${statementPath}/condition`)
        this.mappedOp(0x04, statement.condition, `${statementPath}/condition`, "conditional instruction")
        this.syntheticImmediate([0x40], statement, statementPath, "empty conditional block type")
        this.block(statement.consequent, `${statementPath}/consequent`)
        if (statement.alternate) {
          this.mappedOp(0x05, statement, statementPath, "alternate instruction")
          this.block(statement.alternate, `${statementPath}/alternate`)
        }
        this.mappedOp(0x0b, statement, statementPath, "conditional end")
      }
    }
  }

  /**
   * Emits one expression and leaves its flattened result on the operand stack.
   * @param {Expression} expression - Semantic expression.
   * @param {string} path - Occurrence path.
   * @returns {void}
   */
  expression(expression, path) {
    if (expression.kind == "IdentifierExpression") {
      const binding = this.bindings.get(expression.name)

      if (!binding) throw new Error("Validated Wasm identifier omitted its binding.")
      for (const localIndex of binding.indexes) {
        this.mappedOp(0x20, expression, path, "local read", "name")
        this.mappedImmediate(u32(localIndex), expression, path, "local index", "name")
      }
      return
    }
    if (expression.kind == "IntegerLiteral") {
      this.mappedOp(0x42, expression, path, "i64 constant", "literal")
      this.mappedImmediate(s64(BigInt(expression.value)), expression, path, "i64 immediate", "literal")
      return
    }
    if (expression.kind == "BooleanLiteral") {
      this.mappedOp(0x41, expression, path, "canonical Boolean constant", "literal")
      this.mappedImmediate(s32(expression.value ? 1 : 0), expression, path, "i32 immediate", "literal")
      return
    }
    if (expression.kind == "StringLiteral") {
      const literal = this.literals.get(expression.value)

      if (!literal) throw new Error("Validated Wasm string literal omitted its static layout.")
      this.mappedOp(0x41, expression, path, "string pointer constant", "literal")
      this.mappedImmediate(s32(literal.address), expression, path, "string pointer immediate", "literal")
      this.mappedOp(0x41, expression, path, "string length constant", "literal")
      this.mappedImmediate(s32(literal.bytes.byteLength), expression, path, "string length immediate", "literal")
      return
    }
    if (expression.kind == "CallExpression") {
      for (let index = 0; index < expression.arguments.length; index += 1) {
        this.expression(expression.arguments[index], `${path}/arguments/${index}`)
      }
      this.semanticCall(expression, path)
      return
    }
    if (expression.kind == "UnaryExpression") {
      this.expression(expression.operand, `${path}/operand`)
      if (expression.operation == "BooleanNot") this.mappedOp(0x45, expression, path, "Boolean not instruction", "operator")
      else {
        this.mappedOp(0x10, expression, path, "checked integer negate instruction", "operator")
        this.mappedImmediate(u32(checkedNegateFunctionIndex), expression, path, "checked helper index", "operator")
      }
      return
    }
    if (expression.operation == "BooleanAnd" || expression.operation == "BooleanOr") {
      this.expression(expression.left, `${path}/left`)
      this.mappedOp(0x04, expression, path, "short-circuit conditional", "operator")
      this.syntheticImmediate([valueTypes.i32], expression, path, "Boolean conditional result type")
      if (expression.operation == "BooleanAnd") {
        this.expression(expression.right, `${path}/right`)
        this.mappedOp(0x05, expression, path, "short-circuit alternate", "operator")
        this.syntheticI32(0, expression, path, "canonical false result")
      } else {
        this.syntheticI32(1, expression, path, "canonical true result")
        this.mappedOp(0x05, expression, path, "short-circuit alternate", "operator")
        this.expression(expression.right, `${path}/right`)
      }
      this.mappedOp(0x0b, expression, path, "short-circuit end", "operator")
      return
    }

    this.expression(expression.left, `${path}/left`)
    this.expression(expression.right, `${path}/right`)
    const directOpcode = new Map([
      ["IntegerEqual", 0x51], ["IntegerNotEqual", 0x52], ["IntegerLessThan", 0x53],
      ["IntegerGreaterThan", 0x55], ["IntegerLessThanOrEqual", 0x57], ["IntegerGreaterThanOrEqual", 0x59],
      ["BooleanEqual", 0x46], ["BooleanNotEqual", 0x47]
    ]).get(expression.operation)

    if (directOpcode !== undefined) this.mappedOp(directOpcode, expression, path, `${expression.operation} instruction`, "operator")
    else {
      const helperIndex = expression.operation == "StringConcat" ? concatFunctionIndex :
        expression.operation == "StringEqual" || expression.operation == "StringNotEqual" ? stringEqualFunctionIndex :
          expression.operation == "IntegerAdd" ? checkedAddFunctionIndex :
            expression.operation == "IntegerSubtract" ? checkedSubtractFunctionIndex : checkedMultiplyFunctionIndex

      this.mappedOp(0x10, expression, path, `${expression.operation} helper call`, "operator")
      this.mappedImmediate(u32(helperIndex), expression, path, "helper function index", "operator")
      if (expression.operation == "StringNotEqual") this.mappedOp(0x45, expression, path, "String inequality inversion", "operator")
    }
  }

  /**
   * Emits checked semantic-call depth accounting without changing argument order.
   * @param {import("../semantic/types.js").CallExpression} expression - Call expression.
   * @param {string} path - Call occurrence path.
   * @returns {void}
   */
  semanticCall(expression, path) {
    const declaration = this.functions.get(expression.callee)
    const functionIndex = this.functionIndexes.get(expression.callee)

    if (!declaration || functionIndex === undefined) throw new Error("Validated Wasm call omitted its declaration.")
    this.syntheticOp(0x23, expression, path, "read semantic call depth")
    this.syntheticImmediate(u32(depthGlobalIndex), expression, path, "call-depth global index")
    this.syntheticI32(maximumCallDepth, expression, path, "maximum semantic call depth")
    this.syntheticOp(0x4f, expression, path, "semantic call-depth limit comparison")
    this.syntheticOp(0x04, expression, path, "semantic call-depth guard")
    this.syntheticImmediate([0x40], expression, path, "empty call-depth guard block type")
    this.syntheticOp(0x00, expression, path, "semantic call-depth trap")
    this.syntheticOp(0x0b, expression, path, "semantic call-depth guard end")
    this.syntheticOp(0x23, expression, path, "read semantic call depth")
    this.syntheticImmediate(u32(depthGlobalIndex), expression, path, "call-depth global index")
    this.syntheticI32(1, expression, path, "semantic call-depth increment")
    this.syntheticOp(0x6a, expression, path, "increment semantic call depth")
    this.syntheticGlobalSet(depthGlobalIndex, expression, path, "call depth")
    this.mappedOp(0x10, expression, path, "semantic call instruction", "callee")
    this.mappedImmediate(u32(functionIndex), expression, path, "semantic callee index", "callee")

    const result = this.allocateBinding(declaration.returnType.name)

    this.setBinding(result, expression, path)
    this.syntheticOp(0x23, expression, path, "read semantic call depth")
    this.syntheticImmediate(u32(depthGlobalIndex), expression, path, "call-depth global index")
    this.syntheticI32(1, expression, path, "semantic call-depth decrement")
    this.syntheticOp(0x6b, expression, path, "decrement semantic call depth")
    this.syntheticGlobalSet(depthGlobalIndex, expression, path, "call depth")
    for (const localIndex of result.indexes) {
      this.syntheticOp(0x20, expression, path, "restore semantic call result")
      this.syntheticImmediate(u32(localIndex), expression, path, "result temporary local index")
    }
  }

  /**
   * Allocates flattened Wasm locals for one semantic value.
   * @param {Scalar} type - Semantic type.
   * @returns {LocalBinding} Local binding.
   */
  allocateBinding(type) {
    const indexes = wasmTypes(type).map((wasmType) => {
      const index = this.parameterCount + this.locals.length

      this.locals.push(wasmType)

      return index
    })

    return {indexes, type}
  }

  /**
   * Pops a flattened value into its locals.
   * @param {LocalBinding} binding - Destination.
   * @param {SemanticNode} node - Related semantic node.
   * @param {string} path - Occurrence path.
   * @param {string} [sourceRole] - Exact parser-owned token role, when this is a semantic binding.
   * @returns {void}
   */
  setBinding(binding, node, path, sourceRole) {
    for (let index = binding.indexes.length - 1; index >= 0; index -= 1) {
      if (sourceRole) {
        this.mappedOp(0x21, node, path, "local write", sourceRole)
        this.mappedImmediate(u32(binding.indexes[index]), node, path, "local index", sourceRole)
      } else {
        this.syntheticOp(0x21, node, path, "store semantic call result")
        this.syntheticImmediate(u32(binding.indexes[index]), node, path, "result temporary local index")
      }
    }
  }

  /**
   * Writes a source-mapped instruction opcode.
   * @param {number} opcode - Wasm opcode.
   * @param {SemanticNode} node - Related semantic node.
   * @param {string} path - Node occurrence path.
   * @param {string} role - Mapping role.
   * @param {string} [sourceRole] - Exact parser-owned token role.
   * @returns {void}
   */
  mappedOp(opcode, node, path, role, sourceRole) { this.writer.mapped([opcode], node, path, role, sourceRole) }

  /**
   * Writes a source-mapped instruction immediate.
   * @param {number[]} bytes - Encoded immediate bytes.
   * @param {SemanticNode} node - Related semantic node.
   * @param {string} path - Node occurrence path.
   * @param {string} role - Mapping role.
   * @param {string} [sourceRole] - Exact parser-owned token role.
   * @returns {void}
   */
  mappedImmediate(bytes, node, path, role, sourceRole) { this.writer.mapped(bytes, node, path, role, sourceRole) }

  /**
   * Writes a synthetic instruction opcode with semantic context.
   * @param {number} opcode - Wasm opcode.
   * @param {SemanticNode} node - Related semantic node.
   * @param {string} path - Node occurrence path.
   * @param {string} reason - Synthetic provenance reason.
   * @returns {void}
   */
  syntheticOp(opcode, node, path, reason) { this.writer.synthetic([opcode], reason, {node, path}, "instruction") }

  /**
   * Writes a synthetic immediate with semantic context.
   * @param {number[]} bytes - Encoded immediate bytes.
   * @param {SemanticNode} node - Related semantic node.
   * @param {string} path - Node occurrence path.
   * @param {string} reason - Synthetic provenance reason.
   * @returns {void}
   */
  syntheticImmediate(bytes, node, path, reason) { this.writer.synthetic(bytes, reason, {node, path}, "immediate") }

  /**
   * Writes a synthetic i32 constant instruction.
   * @param {number} value - Constant value.
   * @param {SemanticNode} node - Related semantic node.
   * @param {string} path - Node occurrence path.
   * @param {string} reason - Synthetic provenance reason.
   * @returns {void}
   */
  syntheticI32(value, node, path, reason) {
    this.syntheticOp(0x41, node, path, reason)
    this.syntheticImmediate(s32(value), node, path, `${reason} immediate`)
  }

  /**
   * Writes a synthetic global assignment.
   * @param {number} index - Global index.
   * @param {SemanticNode} node - Related semantic node.
   * @param {string} path - Node occurrence path.
   * @param {string} reason - Synthetic provenance reason.
   * @returns {void}
   */
  syntheticGlobalSet(index, node, path, reason) {
    this.syntheticOp(0x24, node, path, `set ${reason}`)
    this.syntheticImmediate(u32(index), node, path, `${reason} global index`)
  }

  /**
   * Writes a synthetic function-end instruction.
   * @param {SemanticNode} node - Related semantic node.
   * @param {string} path - Node occurrence path.
   * @returns {void}
   */
  syntheticEnd(node, path) { this.syntheticOp(0x0b, node, path, "function end") }

  /**
   * Writes a synthetic unreachable instruction.
   * @param {SemanticNode} node - Related semantic node.
   * @param {string} path - Node occurrence path.
   * @returns {void}
   */
  syntheticUnreachable(node, path) { this.syntheticOp(0x00, node, path, "validated non-void fallthrough trap") }
}

/** Byte writer that preserves one non-overlapping provenance annotation per write. */
class BinaryWriter {
  /**
   * Creates an annotated binary writer.
   * @param {ReturnType<typeof createGenerationIndex>} index - Canonical provenance index.
   */
  constructor(index) {
    this.index = index
    /** @type {number[]} */
    this.bytes = []
    /** @type {GeneratedByteRange[]} */
    this.ranges = []
  }

  /**
   * Writes source-backed bytes.
   * @param {number[] | Uint8Array} bytes - Exact bytes.
   * @param {SemanticNode} node - Semantic node.
   * @param {string} path - Occurrence path.
   * @param {string} role - Binary role.
   * @param {string} [sourceRole] - Exact parser-owned token role.
   * @returns {void}
   */
  mapped(bytes, node, path, role, sourceRole) {
    const record = this.index.recordFor(node, path)
    const origin = sourceRole ? originForRole(this.index, record, sourceRole) : record.origin

    this.write(bytes, {nodeId: record.id, origin, role, symbolId: record.symbolId})
  }

  /**
   * Writes explicit backend scaffolding bytes.
   * @param {number[] | Uint8Array} bytes - Exact bytes.
   * @param {string} reason - Synthetic reason.
   * @param {{node: SemanticNode, path: string}} related - Related occurrence.
   * @param {string} role - Binary role.
   * @returns {void}
   */
  synthetic(bytes, reason, related, role) {
    const record = this.index.recordFor(related.node, related.path)

    this.write(bytes, {
      origin: {kind: "synthetic", reason, relatedOrigins: relatedOrigins(record)},
      role
    })
  }

  /**
   * Appends another annotated writer.
   * @param {BinaryWriter} child - Child bytes.
   * @returns {void}
   */
  append(child) {
    const offset = this.bytes.length

    for (const byte of child.bytes) this.bytes.push(byte)
    for (const range of child.ranges) {
      this.ranges.push({...range, generated: {start: range.generated.start + offset, end: range.generated.end + offset}})
    }
  }

  /**
   * Returns detached encoded bytes.
   * @returns {Uint8Array} Detached bytes.
   */
  finish() { return Uint8Array.from(this.bytes) }

  /**
   * Writes one non-empty annotated range.
   * @param {number[] | Uint8Array} bytes - Exact bytes.
   * @param {Omit<GeneratedByteRange, "generated">} annotation - Provenance.
   * @returns {void}
   */
  write(bytes, annotation) {
    if (bytes.length == 0) return
    const start = this.bytes.length

    for (const byte of bytes) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new RangeError("Invalid WebAssembly byte.")
      this.bytes.push(byte)
    }
    this.ranges.push({...annotation, generated: {start, end: this.bytes.length}})
  }
}

/** Deterministic function-type interner. */
class TypePool {
  constructor() {
    /** @type {{parameters: ("i32" | "i64")[], results: ("i32" | "i64")[]}[]} */
    this.entries = []
    /** @type {Map<string, number>} */
    this.indexes = new Map()
  }

  /**
   * Interns one function type.
   * @param {("i32" | "i64")[]} parameters - Parameters.
   * @param {("i32" | "i64")[]} results - Results.
   * @returns {number} Type index.
   */
  add(parameters, results) {
    const key = `${parameters.join(",")}->${results.join(",")}`
    const prior = this.indexes.get(key)

    if (prior !== undefined) return prior
    const index = this.entries.length

    this.entries.push({parameters, results})
    this.indexes.set(key, index)

    return index
  }
}

/**
 * Encodes the function-type section payload.
 * @param {TypePool} types - Interned function types.
 * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
 * @param {{node: SemanticNode, path: string}} root - Related module occurrence.
 * @returns {BinaryWriter} Encoded payload.
 */
function encodeTypeSection(types, index, root) {
  const writer = new BinaryWriter(index)

  writer.synthetic(u32(types.entries.length), "Function type count", root, "type count")
  for (const type of types.entries) {
    writer.synthetic([0x60], "Function type form", root, "type form")
    writer.synthetic(u32(type.parameters.length), "Function parameter count", root, "type parameter count")
    for (const parameter of type.parameters) writer.synthetic([valueTypes[parameter]], "Function parameter value type", root, "value type")
    writer.synthetic(u32(type.results.length), "Function result count", root, "type result count")
    for (const result of type.results) writer.synthetic([valueTypes[result]], "Function result value type", root, "value type")
  }

  return writer
}

/**
 * Encodes the fixed ABI import section payload.
 * @param {number[]} typeIndexes - Import function type indexes.
 * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
 * @param {{node: SemanticNode, path: string}} root - Related module occurrence.
 * @returns {BinaryWriter} Encoded payload.
 */
function encodeImportSection(typeIndexes, index, root) {
  const writer = new BinaryWriter(index)
  const names = ["print_i64", "print_bool", "print_string"]

  writer.synthetic(u32(names.length), "ABI import count", root, "import count")
  for (let offset = 0; offset < names.length; offset += 1) {
    writer.synthetic(nameBytes("semantifold"), "ABI import module name", root, "import module")
    writer.synthetic(nameBytes(names[offset]), "ABI import function name", root, "import name")
    writer.synthetic([0x00], "Function import kind", root, "import kind")
    writer.synthetic(u32(typeIndexes[offset]), "ABI import type index", root, "type index")
  }

  return writer
}

/**
 * Encodes defined-function type indexes.
 * @param {number[]} helperTypes - Private helper type indexes.
 * @param {number[]} semanticTypes - Semantic function type indexes.
 * @param {number} runType - Exported run function type index.
 * @param {SemanticModule} module - Semantic module.
 * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
 * @returns {BinaryWriter} Encoded payload.
 */
function encodeFunctionSection(helperTypes, semanticTypes, runType, module, index) {
  const writer = new BinaryWriter(index)
  const root = {node: module, path: ""}

  writer.synthetic(u32(helperTypes.length + semanticTypes.length + 1), "Defined function count", root, "function count")
  for (const typeIndex of helperTypes) writer.synthetic(u32(typeIndex), "Private ABI helper type index", root, "type index")
  for (let offset = 0; offset < semanticTypes.length; offset += 1) {
    const declaration = module.functions[offset]

    writer.synthetic(u32(semanticTypes[offset]), "Semantic function type index", {node: declaration, path: `/functions/${offset}`}, "type index")
  }
  writer.synthetic(u32(runType), "Exported run type index", {node: module.entryPoint, path: "/entryPoint"}, "type index")

  return writer
}

/**
 * Encodes one fixed-memory declaration.
 * @param {number} pages - Equal initial and maximum page count.
 * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
 * @param {{node: SemanticNode, path: string}} root - Related module occurrence.
 * @returns {BinaryWriter} Encoded payload.
 */
function encodeMemorySection(pages, index, root) {
  const writer = new BinaryWriter(index)

  writer.synthetic(u32(1), "Single fixed linear memory", root, "memory count")
  writer.synthetic([0x01], "Memory limits include equal maximum", root, "memory limits flags")
  writer.synthetic(u32(pages), "Initial memory page count", root, "memory initial pages")
  writer.synthetic(u32(pages), "Maximum memory page count", root, "memory maximum pages")

  return writer
}

/**
 * Encodes private mutable ABI globals.
 * @param {number} scratchBase - Initial scratch cursor.
 * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
 * @param {{node: SemanticNode, path: string}} root - Related module occurrence.
 * @returns {BinaryWriter} Encoded payload.
 */
function encodeGlobalSection(scratchBase, index, root) {
  const writer = new BinaryWriter(index)
  const globals = [
    {initial: scratchBase, reason: "Private scratch cursor"},
    {initial: 0, reason: "Private semantic call depth"},
    {initial: 0, reason: "Private run active guard"}
  ]

  writer.synthetic(u32(globals.length), "Private mutable global count", root, "global count")
  for (const global of globals) {
    writer.synthetic([valueTypes.i32, 0x01], `${global.reason} type and mutability`, root, "global type")
    writer.synthetic([0x41], `${global.reason} initializer instruction`, root, "instruction")
    writer.synthetic(s32(global.initial), `${global.reason} initializer immediate`, root, "immediate")
    writer.synthetic([0x0b], `${global.reason} initializer end`, root, "instruction")
  }

  return writer
}

/**
 * Encodes exactly the public memory and run exports.
 * @param {number} runIndex - Exported run function index.
 * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
 * @param {{node: SemanticNode, path: string}} root - Related module occurrence.
 * @returns {BinaryWriter} Encoded payload.
 */
function encodeExportSection(runIndex, index, root) {
  const writer = new BinaryWriter(index)

  writer.synthetic(u32(2), "Exact ABI export count", root, "export count")
  writer.synthetic(nameBytes("memory"), "Exported memory name", root, "export name")
  writer.synthetic([0x02], "Memory export kind", root, "export kind")
  writer.synthetic(u32(0), "Exported memory index", root, "memory index")
  writer.synthetic(nameBytes("run"), "Exported run name", root, "export name")
  writer.synthetic([0x00], "Function export kind", root, "export kind")
  writer.synthetic(u32(runIndex), "Exported run function index", root, "function index")

  return writer
}

/**
 * Encodes immutable UTF-8 literal data segments.
 * @param {ReturnType<typeof collectLiteralLayout>["entries"]} entries - Ordered literal entries.
 * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
 * @param {{node: SemanticNode, path: string}} root - Related module occurrence.
 * @returns {BinaryWriter} Encoded payload.
 */
function encodeDataSection(entries, index, root) {
  const writer = new BinaryWriter(index)
  const nonempty = entries.filter(({bytes}) => bytes.byteLength > 0)

  writer.synthetic(u32(nonempty.length), "Immutable literal data segment count", root, "data segment count")
  for (const entry of nonempty) {
    writer.synthetic([0x00, 0x41], "Active literal data segment and offset instruction", root, "data segment header")
    writer.synthetic(s32(entry.address), "Literal data address", root, "data segment offset")
    writer.synthetic([0x0b], "Literal offset expression end", root, "instruction")
    writer.synthetic(u32(entry.bytes.byteLength), "Literal data byte length", root, "data segment length")
    writer.write(entry.bytes, {
      origin: entry.origin,
      role: "immutable UTF-8 literal data"
    })
  }

  return writer
}

/**
 * Encodes deterministic internal and semantic function names.
 * @param {SemanticModule} module - Semantic module.
 * @param {number} runIndex - Exported run function index.
 * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
 * @returns {BinaryWriter} Encoded custom-section payload.
 */
function encodeNamePayload(module, runIndex, index) {
  const writer = new BinaryWriter(index)
  const root = {node: module, path: ""}
  const subsection = new BinaryWriter(index)
  /** @type {{declaration?: import("../semantic/types.js").FunctionDeclaration, index: number, name: string, path?: string}[]} */
  const names = [
    ...helperNames.map((name, offset) => ({index: importCount + offset, name})),
    ...module.functions.map((declaration, offset) => ({declaration, index: importCount + helperCount + offset, name: declaration.name, path: `/functions/${offset}`})),
    {index: runIndex, name: "run"}
  ]

  subsection.synthetic(u32(names.length), "Named function count", root, "name count")
  for (const name of names) {
    subsection.synthetic(u32(name.index), "Named function index", root, "function index")
    if (name.declaration) {
      const bytes = encoder.encode(name.name)
      const related = {node: name.declaration, path: /** @type {string} */ (name.path)}

      subsection.synthetic(u32(bytes.byteLength), "Semantic function name byte length", related, "function name length")
      subsection.mapped(bytes, name.declaration, related.path, "semantic function name", "name")
    } else subsection.synthetic(nameBytes(name.name), "Private ABI function name", root, "function name")
  }
  writer.synthetic([0x01], "Function names subsection ID", root, "custom subsection id")
  writer.synthetic(u32(subsection.bytes.length), "Function names subsection size", root, "custom subsection size")
  writer.append(subsection)

  return writer
}

/**
 * Encodes one source-map URL custom-section payload.
 * @param {string} content - Relative map URL.
 * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
 * @param {{node: SemanticNode, path: string}} root - Related module occurrence.
 * @returns {BinaryWriter} Encoded payload.
 */
function namedPayload(content, index, root) {
  const writer = new BinaryWriter(index)

  writer.synthetic(encoder.encode(content), "Relative external Wasm source-map URL", root, "custom section payload")

  return writer
}

/**
 * Appends one sized module section.
 * @param {BinaryWriter} moduleWriter - Complete module writer.
 * @param {number} id - Core section ID.
 * @param {string} name - Diagnostic section name.
 * @param {BinaryWriter} payload - Encoded section payload.
 * @param {{node: SemanticNode, path: string}} root - Related module occurrence.
 * @returns {void}
 */
function appendSection(moduleWriter, id, name, payload, root) {
  moduleWriter.synthetic([id], `${name} section ID`, root, `${name} section`)
  moduleWriter.synthetic(u32(payload.bytes.length), `${name} section byte length`, root, `${name} section length`)
  moduleWriter.append(payload)
}

/**
 * Appends one named custom section.
 * @param {BinaryWriter} writer - Complete module writer.
 * @param {string} name - Custom-section name.
 * @param {BinaryWriter} payload - Custom-section payload.
 * @param {{node: SemanticNode, path: string}} root - Related module occurrence.
 * @returns {void}
 */
function appendCustomSection(writer, name, payload, root) {
  const complete = new BinaryWriter(writer.index)

  complete.synthetic(nameBytes(name), `Custom section name '${name}'`, root, "custom section name")
  complete.append(payload)
  appendSection(writer, 0, `custom ${name}`, complete, root)
}

/**
 * Appends one sized function body and its flattened locals.
 * @param {BinaryWriter} code - Code-section payload writer.
 * @param {BinaryWriter} instructions - Function instructions.
 * @param {("i32" | "i64")[]} locals - Flattened local types.
 * @param {{node: SemanticNode, path: string}} related - Related semantic occurrence.
 * @param {string} name - Function name for provenance.
 * @returns {void}
 */
function appendFunctionBody(code, instructions, locals, related, name) {
  const body = new BinaryWriter(code.index)

  body.synthetic(u32(locals.length), `Local declaration group count for ${name}`, related, "function locals")
  for (const local of locals) {
    body.synthetic(u32(1), `Local count for ${name}`, related, "local count")
    body.synthetic([valueTypes[local]], `Local value type for ${name}`, related, "local type")
  }
  body.append(instructions)
  code.synthetic(u32(body.bytes.length), `Function body byte length for ${name}`, related, "function body length")
  code.append(body)
}

/**
 * Encodes checked scratch allocation and string concatenation.
 * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
 * @param {SemanticModule} module - Semantic module.
 * @param {number} scratchBase - Arena start address.
 * @returns {BinaryWriter} Encoded helper body.
 */
function helperConcat(index, module, scratchBase) {
  const e = new SyntheticEmitter(index, module, "$concat")
  const total = 4
  const start = 5
  const end = 6
  const cursor = 7

  e.localGet(1); e.localGet(3); e.op(0x6a, "add string lengths"); e.localTee(total)
  e.localGet(1); e.op(0x49, "detect unsigned string-length overflow"); e.trapIf("string-length overflow")
  e.globalGet(cursorGlobalIndex); e.localTee(start)
  e.localGet(total); e.op(0x6a, "add scratch cursor and allocation length"); e.localTee(end)
  e.localGet(start); e.op(0x49, "detect unsigned scratch-cursor overflow"); e.trapIf("scratch cursor overflow")
  e.localGet(end); e.i32(scratchBase + scratchCapacity); e.op(0x4b, "compare allocation end with arena end"); e.trapIf("scratch capacity exceeded")
  e.i32(0); e.localSet(cursor)
  e.copyLoop(cursor, 0, 1, start, undefined)
  e.i32(0); e.localSet(cursor)
  e.copyLoop(cursor, 2, 3, start, 1)
  e.localGet(end); e.globalSet(cursorGlobalIndex)
  e.localGet(start); e.localGet(total); e.end()

  return e.writer
}

/**
 * Encodes byte-exact string equality.
 * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
 * @param {SemanticModule} module - Semantic module.
 * @returns {BinaryWriter} Encoded helper body.
 */
function helperStringEqual(index, module) {
  const e = new SyntheticEmitter(index, module, "$string_equal")
  const cursor = 4

  e.localGet(1); e.localGet(3); e.op(0x47, "compare string lengths")
  e.op(0x04, "branch for unequal string lengths"); e.immediate([0x40], "empty block type")
  e.i32(0); e.op(0x0f, "return false for unequal lengths"); e.op(0x0b, "end length branch")
  e.i32(0); e.localSet(cursor)
  e.op(0x02, "string comparison exit block"); e.immediate([0x40], "empty block type")
  e.op(0x03, "string comparison loop"); e.immediate([0x40], "empty block type")
  e.localGet(cursor); e.localGet(1); e.op(0x4f, "compare cursor with string length")
  e.op(0x0d, "exit completed comparison"); e.immediate(u32(1), "comparison block depth")
  e.localGet(0); e.localGet(cursor); e.op(0x6a, "left byte address"); e.load8()
  e.localGet(2); e.localGet(cursor); e.op(0x6a, "right byte address"); e.load8()
  e.op(0x47, "compare UTF-8 bytes")
  e.op(0x04, "branch for unequal UTF-8 bytes"); e.immediate([0x40], "empty block type")
  e.i32(0); e.op(0x0f, "return false for unequal bytes"); e.op(0x0b, "end byte branch")
  e.localGet(cursor); e.i32(1); e.op(0x6a, "increment comparison cursor"); e.localSet(cursor)
  e.op(0x0c, "continue string comparison"); e.immediate(u32(0), "comparison loop depth")
  e.op(0x0b, "end comparison loop"); e.op(0x0b, "end comparison block")
  e.i32(1); e.end()

  return e.writer
}

/**
 * Encodes checked signed i64 addition.
 * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
 * @param {SemanticModule} module - Semantic module.
 * @returns {BinaryWriter} Encoded helper body.
 */
function helperCheckedAdd(index, module) {
  const e = new SyntheticEmitter(index, module, "$checked_add")

  e.localGet(0); e.localGet(1); e.op(0x7c, "signed i64 addition"); e.localSet(2)
  e.localGet(0); e.localGet(2); e.op(0x85, "addition overflow xor")
  e.localGet(1); e.localGet(2); e.op(0x85, "addition overflow xor")
  e.op(0x83, "addition overflow mask"); e.i64(0n); e.op(0x53, "addition overflow sign test"); e.trapIf("signed i64 addition overflow")
  e.localGet(2); e.end()

  return e.writer
}

/**
 * Encodes checked signed i64 subtraction.
 * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
 * @param {SemanticModule} module - Semantic module.
 * @returns {BinaryWriter} Encoded helper body.
 */
function helperCheckedSubtract(index, module) {
  const e = new SyntheticEmitter(index, module, "$checked_subtract")

  e.localGet(0); e.localGet(1); e.op(0x7d, "signed i64 subtraction"); e.localSet(2)
  e.localGet(0); e.localGet(1); e.op(0x85, "subtraction overflow xor")
  e.localGet(0); e.localGet(2); e.op(0x85, "subtraction overflow xor")
  e.op(0x83, "subtraction overflow mask"); e.i64(0n); e.op(0x53, "subtraction overflow sign test"); e.trapIf("signed i64 subtraction overflow")
  e.localGet(2); e.end()

  return e.writer
}

/**
 * Encodes checked signed i64 multiplication.
 * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
 * @param {SemanticModule} module - Semantic module.
 * @returns {BinaryWriter} Encoded helper body.
 */
function helperCheckedMultiply(index, module) {
  const e = new SyntheticEmitter(index, module, "$checked_multiply")

  e.localGet(0); e.op(0x50, "left operand zero test")
  e.localGet(1); e.op(0x50, "right operand zero test"); e.op(0x72, "zero operand combination")
  e.op(0x04, "zero multiplication branch"); e.immediate([valueTypes.i64], "i64 branch result type")
  e.i64(0n)
  e.op(0x05, "nonzero multiplication branch")
  e.localGet(0); e.i64(-1n); e.op(0x51, "left negative-one test")
  e.localGet(1); e.i64(-9223372036854775808n); e.op(0x51, "right minimum test"); e.op(0x71, "first division overflow combination")
  e.localGet(1); e.i64(-1n); e.op(0x51, "right negative-one test")
  e.localGet(0); e.i64(-9223372036854775808n); e.op(0x51, "left minimum test"); e.op(0x71, "second division overflow combination")
  e.op(0x72, "division overflow combination"); e.trapIf("signed i64 multiplication overflow")
  e.localGet(0); e.localGet(1); e.op(0x7e, "signed i64 multiplication"); e.localSet(2)
  e.localGet(2); e.localGet(1); e.op(0x7f, "signed i64 division overflow check"); e.localGet(0); e.op(0x52, "multiplication quotient mismatch")
  e.trapIf("signed i64 multiplication overflow")
  e.localGet(2); e.op(0x0b, "end checked multiplication branch"); e.end()

  return e.writer
}

/**
 * Encodes checked signed i64 negation.
 * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
 * @param {SemanticModule} module - Semantic module.
 * @returns {BinaryWriter} Encoded helper body.
 */
function helperCheckedNegate(index, module) {
  const e = new SyntheticEmitter(index, module, "$checked_negate")

  e.localGet(0); e.i64(-9223372036854775808n); e.op(0x51, "minimum i64 negate test"); e.trapIf("signed i64 negation overflow")
  e.i64(0n); e.localGet(0); e.op(0x7d, "signed i64 negation"); e.end()

  return e.writer
}

/** Helper instruction emitter with explicit synthetic provenance. */
class SyntheticEmitter {
  /**
   * Creates a synthetic helper emitter.
   * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
   * @param {SemanticModule} module - Related semantic module.
   * @param {string} name - Helper function name.
   */
  constructor(index, module, name) {
    this.writer = new BinaryWriter(index)
    this.related = {node: module, path: ""}
    this.name = name
  }

  /**
   * Writes an instruction opcode.
   * @param {number} opcode - Wasm opcode.
   * @param {string} reason - Synthetic provenance reason.
   * @returns {void}
   */
  op(opcode, reason) { this.writer.synthetic([opcode], `${this.name}: ${reason}`, this.related, "instruction") }

  /**
   * Writes encoded instruction immediates.
   * @param {number[]} bytes - Immediate bytes.
   * @param {string} reason - Synthetic provenance reason.
   * @returns {void}
   */
  immediate(bytes, reason) { this.writer.synthetic(bytes, `${this.name}: ${reason}`, this.related, "immediate") }

  /**
   * Reads one local.
   * @param {number} index - Local index.
   * @returns {void}
   */
  localGet(index) { this.op(0x20, "read local"); this.immediate(u32(index), "local index") }

  /**
   * Writes one local.
   * @param {number} index - Local index.
   * @returns {void}
   */
  localSet(index) { this.op(0x21, "write local"); this.immediate(u32(index), "local index") }

  /**
   * Writes and retains one local value.
   * @param {number} index - Local index.
   * @returns {void}
   */
  localTee(index) { this.op(0x22, "tee local"); this.immediate(u32(index), "local index") }

  /**
   * Reads one global.
   * @param {number} index - Global index.
   * @returns {void}
   */
  globalGet(index) { this.op(0x23, "read global"); this.immediate(u32(index), "global index") }

  /**
   * Writes one global.
   * @param {number} index - Global index.
   * @returns {void}
   */
  globalSet(index) { this.op(0x24, "write global"); this.immediate(u32(index), "global index") }

  /**
   * Writes one i32 constant.
   * @param {number} value - Constant value.
   * @returns {void}
   */
  i32(value) { this.op(0x41, "i32 constant"); this.immediate(s32(value), "i32 immediate") }

  /**
   * Writes one i64 constant.
   * @param {bigint} value - Constant value.
   * @returns {void}
   */
  i64(value) { this.op(0x42, "i64 constant"); this.immediate(s64(value), "i64 immediate") }

  /**
   * Loads one unsigned byte.
   * @returns {void}
   */
  load8() { this.op(0x2d, "load unsigned byte"); this.immediate([0x00, 0x00], "byte-load memory arguments") }

  /**
   * Stores one byte.
   * @returns {void}
   */
  store8() { this.op(0x3a, "store byte"); this.immediate([0x00, 0x00], "byte-store memory arguments") }

  /**
   * Traps when the stack's condition is nonzero.
   * @param {string} reason - Trap provenance reason.
   * @returns {void}
   */
  trapIf(reason) {
    this.op(0x04, `${reason} branch`); this.immediate([0x40], "empty block type")
    this.op(0x00, `${reason} trap`); this.op(0x0b, `${reason} branch end`)
  }
  /**
   * Copies one string operand byte by byte.
   * @param {number} cursor - Loop cursor local.
   * @param {number} sourcePointer - Source pointer local.
   * @param {number} sourceLength - Source length local.
   * @param {number} destination - Allocation start local.
   * @param {number | undefined} destinationOffset - Optional left-length local.
   * @returns {void}
   */
  copyLoop(cursor, sourcePointer, sourceLength, destination, destinationOffset) {
    this.op(0x02, "copy exit block"); this.immediate([0x40], "empty block type")
    this.op(0x03, "copy loop"); this.immediate([0x40], "empty block type")
    this.localGet(cursor); this.localGet(sourceLength); this.op(0x4f, "compare copy cursor with length")
    this.op(0x0d, "exit completed copy"); this.immediate(u32(1), "copy block depth")
    this.localGet(destination)
    if (destinationOffset !== undefined) { this.localGet(destinationOffset); this.op(0x6a, "add destination offset") }
    this.localGet(cursor); this.op(0x6a, "add destination cursor")
    this.localGet(sourcePointer); this.localGet(cursor); this.op(0x6a, "add source cursor"); this.load8(); this.store8()
    this.localGet(cursor); this.i32(1); this.op(0x6a, "increment copy cursor"); this.localSet(cursor)
    this.op(0x0c, "continue copy loop"); this.immediate(u32(0), "copy loop depth")
    this.op(0x0b, "end copy loop"); this.op(0x0b, "end copy block")
  }
  /**
   * Ends one helper function.
   * @returns {void}
   */
  end() { this.op(0x0b, "function end") }
}

/**
 * Collects deduplicated literal bytes and their combined semantic origins.
 * @param {SemanticModule} module - Semantic module.
 * @param {ReturnType<typeof createGenerationIndex>} index - Provenance index.
 * @returns {{boundary: number, byValue: Map<string, {address: number, bytes: Uint8Array}>, entries: {address: number, bytes: Uint8Array, origin: import("../semantic/types.js").SemanticOrigin}[]}} Layout.
 */
function collectLiteralLayout(module, index) {
  /** @type {Map<string, {bytes: Uint8Array, occurrences: ReturnType<typeof index.recordFor>[]}>} */
  const collected = new Map()

  for (const {node, path} of semanticEntries(module)) {
    if (node.kind != "StringLiteral") continue
    const existing = collected.get(node.value)

    if (existing) existing.occurrences.push(index.recordFor(node, path))
    else collected.set(node.value, {bytes: encoder.encode(node.value), occurrences: [index.recordFor(node, path)]})
  }

  let address = 1
  /** @type {Map<string, {address: number, bytes: Uint8Array}>} */
  const byValue = new Map()
  /** @type {{address: number, bytes: Uint8Array, origin: import("../semantic/types.js").SemanticOrigin}[]} */
  const entries = []

  for (const [value, literal] of collected) {
    const next = checkedSize(address + literal.bytes.byteLength, module, "immutable literal memory layout")
    const exactOrigins = literal.occurrences.map((record) => originForRole(index, record, "literal"))
    const origins = literal.occurrences.flatMap((record, offset) => relatedOrigins(record, exactOrigins[offset]))
    const origin = literal.occurrences.length == 1 ? exactOrigins[0] : origins.length > 0
      ? {kind: "derived", origins}
      : {kind: "synthetic", reason: "Deduplicated immutable UTF-8 literal data without source ranges.", relatedOrigins: []}

    entries.push({address, bytes: literal.bytes, origin: /** @type {import("../semantic/types.js").SemanticOrigin} */ (origin)})
    byValue.set(value, {address, bytes: literal.bytes})
    address = next
  }

  return {boundary: address, byValue, entries}
}

/**
 * Performs bounded path-sensitive allocation analysis from run.
 * @param {SemanticModule} module - Validated module.
 * @returns {number} Worst reachable allocation bytes.
 */
function analyzeScratchUse(module) {
  const functions = new Map(module.functions.map((declaration) => [declaration.name, declaration]))
  let steps = 0

  const states = block(module.entryPoint.body, [{allocated: 0, env: new Map()}], 0)

  return Math.max(0, ...states.map(({allocated}) => allocated))

  /**
   * Analyzes one block from every incoming path state.
   * @param {import("../semantic/types.js").Block} semanticBlock - Block to analyze.
   * @param {AnalysisState[]} incoming - Incoming path states.
   * @param {number} depth - Active semantic call depth.
   * @returns {AnalysisState[]} Resulting path states.
   */
  function block(semanticBlock, incoming, depth) {
    let states = incoming

    for (const statement of semanticBlock.statements) {
      const next = []

      for (const state of states) {
        if (state.returned) { next.push(state); continue }
        if (statement.kind == "LocalDeclaration") {
          for (const result of expression(statement.initializer, state, depth)) {
            const env = new Map(result.state.env)

            env.set(statement.name, result.value)
            next.push({...result.state, env})
          }
        } else if (statement.kind == "AssignmentStatement") {
          for (const result of expression(statement.expression, state, depth)) {
            const env = new Map(result.state.env)

            env.set(statement.target.name, result.value)
            next.push({...result.state, env})
          }
        } else if (statement.kind == "PrintStatement") {
          for (const result of expression(statement.expression, state, depth)) next.push(result.state)
        } else if (statement.kind == "ReturnStatement") {
          for (const result of expression(statement.expression, state, depth)) next.push({...result.state, returned: result.value})
        } else {
          for (const condition of expression(statement.condition, state, depth)) {
            if (condition.value.knownBoolean !== false) {
              next.push(...withoutBranchLocals(block(statement.consequent, [cloneState(condition.state)], depth), condition.state.env))
            }
            if (condition.value.knownBoolean !== true) {
              const alternate = statement.alternate
                ? block(statement.alternate, [cloneState(condition.state)], depth)
                : [cloneState(condition.state)]

              next.push(...withoutBranchLocals(alternate, condition.state.env))
            }
          }
        }
      }
      states = boundedStates(next, statement)
    }

    return states
  }

  /**
   * Evaluates abstract values and allocation demand for one expression.
   * @param {Expression} value - Expression to analyze.
   * @param {AnalysisState} state - Incoming path state.
   * @param {number} depth - Active semantic call depth.
   * @returns {{state: AnalysisState, value: AbstractValue}[]} Possible outcomes.
   */
  function expression(value, state, depth) {
    steps += 1
    if (steps > maximumAnalysisSteps) unsupportedCapability("wasm", "unprovable path-sensitive scratch allocation bound", value.location)

    if (value.kind == "IdentifierExpression") {
      const found = state.env.get(value.name)

      if (!found) throw new Error("Validated Wasm analysis omitted an identifier binding.")

      return [{state, value: found}]
    }
    if (value.kind == "IntegerLiteral") return [{state, value: {knownInteger: BigInt(value.value), type: "integer"}}]
    if (value.kind == "BooleanLiteral") return [{state, value: {knownBoolean: value.value, type: "boolean"}}]
    if (value.kind == "StringLiteral") {
      return [{state, value: {knownString: value.value, stringLength: encoder.encode(value.value).byteLength, type: "string"}}]
    }
    if (value.kind == "CallExpression") {
      let argumentsList = [{state, values: /** @type {AbstractValue[]} */ ([])}]

      for (const argument of value.arguments) {
        const next = []

        for (const current of argumentsList) {
          for (const result of expression(argument, current.state, depth)) {
            next.push({state: result.state, values: [...current.values, result.value]})
          }
        }
        argumentsList = next
      }
      const declaration = functions.get(value.callee)

      if (!declaration) throw new Error("Validated Wasm analysis omitted a call declaration.")
      if (depth >= maximumCallDepth) unsupportedCapability("wasm", `semantic call depth above ${maximumCallDepth}`, value.location)
      /** @type {{state: AnalysisState, value: AbstractValue}[]} */
      const outcomes = []

      for (const argumentSet of argumentsList) {
        const env = new Map(declaration.parameters.map((parameter, index) => [parameter.name, argumentSet.values[index]]))
        const called = block(declaration.body, [{allocated: 0, env}], depth + 1)

        for (const returned of called) {
          if (!returned.returned) throw new Error("Validated Wasm function analysis omitted a return value.")
          outcomes.push({
            state: {...argumentSet.state, allocated: addAllocation(argumentSet.state.allocated, returned.allocated, value)},
            value: returned.returned
          })
        }
      }

      return outcomes
    }
    if (value.kind == "UnaryExpression") {
      return expression(value.operand, state, depth).map((operand) => {
        if (value.operation == "BooleanNot") {
          return {state: operand.state, value: {type: "boolean", ...(operand.value.knownBoolean === undefined ? {} : {knownBoolean: !operand.value.knownBoolean})}}
        }
        const knownInteger = operand.value.knownInteger === undefined ? undefined : checkedI64(-operand.value.knownInteger, value)

        return {state: operand.state, value: {type: "integer", ...(knownInteger === undefined ? {} : {knownInteger})}}
      })
    }
    if (value.operation == "BooleanAnd" || value.operation == "BooleanOr") {
      /** @type {{state: AnalysisState, value: AbstractValue}[]} */
      const outcomes = []

      for (const left of expression(value.left, state, depth)) {
        const shortCircuits = value.operation == "BooleanAnd" ? left.value.knownBoolean === false : left.value.knownBoolean === true
        const mustEvaluate = value.operation == "BooleanAnd" ? left.value.knownBoolean === true : left.value.knownBoolean === false

        if (shortCircuits || !mustEvaluate) outcomes.push({state: left.state, value: {knownBoolean: value.operation == "BooleanOr", type: "boolean"}})
        if (!shortCircuits) outcomes.push(...expression(value.right, cloneState(left.state), depth))
      }

      return outcomes
    }

    const outcomes = []

    for (const left of expression(value.left, state, depth)) {
      for (const right of expression(value.right, left.state, depth)) {
        outcomes.push(binary(value, left.value, right.value, right.state))
      }
    }

    return outcomes
  }

  /**
   * Combines abstract operands for one binary operation.
   * @param {import("../semantic/types.js").BinaryExpression} expressionNode - Binary expression.
   * @param {AbstractValue} left - Abstract left operand.
   * @param {AbstractValue} right - Abstract right operand.
   * @param {AnalysisState} state - State after evaluating both operands.
   * @returns {{state: AnalysisState, value: AbstractValue}} Combined outcome.
   */
  function binary(expressionNode, left, right, state) {
    const operation = expressionNode.operation

    if (operation == "StringConcat") {
      if (left.stringLength === undefined || right.stringLength === undefined) {
        unsupportedCapability("wasm", "unprovable StringConcat byte length", expressionNode.location)
      }
      const length = addAllocation(left.stringLength, right.stringLength, expressionNode)
      const allocated = addAllocation(state.allocated, length, expressionNode)
      const knownString = left.knownString !== undefined && right.knownString !== undefined ? left.knownString + right.knownString : undefined

      return {state: {...state, allocated}, value: {type: "string", stringLength: length, ...(knownString === undefined ? {} : {knownString})}}
    }
    if (["IntegerAdd", "IntegerSubtract", "IntegerMultiply"].includes(operation)) {
      let knownInteger

      if (left.knownInteger !== undefined && right.knownInteger !== undefined) {
        knownInteger = operation == "IntegerAdd" ? left.knownInteger + right.knownInteger :
          operation == "IntegerSubtract" ? left.knownInteger - right.knownInteger : left.knownInteger * right.knownInteger
        knownInteger = checkedI64(knownInteger, expressionNode)
      }

      return {state, value: {type: "integer", ...(knownInteger === undefined ? {} : {knownInteger})}}
    }
    if (operation.startsWith("Integer") && operation != "IntegerEqual" && operation != "IntegerNotEqual") {
      return {state, value: {knownBoolean: compareKnown(operation, left.knownInteger, right.knownInteger), type: "boolean"}}
    }
    if (operation == "IntegerEqual" || operation == "IntegerNotEqual") {
      return {state, value: {knownBoolean: equalKnown(left.knownInteger, right.knownInteger, operation.endsWith("NotEqual")), type: "boolean"}}
    }
    if (operation == "BooleanEqual" || operation == "BooleanNotEqual") {
      return {state, value: {knownBoolean: equalKnown(left.knownBoolean, right.knownBoolean, operation.endsWith("NotEqual")), type: "boolean"}}
    }

    return {state, value: {knownBoolean: equalKnown(left.knownString, right.knownString, operation == "StringNotEqual"), type: "boolean"}}
  }

  /**
   * Rejects path-state growth beyond the deterministic analysis bound.
   * @param {AnalysisState[]} candidates - Candidate states.
   * @param {{location: import("../semantic/types.js").SourceLocation}} node - Related semantic node.
   * @returns {AnalysisState[]} Accepted states.
   */
  function boundedStates(candidates, node) {
    if (candidates.length > maximumAnalysisSteps) unsupportedCapability("wasm", "unprovable path-sensitive scratch allocation state count", node.location)

    return candidates
  }
}

/**
 * Compares two known integer operands when available.
 * @param {string} operation - Semantic comparison operation.
 * @param {bigint | undefined} left - Known left operand.
 * @param {bigint | undefined} right - Known right operand.
 * @returns {boolean | undefined} Known comparison result.
 */
function compareKnown(operation, left, right) {
  if (left === undefined || right === undefined) return undefined
  if (operation == "IntegerLessThan") return left < right
  if (operation == "IntegerLessThanOrEqual") return left <= right
  if (operation == "IntegerGreaterThan") return left > right

  return left >= right
}

/**
 * Compares two known same-type operands when available.
 * @template T
 * @param {T | undefined} left - Known left operand.
 * @param {T | undefined} right - Known right operand.
 * @param {boolean} invert - Whether to invert equality.
 * @returns {boolean | undefined} Known equality result.
 */
function equalKnown(left, right, invert) {
  return left === undefined || right === undefined ? undefined : invert ? left !== right : left === right
}

/**
 * Checks one compile-time integer against signed i64 bounds.
 * @param {bigint} value - Candidate integer.
 * @param {{location: import("../semantic/types.js").SourceLocation}} node - Related semantic node.
 * @returns {bigint} Checked integer.
 */
function checkedI64(value, node) {
  if (value < -9223372036854775808n || value > 9223372036854775807n) {
    unsupportedCapability("wasm", "compile-time-known signed i64 overflow", node.location)
  }

  return value
}

/**
 * Adds bounded allocation counts without approximation.
 * @param {number} left - Existing allocation count.
 * @param {number} right - Additional allocation count.
 * @param {{location: import("../semantic/types.js").SourceLocation}} node - Related semantic node.
 * @returns {number} Checked total.
 */
function addAllocation(left, right, node) {
  const total = left + right

  if (!Number.isSafeInteger(total) || total < 0) unsupportedCapability("wasm", "scratch allocation arithmetic overflow", node.location)
  if (total > scratchCapacity) unsupportedCapability("wasm", `scratch allocation above ${scratchCapacity} bytes`, node.location)

  return total
}

/**
 * Clones one path state and its lexical environment.
 * @param {AnalysisState} state - State to clone.
 * @returns {AnalysisState} Detached state.
 */
function cloneState(state) { return {...state, env: new Map(state.env)} }

/**
 * Removes bindings declared only inside a branch.
 * @param {AnalysisState[]} states - Branch result states.
 * @param {Map<string, AbstractValue>} parent - Parent lexical environment.
 * @returns {AnalysisState[]} States restricted to parent bindings.
 */
function withoutBranchLocals(states, parent) {
  return states.map((state) => {
    const env = new Map([...state.env].filter(([name]) => parent.has(name)))

    return {...state, env}
  })
}

/**
 * Resolves one expression's semantic scalar type.
 * @param {Expression} expression - Expression to inspect.
 * @param {Map<string, LocalBinding>} bindings - Lexical local bindings.
 * @param {Map<string, import("../semantic/types.js").FunctionDeclaration>} functions - Semantic declarations by name.
 * @returns {Scalar} Expression type.
 */
function expressionType(expression, bindings, functions) {
  if (expression.kind == "IntegerLiteral") return "integer"
  if (expression.kind == "BooleanLiteral") return "boolean"
  if (expression.kind == "StringLiteral") return "string"
  if (expression.kind == "UnaryExpression" || expression.kind == "BinaryExpression") return expression.type
  if (expression.kind == "CallExpression") {
    const declaration = functions.get(expression.callee)

    if (!declaration) throw new Error("Validated Wasm expression omitted its call declaration.")

    return declaration.returnType.name
  }
  const binding = bindings.get(expression.name)

  if (!binding) throw new Error("Validated Wasm expression omitted its local binding.")

  return binding.type
}

/**
 * Flattens one semantic scalar into Wasm value types.
 * @param {Scalar} type - Semantic scalar type.
 * @returns {("i32" | "i64")[]} Wasm value types.
 */
function wasmTypes(type) { return type == "integer" ? ["i64"] : type == "boolean" ? ["i32"] : ["i32", "i32"] }

/**
 * Aligns an unsigned size upward.
 * @param {number} value - Unaligned value.
 * @param {number} alignment - Required alignment.
 * @returns {number} Aligned value.
 */
function align(value, alignment) { return Math.ceil(value / alignment) * alignment }

/**
 * Checks a computed module size against the portable u32 domain.
 * @param {number} value - Candidate size.
 * @param {{location: import("../semantic/types.js").SourceLocation}} node - Related semantic node.
 * @param {string} capability - Failure capability description.
 * @returns {number} Checked size.
 */
function checkedSize(value, node, capability) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) unsupportedCapability("wasm", capability, node.location)

  return value
}

/**
 * Encodes an unsigned u32 LEB128 value.
 * @param {number} value - Unsigned value.
 * @returns {number[]} Encoded bytes.
 */
function u32(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError("Unsigned WebAssembly integer is outside u32.")
  const bytes = []
  let remaining = value

  do {
    let byte = remaining % 128

    remaining = Math.floor(remaining / 128)
    if (remaining != 0) byte |= 0x80
    bytes.push(byte)
  } while (remaining != 0)

  return bytes
}

/**
 * Encodes a signed i32 LEB128 value.
 * @param {number} value - Signed value.
 * @returns {number[]} Encoded bytes.
 */
function s32(value) { return s64(BigInt(value)) }

/**
 * Encodes a signed i64 LEB128 value.
 * @param {bigint} value - Signed value.
 * @returns {number[]} Encoded bytes.
 */
function s64(value) {
  const bytes = []
  let remaining = value
  let done = false

  while (!done) {
    let byte = Number(remaining & 0x7fn)

    remaining >>= 7n
    const signSet = (byte & 0x40) != 0

    done = remaining == 0n && !signSet || remaining == -1n && signSet
    if (!done) byte |= 0x80
    bytes.push(byte)
  }

  return bytes
}

/**
 * Encodes a length-prefixed UTF-8 Wasm name.
 * @param {string} value - Name value.
 * @returns {number[]} Encoded bytes.
 */
function nameBytes(value) {
  const bytes = encoder.encode(value)

  return [...u32(bytes.byteLength), ...bytes]
}

/**
 * Extracts contextual related origins from one semantic record.
 * @param {SemanticNodeProvenance} record - Semantic provenance record.
 * @param {import("../semantic/types.js").SemanticOrigin} [origin] - Optional exact semantic origin.
 * @returns {import("../semantic/types.js").RelatedOrigin[]} Related origins.
 */
function relatedOrigins(record, origin = record.origin) {
  if (origin.kind == "source") {
    return [{location: origin.location, nodeId: record.id, role: "related semantic occurrence", sourceId: origin.sourceId,
      ...(record.symbolId ? {symbolId: record.symbolId} : {})}]
  }
  const origins = origin.kind == "derived" ? origin.origins : origin.relatedOrigins

  return origins.map((origin) => ({...origin, nodeId: origin.nodeId ?? record.id, role: origin.role ?? "related semantic occurrence",
    ...(record.symbolId && !origin.symbolId ? {symbolId: record.symbolId} : {})}))
}

/**
 * Resolves a parser-owned token role to its canonical source identity.
 * @param {ReturnType<typeof createGenerationIndex>} index - Canonical provenance index.
 * @param {SemanticNodeProvenance} record - Semantic occurrence record.
 * @param {string} role - Parser-owned token role.
 * @returns {import("../semantic/types.js").SemanticOrigin} Exact role origin, or the occurrence origin when unavailable.
 */
function originForRole(index, record, role) {
  const location = record.ranges[role]

  if (!location) return record.origin
  /** @type {string | undefined} */
  let fallbackSourceId

  if (record.origin.kind == "source" && record.origin.location.filename == location.filename) fallbackSourceId = record.origin.sourceId
  else if (record.origin.kind == "derived") {
    fallbackSourceId = record.origin.origins.find((origin) => origin.location.filename == location.filename)?.sourceId
  } else if (record.origin.kind == "synthetic") {
    fallbackSourceId = record.origin.relatedOrigins.find((origin) => origin.location.filename == location.filename)?.sourceId
  }
  const source = index.provenance.sources.find((candidate) => candidate.id == fallbackSourceId) ??
    index.provenance.sources.find((candidate) => candidate.filename == location.filename)

  return source ? {kind: "source", location, sourceId: source.id} : record.origin
}

/**
 * Projects byte provenance to the Wasm Source Map v3 convention.
 * @param {import("../semantic/types.js").SemantifoldByteMapping} mapping - Authoritative byte mapping.
 * @param {import("../semantic/types.js").SemanticProvenance} provenance - Source registry.
 * @returns {import("@jridgewell/gen-mapping").EncodedSourceMap} Source Map v3 projection.
 */
function createWasmSourceMap(mapping, provenance) {
  const generated = new GenMapping({file: mapping.generated.path})
  const sourcesById = new Map(provenance.sources.map((source) => [source.id, source]))
  const symbolsById = new Map(provenance.symbols.map((symbol) => [symbol.id, symbol]))

  for (const source of provenance.sources) setSourceContent(generated, source.filename, source.content)
  for (const range of mapping.ranges) {
    const location = primaryLocation(range.origin)

    if (!location || range.origin.kind == "synthetic") {
      maybeAddSegment(generated, 0, range.generated.start)
      continue
    }
    const sourceId = range.origin.kind == "source" ? range.origin.sourceId : range.origin.origins[0]?.sourceId
    const source = sourceId ? sourcesById.get(sourceId) : undefined

    if (!source) throw new Error("Validated Wasm byte origin omitted its registered source.")
    if (range.symbolId === undefined) {
      addSegment(generated, 0, range.generated.start, source.filename, location.start.line - 1, location.start.column - 1,
        null, source.content)
    } else {
      const symbol = symbolsById.get(range.symbolId)

      if (!symbol) throw new Error("Validated Wasm byte range omitted its semantic symbol.")
      addSegment(generated, 0, range.generated.start, source.filename, location.start.line - 1, location.start.column - 1,
        symbol.name, source.content)
    }
  }

  return toEncodedMap(generated)
}

/**
 * Creates one mapped generated text artifact.
 * @param {string} content - Complete artifact content.
 * @param {string} path - Artifact path.
 * @param {import("../semantic/types.js").GeneratedTextLanguage} language - Generated text syntax.
 * @param {import("../semantic/types.js").GeneratedArtifactRole} role - Artifact role.
 * @param {SemanticModule} module - Source semantic module.
 * @param {{filename: string, content: string, language?: import("../semantic/types.js").SemanticLanguage}[] | undefined} sources - Source overrides.
 * @param {string} reason - Synthetic mapping reason.
 * @returns {import("../semantic/types.js").GeneratedSetArtifact} Generated artifact.
 */
function textArtifact(content, path, language, role, module, sources, reason) {
  const writer = new SourceWriter({filename: path, language, module, sources})

  writer.synthetic(content, reason, [module], [""])
  const mapping = finalizeMapping(writer.finish())

  return {
    content,
    contentKind: "text",
    mediaType: path.endsWith(".html") ? "text/html" : "text/javascript",
    ownership: "generated",
    path,
    provenance: {kind: "text", mapping, sourceMap: toSourceMapV3(mapping)},
    role
  }
}

const semantifoldLoader = `const expectedImports = [
  ["semantifold", "print_i64", ["i64"], []],
  ["semantifold", "print_bool", ["i32"], []],
  ["semantifold", "print_string", ["i32", "i32"], []]
]

export class SemantifoldBrowserError extends Error {
  constructor(stage, message, cause) {
    super(message, cause instanceof Error ? {cause} : undefined)
    this.name = "SemantifoldBrowserError"
    this.stage = stage
  }
}

export async function loadSemantifold(url, {fetch: fetchImplementation = globalThis.fetch, sink, timeoutMs = 10000} = {}) {
  if (typeof fetchImplementation != "function") throw new TypeError("A fetch implementation is required.")
  if (typeof sink != "function") throw new TypeError("A text sink function is required.")
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) {
    throw new TypeError("timeoutMs must be an integer from 1 through 2147483647.")
  }
  const controller = new AbortController()
  let timedOut = false
  let timeout
  const deadline = new Promise((resolve, reject) => {
    const timeoutCause = new Error("Semantifold browser load timed out.")

    timeout = setTimeout(() => {
      timedOut = true
      controller.abort(timeoutCause)
      reject(new SemantifoldBrowserError("timeout", "Wasm loading timed out.", timeoutCause))
    }, timeoutMs)
  })
  const beforeDeadline = (operation) => Promise.race([operation, deadline])
  const timeoutFailure = (cause) => new SemantifoldBrowserError("timeout", "Wasm loading timed out.",
    cause instanceof Error ? cause : controller.signal.reason)
  const bodyFailure = (cause) => {
    if (cause instanceof SemantifoldBrowserError) return cause
    if (timedOut) return timeoutFailure(cause)
    return new SemantifoldBrowserError("fetch/MIME", "Wasm response body could not be read.", cause)
  }
  const instantiationFailure = (cause) => {
    if (cause instanceof SemantifoldBrowserError) return cause
    if (timedOut) return timeoutFailure(cause)
    const stage = cause instanceof WebAssembly.CompileError ? "compile" : "instantiate/import"

    return new SemantifoldBrowserError(stage, \`Wasm \${stage} failed.\`, cause)
  }
  const readBody = async (body) => {
    try {
      return new Uint8Array(await beforeDeadline(body.arrayBuffer()))
    } catch (cause) {
      throw bodyFailure(cause)
    }
  }
  const instantiate = async (operation) => {
    try {
      return await beforeDeadline(operation())
    } catch (cause) {
      throw instantiationFailure(cause)
    }
  }
  let response

  try {
    response = await beforeDeadline(Promise.resolve().then(() =>
      fetchImplementation(url, {credentials: "same-origin", redirect: "error", signal: controller.signal})))
  } catch (cause) {
    clearTimeout(timeout)
    if (cause instanceof SemantifoldBrowserError) throw cause
    const stage = timedOut ? "timeout" : "fetch/MIME"
    throw new SemantifoldBrowserError(stage, stage == "timeout" ? "Wasm loading timed out." : "Wasm fetch failed.", cause)
  }
  if (!response.ok) {
    clearTimeout(timeout)
    throw new SemantifoldBrowserError("fetch/MIME", \`Wasm fetch returned HTTP \${response.status}.\`)
  }
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()

  if (mediaType != "application/wasm") {
    clearTimeout(timeout)
    throw new SemantifoldBrowserError("fetch/MIME", "Wasm response requires application/wasm.")
  }

  let instance
  let module
  const decoder = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true})
  let memory
  let abiApproved = false
  const requireApprovedAbi = () => {
    if (!abiApproved) throw new SemantifoldBrowserError("instantiate/import", "Wasm host imports are locked until ABI inspection succeeds.")
  }
  const append = (text) => sink(\`\${text}\\n\`)
  const imports = {semantifold: {
    print_i64(value) {
      requireApprovedAbi()
      if (typeof value != "bigint") throw new TypeError("print_i64 requires bigint.")
      append(value.toString(10))
    },
    print_bool(value) {
      requireApprovedAbi()
      if (value !== 0 && value !== 1) throw new TypeError("print_bool requires canonical 0 or 1.")
      append(value === 1 ? "true" : "false")
    },
    print_string(pointer, length) {
      requireApprovedAbi()
      if (!memory || !Number.isInteger(pointer) || pointer < 0 || !Number.isInteger(length) || length < 0) {
        const cause = new TypeError("print_string requires a non-negative integer pointer and length.")

        throw new SemantifoldBrowserError("memory bounds/UTF-8", cause.message, cause)
      }
      const end = pointer + length

      if (!Number.isSafeInteger(end) || end < pointer || end > memory.buffer.byteLength) {
        const cause = new RangeError("print_string range is outside exported memory.")

        throw new SemantifoldBrowserError("memory bounds/UTF-8", cause.message, cause)
      }
      let text

      try {
        text = decoder.decode(new Uint8Array(memory.buffer, pointer, length))
      } catch (cause) {
        throw new SemantifoldBrowserError("memory bounds/UTF-8", "print_string bytes are not valid UTF-8.", cause)
      }
      append(text)
    }
  }}

  let result

  try {
    if (typeof WebAssembly.instantiateStreaming == "function") {
      let body

      try {
        body = response.clone()
      } catch (cause) {
        throw bodyFailure(cause)
      }
      const pending = instantiate(() => WebAssembly.instantiateStreaming(response, imports))
        .then((value) => ({value}), (error) => ({error}))
      const bytes = await readBody(body)

      inspectAbi(bytes)
      abiApproved = true
      const settled = await pending

      if ("error" in settled) throw settled.error
      result = settled.value
    } else {
      const bytes = await readBody(response)

      inspectAbi(bytes)
      abiApproved = true
      result = await instantiate(() => WebAssembly.instantiate(bytes, imports))
    }
  } catch (error) {
    clearTimeout(timeout)
    throw error
  }
  clearTimeout(timeout)
  instance = result.instance
  module = result.module
  validateModuleShape(module, instance)
  memory = instance.exports.memory
  let active = false
  let poisoned = false

  return Object.freeze({
    memory,
    run() {
      if (poisoned) throw new SemantifoldBrowserError("invocation/trap", "Wasm instance is poisoned after a trap.")
      if (active) throw new SemantifoldBrowserError("invocation/trap", "Reentrant run invocation is forbidden.")
      active = true
      try {
        instance.exports.run()
      } catch (cause) {
        poisoned = true
        if (cause instanceof SemantifoldBrowserError) throw cause
        throw new SemantifoldBrowserError("invocation/trap", "Wasm run trapped.", cause)
      } finally {
        active = false
      }
    }
  })
}

function validateModuleShape(module, instance) {
  const imports = WebAssembly.Module.imports(module)
  const exports = WebAssembly.Module.exports(module)

  if (JSON.stringify(imports.map(({kind, module, name}) => [module, name, kind])) !=
    JSON.stringify(expectedImports.map(([module, name]) => [module, name, "function"]))) {
    throw new SemantifoldBrowserError("instantiate/import", "Wasm imports do not match semantifold.browser.v1.")
  }
  if (JSON.stringify(exports.map(({kind, name}) => [name, kind])) != JSON.stringify([["memory", "memory"], ["run", "function"]]) ||
    !(instance.exports.memory instanceof WebAssembly.Memory) || typeof instance.exports.run != "function" || instance.exports.run.length != 0) {
    throw new SemantifoldBrowserError("instantiate/import", "Wasm exports do not match semantifold.browser.v1.")
  }
}

function inspectAbi(bytes) {
  try {
    let offset = 8
    const types = []
    const importedTypes = []
    const definedTypes = []
    const exports = []
    const memories = []

    if (bytes.length < 8 || bytes[0] != 0 || bytes[1] != 97 || bytes[2] != 115 || bytes[3] != 109 || bytes[4] != 1 ||
      bytes[5] != 0 || bytes[6] != 0 || bytes[7] != 0) throw new WebAssembly.CompileError("Invalid Wasm header.")
    while (offset < bytes.length) {
      const id = bytes[offset++]
      const sizeValue = readU32(bytes, offset)
      offset = sizeValue.next
      const end = offset + sizeValue.value

      if (end > bytes.length) throw new WebAssembly.CompileError("Truncated Wasm section.")
      if (id == 1) {
        const count = readU32(bytes, offset); offset = count.next
        for (let index = 0; index < count.value; index += 1) {
          if (bytes[offset++] != 0x60) throw new WebAssembly.CompileError("Invalid function type.")
          const parameters = readTypes(bytes, offset); offset = parameters.next
          const results = readTypes(bytes, offset); offset = results.next
          types.push([parameters.values, results.values])
        }
      } else if (id == 2) {
        const count = readU32(bytes, offset); offset = count.next
        for (let index = 0; index < count.value; index += 1) {
          const moduleName = readName(bytes, offset); offset = moduleName.next
          const fieldName = readName(bytes, offset); offset = fieldName.next
          if (bytes[offset++] != 0) throw new SemantifoldBrowserError("instantiate/import", "Only function imports are allowed.")
          const type = readU32(bytes, offset); offset = type.next
          importedTypes.push([moduleName.value, fieldName.value, type.value])
        }
      } else if (id == 3) {
        const count = readU32(bytes, offset); offset = count.next
        for (let index = 0; index < count.value; index += 1) {
          const type = readU32(bytes, offset); offset = type.next; definedTypes.push(type.value)
        }
      } else if (id == 5) {
        const count = readU32(bytes, offset); offset = count.next
        for (let index = 0; index < count.value; index += 1) {
          const flags = bytes[offset++]
          const minimum = readU32(bytes, offset); offset = minimum.next
          let maximum
          if ((flags & 1) != 0) { maximum = readU32(bytes, offset); offset = maximum.next }
          memories.push([flags, minimum.value, maximum?.value])
        }
      } else if (id == 7) {
        const count = readU32(bytes, offset); offset = count.next
        for (let index = 0; index < count.value; index += 1) {
          const name = readName(bytes, offset); offset = name.next
          const kind = bytes[offset++]
          const target = readU32(bytes, offset); offset = target.next
          exports.push([name.value, kind, target.value])
        }
      } else if (id == 8) throw new SemantifoldBrowserError("instantiate/import", "A Wasm start section is forbidden.")
      offset = end
    }
    if (importedTypes.length != expectedImports.length) throw new SemantifoldBrowserError("instantiate/import", "Unexpected Wasm import count.")
    for (let index = 0; index < expectedImports.length; index += 1) {
      const expected = expectedImports[index]
      const actual = importedTypes[index]
      const type = types[actual?.[2]]

      if (!actual || actual[0] != expected[0] || actual[1] != expected[1] || !type ||
        JSON.stringify(type) != JSON.stringify([expected[2], expected[3]])) {
        throw new SemantifoldBrowserError("instantiate/import", "Wasm import signature does not match semantifold.browser.v1.")
      }
    }
    if (memories.length != 1 || memories[0][0] != 1 || memories[0][1] != memories[0][2]) {
      throw new SemantifoldBrowserError("instantiate/import", "Wasm memory must have equal fixed initial and maximum limits.")
    }
    if (exports.length != 2 || exports[0][0] != "memory" || exports[0][1] != 2 || exports[0][2] != 0 ||
      exports[1][0] != "run" || exports[1][1] != 0) {
      throw new SemantifoldBrowserError("instantiate/import", "Wasm exports do not match semantifold.browser.v1.")
    }
    const runType = types[definedTypes[exports[1][2] - importedTypes.length]]

    if (!runType || runType[0].length != 0 || runType[1].length != 0) {
      throw new SemantifoldBrowserError("instantiate/import", "Wasm run signature does not match semantifold.browser.v1.")
    }
  } catch (cause) {
    if (cause instanceof SemantifoldBrowserError) throw cause
    throw new SemantifoldBrowserError("compile", "Wasm binary inspection failed.", cause)
  }
}

function readTypes(bytes, offset) {
  const count = readU32(bytes, offset); offset = count.next; const values = []
  for (let index = 0; index < count.value; index += 1) {
    const type = bytes[offset++]
    if (type == 0x7f) values.push("i32")
    else if (type == 0x7e) values.push("i64")
    else if (type == 0x7d) values.push("f32")
    else if (type == 0x7c) values.push("f64")
    else if (type == 0x7b) values.push("v128")
    else if (type == 0x70) values.push("funcref")
    else if (type == 0x6f) values.push("externref")
    else throw new WebAssembly.CompileError("Unsupported ABI value type.")
  }
  return {next: offset, values}
}

function readName(bytes, offset) {
  const length = readU32(bytes, offset); const end = length.next + length.value
  if (end > bytes.length) throw new WebAssembly.CompileError("Truncated Wasm name.")
  return {next: end, value: new TextDecoder("utf-8", {fatal: true}).decode(bytes.subarray(length.next, end))}
}

function readU32(bytes, offset) {
  let value = 0
  let shift = 0
  for (let index = 0; index < 5; index += 1) {
    if (offset >= bytes.length) throw new WebAssembly.CompileError("Truncated unsigned LEB128.")
    const byte = bytes[offset++]
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) == 0) return {next: offset, value}
    shift += 7
  }
  throw new WebAssembly.CompileError("Oversized unsigned LEB128.")
}

async function runBrowserHarness() {
  const output = document.querySelector("#output")

  try {
    const program = await loadSemantifold("./program.wasm", {sink: (line) => { output.textContent += line }})
    program.run()
    document.documentElement.dataset.semantifoldOutput = [...new TextEncoder().encode(output.textContent)]
      .map((byte) => byte.toString(16).padStart(2, "0")).join("")
    document.documentElement.dataset.semantifold = "pass"
    console.log("SEMANTIFOLD_BROWSER_OK")
  } catch (error) {
    document.documentElement.dataset.semantifold = "fail"
    output.textContent += \`ERROR[\${error.stage ?? "unknown"}]: \${error.message}\\n\`
    console.error("SEMANTIFOLD_BROWSER_FAILED", error)
  }
}

if (typeof document != "undefined" && document.documentElement.dataset.semantifold == "pending") void runBrowserHarness()
`

const browserHarness = `<!doctype html>
<html lang="en" data-semantifold="pending">
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; base-uri 'none'; form-action 'none'">
<title>Semantifold Browser Wasm</title>
<pre id="output"></pre>
<script type="module" src="./semantifold-loader.mjs"></script>
</html>
`
