// @ts-check

import PhpParser from "php-parser"
import {parse as parseComment} from "comment-parser"
import {missingType, parseFailure, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation} from "../semantic/location.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {requireSourceScalarType} from "./scalars.js"
const parser = new PhpParser.Engine({
  ast: {withPositions: true},
  parser: {extractDoc: true, suppressErrors: false}
})

/**
 * Returns a normalized PHP node location.
 * @param {import("php-parser").Node} node - PHP parser node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Source location.
 */
function nodeLocation(node, filename, source) {
  if (!node.loc) throw new Error(`PHP parser omitted source location for ${node.kind}.`)

  return locationFromOffsets(filename, source, node.loc.start.offset, node.loc.end.offset)
}

/**
 * Converts a supported PHP expression.
 * @param {import("php-parser").Expression} node - PHP expression.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").Expression} Semantic expression.
 */
function convertExpression(node, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.kind == "variable") {
    const variable = /** @type {import("php-parser").Variable} */ (node)

    if (typeof variable.name != "string") return unsupportedSyntax("php", "dynamic variable", location)

    return {kind: "IdentifierExpression", location, name: variable.name}
  }

  if (node.kind == "number") {
    const literal = /** @type {import("php-parser").Number} */ (node)
    const value = Number(literal.value)

    if (!Number.isSafeInteger(value)) return unsupportedSyntax("php", "non-safe integer literal", location)

    return {kind: "IntegerLiteral", location, value}
  }

  if (node.kind == "boolean") {
    const literal = /** @type {import("php-parser").Boolean} */ (node)

    if (typeof literal.value != "boolean") return unsupportedSyntax("php", "invalid boolean literal value", location)

    return {kind: "BooleanLiteral", location, value: literal.value}
  }

  if (node.kind == "string") {
    const literal = /** @type {import("php-parser").String} */ (node)

    if (typeof literal.raw == "string" && literal.raw.startsWith("<<<")) {
      const detail = literal.raw.startsWith("<<<'") ? "nowdoc string" : "heredoc string"

      return unsupportedSyntax("php", detail, location)
    }
    if (typeof literal.raw == "string" && ["b\"", "B\"", "b'", "B'"].some((prefix) => literal.raw.startsWith(prefix))) {
      return unsupportedSyntax("php", "binary string literal", location)
    }
    if (typeof literal.value != "string" || !hasOnlyUnicodeScalars(literal.value)) {
      return unsupportedSyntax("php", "invalid Unicode string literal", location)
    }

    return {kind: "StringLiteral", location, value: literal.value}
  }

  if (node.kind == "encapsed") {
    const literal = /** @type {import("php-parser").Encapsed} */ (node)
    const detail = literal.type == "string" ? "interpolated string" : `${literal.type} string`

    return unsupportedSyntax("php", detail, location)
  }

  if (node.kind == "nowdoc") return unsupportedSyntax("php", "nowdoc string", location)

  if (node.kind == "bin") {
    const binary = /** @type {import("php-parser").Bin} */ (node)

    if (![">", "-", "+"].includes(binary.type)) return unsupportedSyntax("php", `binary ${binary.type}`, location)

    return {
      kind: "BinaryExpression",
      left: convertExpression(binary.left, filename, source),
      location,
      operator: /** @type {">" | "-" | "+"} */ (binary.type),
      right: convertExpression(binary.right, filename, source)
    }
  }

  if (node.kind == "call") {
    const call = /** @type {import("php-parser").Call} */ (node)

    if (call.what.kind != "name" && call.what.kind != "identifier") {
      return unsupportedSyntax("php", "dynamic call", location)
    }

    const callee = /** @type {import("php-parser").Name | import("php-parser").Identifier} */ (call.what).name

    return {
      arguments: call.arguments.map((argument) => convertExpression(argument, filename, source)),
      callee,
      kind: "CallExpression",
      location
    }
  }

  return unsupportedSyntax("php", node.kind, location)
}

/**
 * Converts one explicit PHP return.
 * @param {import("php-parser").Node} node - PHP node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").ReturnStatement} Semantic return.
 */
function convertReturn(node, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.kind != "return") return unsupportedSyntax("php", node.kind, location)

  const returnNode = /** @type {import("php-parser").Return} */ (node)

  if (!returnNode.expr) return unsupportedSyntax("php", "empty return", location)

  return {expression: convertExpression(returnNode.expr, filename, source), kind: "ReturnStatement", location}
}

/**
 * Reads one exact PHP local `@var` carrier and immutability marker.
 * @param {import("php-parser").Node} node - Assignment-owning statement.
 * @param {string} name - Local name.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {{immutable: boolean, type: import("../semantic/types.js").TypeReference} | undefined} Metadata when present.
 */
function localMetadata(node, name, filename, source) {
  const comments = node.leadingComments ?? []
  const comment = comments.at(-1)

  if (!comment || comment.kind != "commentblock" || !comment.loc || !node.loc) return undefined

  const gap = source.slice(comment.loc.end.offset, node.loc.start.offset)

  if (!/^\s*$/u.test(gap) || (gap.match(/\n/gu)?.length ?? 0) > 1) return undefined

  const block = parseComment(comment.value)[0]
  const tags = block?.tags ?? []
  const variables = tags.filter((tag) => tag.tag == "var")
  const immutable = tags.filter((tag) => tag.tag == "semantifold-immutable")
  const location = nodeLocation(node, filename, source)

  if (variables.length == 0 && immutable.length == 0) return undefined

  const exactVariable = variables.length == 1 && variables[0].type == "" && variables[0].description == `$${name}`
  const exactImmutable = immutable.length <= 1 && immutable.every((tag) => tag.name == "" && tag.type == "" && tag.description == "")
  const knownTags = tags.every((tag) => tag.tag == "var" || tag.tag == "semantifold-immutable")

  if (!exactVariable || !exactImmutable || !knownTags) {
    return unsupportedSyntax("php", "malformed local type metadata", location)
  }

  return {
    immutable: immutable.length == 1,
    type: requireSourceScalarType("php", variables[0].name, `Local '${name}'`, location)
  }
}

/**
 * Converts one PHP local declaration or assignment.
 * @param {import("php-parser").Node} node - PHP statement.
 * @param {Set<string>} visible - Names visible during adaptation.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").LocalStatement} Semantic local statement.
 */
function convertLocalStatement(node, visible, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.kind != "expressionstatement") return unsupportedSyntax("php", node.kind, location)

  const expression = /** @type {import("php-parser").ExpressionStatement} */ (node).expression

  if (expression.kind != "assign") return unsupportedSyntax("php", expression.kind, nodeLocation(expression, filename, source))

  const assignment = /** @type {import("php-parser").Assign} */ (expression)

  if (assignment.operator != "=") return unsupportedSyntax("php", `assignment ${assignment.operator}`, location)
  if (assignment.left.kind != "variable") return unsupportedSyntax("php", assignment.left.kind, nodeLocation(assignment.left, filename, source))

  const variable = /** @type {import("php-parser").Variable} */ (assignment.left)
  const targetLocation = nodeLocation(variable, filename, source)

  if (typeof variable.name != "string" || variable.curly) return unsupportedSyntax("php", "dynamic variable", targetLocation)

  const metadata = localMetadata(node, variable.name, filename, source)

  if (metadata) {
    visible.add(variable.name)
    return {
      initializer: convertExpression(assignment.right, filename, source),
      kind: "LocalDeclaration",
      location,
      mutable: !metadata.immutable,
      name: variable.name,
      type: metadata.type
    }
  }

  if (!visible.has(variable.name)) return missingType("php", `Local '${variable.name}'`, location)

  return {
    expression: convertExpression(assignment.right, filename, source),
    kind: "AssignmentStatement",
    location,
    target: {kind: "IdentifierExpression", location: targetLocation, name: variable.name}
  }
}

/**
 * Converts a declaration/assignment prefix followed by one exact PHP terminal.
 * @template {import("../semantic/types.js").IfStatement | import("../semantic/types.js").ReturnStatement | import("../semantic/types.js").PrintStatement} Terminal
 * @param {import("php-parser").Node[]} statements - PHP statements.
 * @param {string} terminalKind - Required parser kind.
 * @param {(node: import("php-parser").Node) => Terminal} convertTerminal - Terminal converter.
 * @param {Set<string>} visible - Visible names.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {(import("../semantic/types.js").LocalStatement | Terminal)[]} Semantic statements.
 */
function convertRestrictedSequence(statements, terminalKind, convertTerminal, visible, filename, source) {
  const terminal = statements.at(-1)

  if (!terminal || terminal.kind != terminalKind) {
    return unsupportedSyntax("php", `statement sequence without ${terminalKind}`, terminal ? nodeLocation(terminal, filename, source) : moduleLocation(filename, source))
  }

  return [
    ...statements.slice(0, -1).map((statement) => convertLocalStatement(statement, visible, filename, source)),
    convertTerminal(terminal)
  ]
}

/**
 * Requires an exact PHP scalar declaration type.
 * @param {import("php-parser").Node | null} sourceType - PHP type node.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} location - Source location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").TypeReference} Semantic type.
 */
function convertType(sourceType, subject, location, filename, source) {
  if (!sourceType) return requireSourceScalarType("php", undefined, subject, location)
  if (sourceType.kind != "typereference" && sourceType.kind != "name" && sourceType.kind != "identifier") {
    return unsupportedSyntax("php", "unsupported scalar type", nodeLocation(sourceType, filename, source))
  }

  const typeName = /** @type {import("php-parser").TypeReference | import("php-parser").Name | import("php-parser").Identifier} */ (sourceType).name

  return requireSourceScalarType("php", typeName, subject, location)
}

/**
 * Converts a PHP function.
 * @param {import("php-parser").Function} node - PHP function node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
 */
function convertFunction(node, filename, source) {
  const location = nodeLocation(node, filename, source)
  const name = typeof node.name == "string" ? node.name : node.name.name

  if (!node.body) {
    return unsupportedSyntax("php", "function body", location)
  }

  const parameters = node.arguments.map((parameter) => {
    const parameterLocation = nodeLocation(parameter, filename, source)
    const parameterName = typeof parameter.name == "string" ? parameter.name : parameter.name.name

    if (parameter.nullable) return unsupportedSyntax("php", "unsupported scalar type", parameterLocation)

    return {
      kind: /** @type {const} */ ("Parameter"),
      location: parameterLocation,
      name: parameterName,
      type: convertType(parameter.type, `Parameter '${parameterName}'`, parameterLocation, filename, source)
    }
  })
  if (node.nullable) return unsupportedSyntax("php", "unsupported scalar type", location)
  const visible = new Set(parameters.map((parameter) => parameter.name))
  const body = convertRestrictedSequence(
    node.body.children,
    "if",
    (statement) => convertIf(/** @type {import("php-parser").If} */ (statement), visible, filename, source),
    visible,
    filename,
    source
  )

  return {
    body: /** @type {import("../semantic/types.js").FunctionStatement[]} */ (body),
    kind: "FunctionDeclaration",
    location,
    name,
    parameters,
    returnType: convertType(node.type, `Function '${name}' return`, location, filename, source)
  }
}

/**
 * Converts the existing PHP if/else terminal with restricted branch prefixes.
 * @param {import("php-parser").If} node - PHP if node.
 * @param {Set<string>} visible - Enclosing visible names.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").IfStatement} Semantic branch.
 */
function convertIf(node, visible, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (!node.alternate || node.alternate.kind != "block") {
    return unsupportedSyntax("php", "if without block else", location)
  }

  const consequentVisible = new Set(visible)
  const alternateVisible = new Set(visible)
  const alternate = /** @type {import("php-parser").Block} */ (node.alternate)

  return {
    alternate: /** @type {(import("../semantic/types.js").LocalStatement | import("../semantic/types.js").ReturnStatement)[]} */ (
      convertRestrictedSequence(alternate.children, "return", (statement) => convertReturn(statement, filename, source), alternateVisible, filename, source)
    ),
    condition: convertExpression(node.test, filename, source),
    consequent: /** @type {(import("../semantic/types.js").LocalStatement | import("../semantic/types.js").ReturnStatement)[]} */ (
      convertRestrictedSequence(node.body.children, "return", (statement) => convertReturn(statement, filename, source), consequentVisible, filename, source)
    ),
    kind: "IfStatement",
    location
  }
}

/**
 * Converts a PHP echo entry point.
 * @param {import("php-parser").Echo} node - PHP echo node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").PrintStatement} Print statement.
 */
function convertPrint(node, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.expressions.length != 2 || node.expressions[1].kind != "name" ||
    /** @type {import("php-parser").Name} */ (node.expressions[1]).name != "PHP_EOL") {
    return unsupportedSyntax("php", "echo without one expression and PHP_EOL", location)
  }

  return {expression: convertExpression(node.expressions[0], filename, source), kind: "PrintStatement", location}
}

/**
 * Parses PHP into the shared semantic module.
 * @param {object} input - Parser input.
 * @param {string} input.filename - Source filename.
 * @param {string} input.source - Source text.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parsePhp({filename, source}) {
  const program = parsePhpProgram(filename, source)
  validateDeclareNodes(program.children, filename, source)
  const functions = program.children.filter((node) => node.kind == "function")
    .map((node) => convertFunction(/** @type {import("php-parser").Function} */ (node), filename, source))
  const executableNodes = program.children.filter((node) => node.kind != "function" && node.kind != "declare" && node.kind != "noop")
  const location = moduleLocation(filename, source)

  if (functions.length == 0) return unsupportedSyntax("php", "module without a function", location)
  if (executableNodes.length == 0) return unsupportedSyntax("php", "module without an entry point", location)

  const entryStatements = convertRestrictedSequence(
    executableNodes,
    "echo",
    (node) => convertPrint(/** @type {import("php-parser").Echo} */ (node), filename, source),
    new Set(),
    filename,
    source
  )

  return {
    entryPoint: {
      body: /** @type {(import("../semantic/types.js").LocalStatement | import("../semantic/types.js").PrintStatement)[]} */ (entryStatements),
      kind: "EntryPoint",
      location: entryStatements[0].location
    },
    functions,
    kind: "Module",
    location
  }
}

/**
 * Accepts only an optional single `declare(strict_types=1)` directive.
 * @param {import("php-parser").Node[]} nodes - Top-level PHP nodes.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {void}
 */
function validateDeclareNodes(nodes, filename, source) {
  const declarations = nodes.filter((node) => node.kind == "declare")

  if (declarations.length > 1) {
    unsupportedSyntax("php", "multiple declare directives", nodeLocation(declarations[1], filename, source))
  }

  for (const declarationNode of declarations) {
    const declaration = /** @type {import("php-parser").Declare} */ (declarationNode)
    const directive = declaration.directives[0]
    const key = directive?.key
    const value = directive?.value
    const numericValue = value && typeof value == "object" && value.kind == "number"
      ? /** @type {import("php-parser").Number} */ (value)
      : undefined
    const valueIsOne = numericValue?.loc && source.slice(numericValue.loc.start.offset, numericValue.loc.end.offset) == "1"
    const valid = declaration.mode == "none" && declaration.children.length == 0 && declaration.directives.length == 1 &&
      key.kind == "identifier" && key.name == "strict_types" && valueIsOne

    if (!valid) unsupportedSyntax("php", "declare other than strict_types=1", nodeLocation(declaration, filename, source))
  }
}

/**
 * Invokes php-parser and normalizes syntax failures.
 * @param {string} filename - Source filename.
 * @param {string} source - Source text.
 * @returns {import("php-parser").Program} PHP program.
 */
function parsePhpProgram(filename, source) {
  try {
    return parser.parseCode(source, filename)
  } catch (error) {
    return parseFailure("php", error)
  }
}
