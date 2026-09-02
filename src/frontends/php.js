// @ts-check

import PhpParser from "php-parser"
import {missingType, parseFailure, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation} from "../semantic/location.js"

const integerType = /** @type {const} */ ({kind: "TypeReference", name: "integer"})
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
 * Converts a PHP block containing supported returns.
 * @param {import("php-parser").Block} block - PHP block.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").ReturnStatement[]} Semantic returns.
 */
function convertReturnBlock(block, filename, source) {
  return block.children.map((child) => {
    const location = nodeLocation(child, filename, source)

    if (child.kind != "return") return unsupportedSyntax("php", child.kind, location)

    const returnNode = /** @type {import("php-parser").Return} */ (child)

    if (!returnNode.expr) return unsupportedSyntax("php", "empty return", location)

    return {expression: convertExpression(returnNode.expr, filename, source), kind: /** @type {const} */ ("ReturnStatement"), location}
  })
}

/**
 * Requires the PHP `int` type.
 * @param {import("php-parser").Identifier | null} sourceType - PHP type node.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} location - Source location.
 * @returns {import("../semantic/types.js").TypeReference} Semantic type.
 */
function convertType(sourceType, subject, location) {
  if (!sourceType || sourceType.name != "int") return missingType("php", subject, location)

  return integerType
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

  if (!node.body || node.body.children.length != 1 || node.body.children[0].kind != "if") {
    return unsupportedSyntax("php", "function body", location)
  }

  const parameters = node.arguments.map((parameter) => {
    const parameterLocation = nodeLocation(parameter, filename, source)
    const parameterName = typeof parameter.name == "string" ? parameter.name : parameter.name.name

    return {
      kind: /** @type {const} */ ("Parameter"),
      location: parameterLocation,
      name: parameterName,
      type: convertType(parameter.type, `Parameter '${parameterName}'`, parameterLocation)
    }
  })
  const ifNode = /** @type {import("php-parser").If} */ (node.body.children[0])
  const ifLocation = nodeLocation(ifNode, filename, source)

  if (!ifNode.alternate || ifNode.alternate.kind != "block") {
    return unsupportedSyntax("php", "if without block else", ifLocation)
  }

  return {
    body: [{
      alternate: convertReturnBlock(/** @type {import("php-parser").Block} */ (ifNode.alternate), filename, source),
      condition: convertExpression(ifNode.test, filename, source),
      consequent: convertReturnBlock(ifNode.body, filename, source),
      kind: "IfStatement",
      location: ifLocation
    }],
    kind: "FunctionDeclaration",
    location,
    name,
    parameters,
    returnType: convertType(node.type, `Function '${name}' return`, location)
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
  const entryStatements = executableNodes.map((node) => {
    if (node.kind != "echo") return unsupportedSyntax("php", node.kind, nodeLocation(node, filename, source))

    return convertPrint(/** @type {import("php-parser").Echo} */ (node), filename, source)
  })
  const location = moduleLocation(filename, source)

  if (functions.length == 0) return unsupportedSyntax("php", "module without a function", location)
  if (entryStatements.length == 0) return unsupportedSyntax("php", "module without an entry point", location)

  return {
    entryPoint: {body: entryStatements, kind: "EntryPoint", location: entryStatements[0].location},
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
