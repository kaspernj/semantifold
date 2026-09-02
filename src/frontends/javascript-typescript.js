// @ts-check

import {parse as parseBabel} from "@babel/parser"
import {parse as parseComment} from "comment-parser"
import {missingType, parseFailure, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation} from "../semantic/location.js"

const integerType = /** @type {const} */ ({kind: "TypeReference", name: "integer"})

/**
 * Returns a source location for a Babel node.
 * @param {import("@babel/types").Node} node - Babel node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").SourceLocation} Normalized location.
 */
function nodeLocation(node, filename, source) {
  if (typeof node.start != "number" || typeof node.end != "number") {
    throw new Error(`Babel omitted source offsets for ${node.type}.`)
  }

  return locationFromOffsets(filename, source, node.start, node.end)
}

/**
 * Converts a supported Babel expression.
 * @param {import("@babel/types").Expression} node - Babel expression.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").Expression} Semantic expression.
 */
function convertExpression(node, language, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.type == "Identifier") {
    return {kind: "IdentifierExpression", location, name: node.name}
  }

  if (node.type == "NumericLiteral") {
    if (!Number.isSafeInteger(node.value)) return unsupportedSyntax(language, "non-safe integer literal", location)

    return {kind: "IntegerLiteral", location, value: node.value}
  }

  if (node.type == "BinaryExpression" && [">", "-", "+"].includes(node.operator)) {
    if (node.left.type == "PrivateName") unsupportedSyntax(language, node.left.type, location)

    return {
      kind: "BinaryExpression",
      left: convertExpression(node.left, language, filename, source),
      location,
      operator: /** @type {">" | "-" | "+"} */ (node.operator),
      right: convertExpression(node.right, language, filename, source)
    }
  }

  if (node.type == "CallExpression" && node.callee.type == "Identifier") {
    const arguments_ = node.arguments.map((argument) => {
      if (argument.type == "SpreadElement" || argument.type == "ArgumentPlaceholder") {
        return unsupportedSyntax(language, argument.type, nodeLocation(argument, filename, source))
      }

      return convertExpression(argument, language, filename, source)
    })

    return {arguments: arguments_, callee: node.callee.name, kind: "CallExpression", location}
  }

  return unsupportedSyntax(language, node.type, location)
}

/**
 * Converts a supported return statement.
 * @param {import("@babel/types").Statement} node - Babel statement.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").ReturnStatement} Semantic return.
 */
function convertReturn(node, language, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.type != "ReturnStatement" || !node.argument) return unsupportedSyntax(language, node.type, location)

  return {expression: convertExpression(node.argument, language, filename, source), kind: "ReturnStatement", location}
}

/**
 * Converts a block containing only supported return statements.
 * @param {import("@babel/types").Statement} node - Babel statement or block.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").ReturnStatement[]} Semantic returns.
 */
function convertReturnBlock(node, language, filename, source) {
  if (node.type != "BlockStatement") {
    return [convertReturn(node, language, filename, source)]
  }

  return node.body.map((statement) => convertReturn(statement, language, filename, source))
}

/**
 * Reads JavaScript JSDoc types from a function.
 * @param {import("@babel/types").FunctionDeclaration} node - Babel function node.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {{parameters: Map<string, string>, returnType: string | undefined}} Parsed types.
 */
function jsdocTypes(node, filename, source) {
  const comment = node.leadingComments?.find((candidate) => candidate.type == "CommentBlock" && candidate.value.startsWith("*"))

  if (!comment) missingType("javascript", `Function '${node.id?.name ?? "anonymous"}'`, nodeLocation(node, filename, source))

  const block = parseComment(`/*${comment.value}*/`)[0]
  const parameters = new Map(block.tags.filter((tag) => tag.tag == "param").map((tag) => [tag.name, tag.type]))
  const returnTag = block.tags.find((tag) => tag.tag == "returns" || tag.tag == "return")

  return {parameters, returnType: returnTag?.type}
}

/**
 * Requires a supported integer type spelling.
 * @param {string | undefined} sourceType - Source-language type.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} location - Source location.
 * @returns {import("../semantic/types.js").TypeReference} Semantic type.
 */
function convertType(sourceType, language, subject, location) {
  if (sourceType != "number") return missingType(language, subject, location)

  return integerType
}

/**
 * Converts a supported function declaration.
 * @param {import("@babel/types").FunctionDeclaration} node - Babel function.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").FunctionDeclaration} Semantic function.
 */
function convertFunction(node, language, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (!node.id) return unsupportedSyntax(language, "anonymous function", location)
  if (node.async) return unsupportedSyntax(language, "async function", location)
  if (node.generator) return unsupportedSyntax(language, "generator function", location)
  if (node.body.body.length != 1 || node.body.body[0].type != "IfStatement") {
    return unsupportedSyntax(language, "function body", location)
  }

  const documentedTypes = language == "javascript" ? jsdocTypes(node, filename, source) : undefined
  const parameters = node.params.map((parameter) => {
    const parameterLocation = nodeLocation(parameter, filename, source)

    if (parameter.type != "Identifier") return unsupportedSyntax(language, parameter.type, parameterLocation)

    const annotation = parameter.typeAnnotation
    const sourceType = language == "javascript"
      ? documentedTypes?.parameters.get(parameter.name)
      : annotation?.type == "TSTypeAnnotation" && annotation.typeAnnotation.type == "TSNumberKeyword" ? "number" : undefined

    return {
      kind: /** @type {const} */ ("Parameter"),
      location: parameterLocation,
      name: parameter.name,
      type: convertType(sourceType, language, `Parameter '${parameter.name}'`, parameterLocation)
    }
  })
  const returnAnnotation = node.returnType
  const returnSourceType = language == "javascript"
    ? documentedTypes?.returnType
    : returnAnnotation?.type == "TSTypeAnnotation" && returnAnnotation.typeAnnotation.type == "TSNumberKeyword" ? "number" : undefined
  const ifNode = node.body.body[0]
  const ifLocation = nodeLocation(ifNode, filename, source)

  if (!ifNode.alternate) return unsupportedSyntax(language, "if without else", ifLocation)

  return {
    body: [{
      alternate: convertReturnBlock(ifNode.alternate, language, filename, source),
      condition: convertExpression(ifNode.test, language, filename, source),
      consequent: convertReturnBlock(ifNode.consequent, language, filename, source),
      kind: "IfStatement",
      location: ifLocation
    }],
    kind: "FunctionDeclaration",
    location,
    name: node.id.name,
    parameters,
    returnType: convertType(returnSourceType, language, `Function '${node.id.name}' return`, location)
  }
}

/**
 * Converts a console.log entry-point call.
 * @param {import("@babel/types").Statement} node - Babel statement.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").PrintStatement} Print statement.
 */
function convertPrint(node, language, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.type != "ExpressionStatement" || node.expression.type != "CallExpression") {
    return unsupportedSyntax(language, node.type, location)
  }

  const call = node.expression
  const callee = call.callee

  if (callee.type != "MemberExpression" || callee.computed || callee.object.type != "Identifier" ||
    callee.object.name != "console" || callee.property.type != "Identifier" || callee.property.name != "log" ||
    call.arguments.length != 1) {
    return unsupportedSyntax(language, "entry-point expression", location)
  }

  const argument = call.arguments[0]

  if (argument.type == "SpreadElement" || argument.type == "ArgumentPlaceholder") {
    return unsupportedSyntax(language, argument.type, nodeLocation(argument, filename, source))
  }

  return {expression: convertExpression(argument, language, filename, source), kind: "PrintStatement", location}
}

/**
 * Parses JavaScript or TypeScript into the shared semantic module.
 * @param {object} input - Parser input.
 * @param {string} input.filename - Source filename.
 * @param {"javascript" | "typescript"} input.language - Frontend language.
 * @param {string} input.source - Source text.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parseJavaScriptTypeScript({filename, language, source}) {
  const file = parseBabelSource({filename, language, source})
  const functions = file.program.body.filter((node) => node.type == "FunctionDeclaration")
    .map((node) => convertFunction(node, language, filename, source))
  const entryStatements = file.program.body.filter((node) => node.type != "FunctionDeclaration")
    .map((node) => convertPrint(node, language, filename, source))
  const location = moduleLocation(filename, source)

  if (functions.length == 0) return unsupportedSyntax(language, "module without a function", location)
  if (entryStatements.length == 0) return unsupportedSyntax(language, "module without an entry point", location)

  return {
    entryPoint: {body: entryStatements, kind: "EntryPoint", location: entryStatements[0].location},
    functions,
    kind: "Module",
    location
  }
}

/**
 * Invokes Babel and normalizes syntax failures.
 * @param {object} input - Parser input.
 * @param {string} input.filename - Source filename.
 * @param {"javascript" | "typescript"} input.language - Frontend language.
 * @param {string} input.source - Source text.
 * @returns {import("@babel/parser").ParseResult<import("@babel/types").File>} Babel file.
 */
function parseBabelSource({filename, language, source}) {
  try {
    return parseBabel(source, {
      plugins: language == "typescript" ? ["typescript"] : [],
      sourceFilename: filename,
      sourceType: "script"
    })
  } catch (error) {
    return parseFailure(language, error)
  }
}
