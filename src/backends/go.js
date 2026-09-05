// @ts-check

import {unsupportedCapability} from "../diagnostic.js"
import {finalizeMapping, toSourceMapV3} from "../mapping.js"
import {validateBackendModule, emitExpression} from "./shared.js"
import {emitScalarType} from "./scalars.js"
import {SourceWriter} from "./writer.js"

const manifest = "module example.com/semantifold/generated\n\ngo 1.26.0\n"
const binarySyntax = Object.freeze({
  BooleanAnd: "&&", BooleanEqual: "==", BooleanNotEqual: "!=", BooleanOr: "||",
  IntegerAdd: "+", IntegerEqual: "==", IntegerGreaterThan: ">", IntegerGreaterThanOrEqual: ">=",
  IntegerLessThan: "<", IntegerLessThanOrEqual: "<=", IntegerMultiply: "*", IntegerNotEqual: "!=",
  IntegerSubtract: "-", StringConcat: "+", StringEqual: "==", StringNotEqual: "!="
})

/**
 * Emits one deterministic manifest-first Go module candidate.
 * @param {{filename?: string, mapDirective?: unknown, module: import("../semantic/types.js").SemanticModule, sourceMapFilename?: unknown, sources?: {filename: string, content: string, language?: import("../semantic/types.js").SemanticLanguage}[]}} input Backend request.
 * @returns {{artifacts: import("../semantic/types.js").GeneratedSetArtifact[], target: string}} Candidate artifact set.
 */
export function generateGoModule({filename, mapDirective, module, sourceMapFilename, sources}) {
  validateBackendModule(module, "go")
  if (filename !== undefined && filename != "main.go") {
    unsupportedCapability("go", "artifact filename other than main.go", module.location)
  }
  if (mapDirective !== undefined || sourceMapFilename !== undefined) {
    unsupportedCapability("go", "source-map filename or directive option", module.location)
  }
  validateRoundTripMutability(module)
  const writer = new SourceWriter({filename: "main.go", language: "go", module, sources})

  emitProgram(module, writer)
  const mapping = finalizeMapping(writer.finish())
  const root = mapping.nodes.find(({path}) => path == "")

  if (!root) throw new Error("Validated Go module omitted its canonical root provenance.")
  return {
    artifacts: [{
      content: manifest,
      contentKind: "text",
      mediaType: "text/plain",
      ownership: "generated",
      path: "go.mod",
      provenance: {
        kind: "synthetic",
        reason: "Fixed example.com/semantifold/generated module identity and Go 1.26.0 configuration.",
        relatedOrigins: relatedRootOrigins(root)
      },
      role: "manifest"
    }, {
      content: mapping.generated.content,
      contentKind: "text",
      mediaType: "text/x-go",
      ownership: "generated",
      path: "main.go",
      provenance: {kind: "text", mapping, sourceMap: toSourceMapV3(mapping)},
      role: "entry"
    }],
    target: "go"
  }
}

/**
 * Validates assignment-derived mutability before writer construction.
 * @param {import("../semantic/types.js").SemanticModule} module Semantic module.
 * @returns {void}
 */
function validateRoundTripMutability(module) {
  for (const root of [...module.functions.map(({body}) => body), module.entryPoint.body]) {
    const assigned = new Set()

    visitStatements(root, (statement) => {
      if (statement.kind == "AssignmentStatement") assigned.add(statement.target.name)
    })
    visitStatements(root, (statement) => {
      if (statement.kind == "LocalDeclaration" && statement.mutable && !assigned.has(statement.name)) {
        unsupportedCapability("go", "mutable local without a later syntactic assignment", statement.location)
      }
    })
  }
}

/**
 * Visits nested statements in semantic order.
 * @param {import("../semantic/types.js").Block} block Semantic block.
 * @param {(statement: import("../semantic/types.js").Statement) => void} callback Visitor.
 * @returns {void}
 */
function visitStatements(block, callback) {
  for (const statement of block.statements) {
    callback(statement)
    if (statement.kind == "IfStatement") {
      visitStatements(statement.consequent, callback)
      if (statement.alternate) visitStatements(statement.alternate, callback)
    }
  }
}

/**
 * Reports whether any print statement requires fmt.
 * @param {import("../semantic/types.js").SemanticModule} module Semantic module.
 * @returns {boolean} Print presence.
 */
function hasPrint(module) {
  let found = false

  for (const root of [...module.functions.map(({body}) => body), module.entryPoint.body]) {
    visitStatements(root, (statement) => {
      if (statement.kind == "PrintStatement") found = true
    })
  }
  return found
}

/**
 * Emits the fixed Go file scaffold and semantic bodies.
 * @param {import("../semantic/types.js").SemanticModule} module Semantic module.
 * @param {SourceWriter} writer Source-aware writer.
 * @returns {void}
 */
function emitProgram(module, writer) {
  writer.synthetic("package main\n", "Go package scaffold", [module])
  if (hasPrint(module)) writer.synthetic('\nimport "fmt"\n', "Go fmt print scaffold", [module])
  module.functions.forEach((declaration, index) => {
    writer.synthetic("\n", "declaration separator", [declaration])
    emitFunction(writer, declaration, index)
  })
  writer.synthetic("\n", "entry-point separator", [module.entryPoint])
  writer.mapped("func main", {mappingKind: "anchor", node: module.entryPoint, path: "/entryPoint"})
  writer.mapped("()", {mappingKind: "anchor", node: module.entryPoint, path: "/entryPoint"})
  writer.synthetic(" ", "entry-point spacing", [module.entryPoint], ["/entryPoint"])
  writer.mapped("{", {mappingKind: "anchor", node: module.entryPoint.body, path: "/entryPoint/body"})
  writer.synthetic("\n", "line break", [module.entryPoint], ["/entryPoint"])
  emitBlock(writer, module.entryPoint.body, "\t", "/entryPoint/body")
  writer.mapped("}", {mappingKind: "anchor", node: module.entryPoint, path: "/entryPoint"})
  writer.synthetic("\n", "line break", [module.entryPoint], ["/entryPoint"])
}

/**
 * Emits one semantic function.
 * @param {SourceWriter} writer Source-aware writer.
 * @param {import("../semantic/types.js").FunctionDeclaration} declaration Function declaration.
 * @param {number} index Function index.
 * @returns {void}
 */
function emitFunction(writer, declaration, index) {
  const path = "/functions/" + index

  writer.mapped("func", {mappingKind: "anchor", node: declaration, path})
  writer.synthetic(" ", "function spacing", [declaration], [path])
  writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, path, role: "name"})
  writer.mapped("(", {mappingKind: "anchor", node: declaration, path})
  declaration.parameters.forEach((parameter, parameterIndex) => {
    const parameterPath = path + "/parameters/" + parameterIndex

    if (parameterIndex > 0) writer.synthetic(", ", "parameter separator", [declaration], [path])
    writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
    writer.synthetic(" ", "parameter spacing", [parameter], [parameterPath])
    writer.mapped(emitScalarType("go", parameter.type), {
      mappingKind: "exact", node: parameter.type, path: parameterPath + "/type", role: "type"
    })
  })
  writer.mapped(")", {mappingKind: "anchor", node: declaration, path})
  writer.synthetic(" ", "result spacing", [declaration], [path])
  writer.mapped(emitScalarType("go", declaration.returnType), {
    mappingKind: "exact", node: declaration.returnType, path: path + "/returnType", role: "type"
  })
  writer.synthetic(" ", "body spacing", [declaration], [path])
  writer.mapped("{", {mappingKind: "anchor", node: declaration.body, path: path + "/body"})
  writer.synthetic("\n", "line break", [declaration], [path])
  emitBlock(writer, declaration.body, "\t", path + "/body")
  writer.mapped("}", {mappingKind: "anchor", node: declaration, path})
  writer.synthetic("\n", "line break", [declaration], [path])
}

/**
 * Emits an ordered block.
 * @param {SourceWriter} writer Source-aware writer.
 * @param {import("../semantic/types.js").Block} block Semantic block.
 * @param {string} indent Current indentation.
 * @param {string} path Semantic path.
 * @returns {void}
 */
function emitBlock(writer, block, indent, path) {
  block.statements.forEach((statement, index) => emitStatement(writer, statement, indent, path + "/statements/" + index))
}

/**
 * Emits one supported statement.
 * @param {SourceWriter} writer Source-aware writer.
 * @param {import("../semantic/types.js").Statement} statement Semantic statement.
 * @param {string} indent Current indentation.
 * @param {string} path Semantic path.
 * @returns {void}
 */
function emitStatement(writer, statement, indent, path) {
  if (statement.kind == "LocalDeclaration" || statement.kind == "AssignmentStatement") {
    return emitLocal(writer, statement, indent, path)
  }
  if (statement.kind == "IfStatement") return emitIf(writer, statement, indent, path, true)
  writer.synthetic(indent, "indentation", [statement], [path])
  if (statement.kind == "ReturnStatement") {
    writer.mapped("return", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "return spacing", [statement], [path])
    emitExpression(writer, statement.expression, path + "/expression", "go", identity)
  } else {
    writer.mapped("fmt.Println", {mappingKind: "anchor", node: statement, path})
    writer.mapped("(", {mappingKind: "anchor", node: statement, path})
    emitExpression(writer, statement.expression, path + "/expression", "go", identity)
    writer.mapped(")", {mappingKind: "anchor", node: statement, path})
  }
  writer.synthetic("\n", "line break", [statement], [path])
}

/**
 * Emits a conditional, using direct else-if for the canonical nested shape.
 * @param {SourceWriter} writer Source-aware writer.
 * @param {import("../semantic/types.js").IfStatement} statement Conditional.
 * @param {string} indent Current indentation.
 * @param {string} path Semantic path.
 * @param {boolean} includeIndent Whether to emit leading indentation.
 * @returns {void}
 */
function emitIf(writer, statement, indent, path, includeIndent) {
  if (includeIndent) writer.synthetic(indent, "indentation", [statement], [path])
  writer.mapped("if", {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  emitCondition(writer, statement.condition, path + "/condition")
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  writer.mapped("{", {mappingKind: "anchor", node: statement.consequent, path: path + "/consequent"})
  writer.synthetic("\n", "line break", [statement], [path])
  emitBlock(writer, statement.consequent, indent + "\t", path + "/consequent")
  writer.synthetic(indent, "indentation", [statement], [path])
  writer.mapped("}", {mappingKind: "anchor", node: statement.consequent, path: path + "/consequent"})
  if (statement.alternate) {
    writer.synthetic(" ", "alternate spacing", [statement], [path])
    writer.mapped("else", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "alternate spacing", [statement], [path])
    const nested = statement.alternate.statements.length == 1 && statement.alternate.statements[0].kind == "IfStatement"

    if (nested) {
      emitIf(writer, /** @type {import("../semantic/types.js").IfStatement} */ (statement.alternate.statements[0]),
        indent, path + "/alternate/statements/0", false)
      return
    }
    writer.mapped("{", {mappingKind: "anchor", node: statement.alternate, path: path + "/alternate"})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.alternate, indent + "\t", path + "/alternate")
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.alternate, path: path + "/alternate"})
  }
  writer.synthetic("\n", "line break", [statement], [path])
}

/**
 * Emits a condition without the one redundant outer pair removed by gofmt.
 * Child operations stay parenthesized so the semantic tree round-trips exactly.
 * @param {SourceWriter} writer Source-aware writer.
 * @param {import("../semantic/types.js").Expression} expression Condition expression.
 * @param {string} path Semantic path.
 * @returns {void}
 */
function emitCondition(writer, expression, path) {
  if (expression.kind == "BinaryExpression") {
    emitExpression(writer, expression.left, path + "/left", "go", identity)
    writer.synthetic(" ", "operator spacing", [expression], [path])
    writer.mapped(binarySyntax[expression.operation], {mappingKind: "exact", node: expression, path, role: "operator"})
    writer.synthetic(" ", "operator spacing", [expression], [path])
    emitExpression(writer, expression.right, path + "/right", "go", identity)
    return
  }
  if (expression.kind == "UnaryExpression") {
    writer.mapped(expression.operation == "BooleanNot" ? "!" : "-", {
      mappingKind: "exact", node: expression, path, role: "operator"
    })
    emitExpression(writer, expression.operand, path + "/operand", "go", identity)
    return
  }
  emitExpression(writer, expression, path, "go", identity)
}

/**
 * Emits a local declaration or assignment.
 * @param {SourceWriter} writer Source-aware writer.
 * @param {import("../semantic/types.js").LocalStatement} statement Local statement.
 * @param {string} indent Current indentation.
 * @param {string} path Semantic path.
 * @returns {void}
 */
function emitLocal(writer, statement, indent, path) {
  if (statement.kind == "LocalDeclaration" && !statement.mutable) {
    writer.synthetic(indent + "// @semantifold-immutable\n", "Go immutable-local carrier", [statement], [path])
  }
  writer.synthetic(indent, "indentation", [statement], [path])
  if (statement.kind == "AssignmentStatement") {
    writer.mapped(statement.target.name, {mappingKind: "exact", node: statement.target, path: path + "/target", role: "name"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    writer.mapped("=", {mappingKind: "exact", node: statement, path, role: "operator"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    emitExpression(writer, statement.expression, path + "/expression", "go", identity)
  } else {
    writer.mapped("var", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "declaration spacing", [statement], [path])
    writer.mapped(statement.name, {mappingKind: "exact", node: statement, path, role: "name"})
    writer.synthetic(" ", "declaration spacing", [statement], [path])
    writer.mapped(emitScalarType("go", statement.type), {
      mappingKind: "exact", node: statement.type, path: path + "/type", role: "type"
    })
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    writer.mapped("=", {mappingKind: "exact", node: statement, path, role: "operator"})
    writer.synthetic(" ", "assignment spacing", [statement], [path])
    emitExpression(writer, statement.initializer, path + "/initializer", "go", identity)
  }
  writer.synthetic("\n", "line break", [statement], [path])
}

/**
 * Converts root provenance to artifact-level related origins.
 * @param {import("../semantic/types.js").SemanticNodeProvenance} root Root provenance.
 * @returns {import("../semantic/types.js").RelatedOrigin[]} Related roots.
 */
function relatedRootOrigins(root) {
  if (root.origin.kind == "source") {
    return [{location: root.origin.location, nodeId: root.id, role: "module", sourceId: root.origin.sourceId}]
  }
  const origins = root.origin.kind == "derived" ? root.origin.origins : root.origin.relatedOrigins

  return origins.map((origin) => ({...origin, nodeId: origin.nodeId ?? root.id, role: origin.role ?? "module"}))
}

/**
 * Preserves an already validated Go identifier.
 * @param {string} name Identifier.
 * @returns {string} Unchanged spelling.
 */
function identity(name) {
  return name
}
