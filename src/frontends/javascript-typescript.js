// @ts-check

import {parse as parseBabel} from "@babel/parser"
import {parse as parseComment} from "comment-parser"
import {missingType, parseFailure, unsupportedSyntax} from "../diagnostic.js"
import {locationFromOffsets, moduleLocation} from "../semantic/location.js"
import {hasOnlyUnicodeScalars} from "../semantic/scalars.js"
import {requireSourceScalarType} from "./scalars.js"

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

  if (node.type == "BooleanLiteral") {
    if (typeof node.value != "boolean") return unsupportedSyntax(language, "invalid boolean literal value", location)

    return {kind: "BooleanLiteral", location, value: node.value}
  }

  if (node.type == "StringLiteral") {
    if (typeof node.value != "string" || !hasOnlyUnicodeScalars(node.value)) {
      return unsupportedSyntax(language, "invalid Unicode string literal", location)
    }

    return {kind: "StringLiteral", location, value: node.value}
  }

  if (node.type == "TemplateLiteral") {
    if (node.expressions.length > 0) return unsupportedSyntax(language, "interpolated string", location)

    const quasi = node.quasis[0]

    if (typeof quasi.value.cooked != "string" || !hasOnlyUnicodeScalars(quasi.value.cooked)) {
      return unsupportedSyntax(language, "invalid Unicode string literal", location)
    }

    return {kind: "StringLiteral", location, value: quasi.value.cooked}
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
 * Converts one supported local declaration or assignment.
 * @param {import("@babel/types").Statement} node - Babel statement.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").LocalStatement} Semantic local statement.
 */
function convertLocalStatement(node, language, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (node.type == "VariableDeclaration") {
    if (!["let", "const"].includes(node.kind) || node.declarations.length != 1) {
      return unsupportedSyntax(language, `${node.kind} declaration`, location)
    }

    const declarator = node.declarations[0]
    const declaratorLocation = nodeLocation(declarator, filename, source)

    if (declarator.id.type != "Identifier") return unsupportedSyntax(language, declarator.id.type, declaratorLocation)
    if (!declarator.init) return unsupportedSyntax(language, "uninitialized declaration", declaratorLocation)

    const type = language == "typescript"
      ? convertTypeScriptType(declarator.id.typeAnnotation, `Local '${declarator.id.name}'`, declaratorLocation, filename, source)
      : localJavaScriptType(node, declarator.id.name, filename, source)

    return {
      initializer: convertExpression(declarator.init, language, filename, source),
      kind: "LocalDeclaration",
      location,
      mutable: node.kind == "let",
      name: declarator.id.name,
      type
    }
  }

  if (node.type == "ExpressionStatement" && node.expression.type == "AssignmentExpression") {
    const assignment = node.expression
    const targetLocation = nodeLocation(assignment.left, filename, source)

    if (assignment.operator != "=") return unsupportedSyntax(language, `assignment ${assignment.operator}`, location)
    if (assignment.left.type != "Identifier") return unsupportedSyntax(language, assignment.left.type, targetLocation)

    return {
      expression: convertExpression(assignment.right, language, filename, source),
      kind: "AssignmentStatement",
      location,
      target: {kind: "IdentifierExpression", location: targetLocation, name: assignment.left.name}
    }
  }

  return unsupportedSyntax(language, node.type, location)
}

/**
 * Reads an immediately associated JavaScript local `@type` tag.
 * @param {import("@babel/types").VariableDeclaration} node - Local declaration.
 * @param {string} name - Local name.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").TypeReference} Semantic type.
 */
function localJavaScriptType(node, name, filename, source) {
  const comment = node.leadingComments?.at(-1)
  const location = nodeLocation(node, filename, source)

  if (!comment || comment.type != "CommentBlock" || !comment.value.startsWith("*")) {
    return missingType("javascript", `Local '${name}'`, location)
  }

  const gap = source.slice(comment.end ?? 0, node.start ?? 0)

  if (!/^\s*$/u.test(gap) || (gap.match(/\n/gu)?.length ?? 0) > 1) {
    return missingType("javascript", `Local '${name}'`, location)
  }

  const block = parseComment(`/*${comment.value}*/`)[0]
  const tags = block?.tags.filter((tag) => tag.tag == "type") ?? []

  return convertType(tags.length == 1 ? tags[0].type : undefined, "javascript", `Local '${name}'`, location)
}

/**
 * Converts a restricted declaration/assignment prefix and one terminal statement.
 * @template {import("@babel/types").Statement} Node
 * @template {import("../semantic/types.js").FunctionStatement | import("../semantic/types.js").PrintStatement} Terminal
 * @param {Node[]} statements - Source statements.
 * @param {"IfStatement" | "ReturnStatement" | "ExpressionStatement"} terminalKind - Terminal kind.
 * @param {(node: Node) => Terminal} convertTerminal - Terminal converter.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {(import("../semantic/types.js").LocalStatement | Terminal)[]} Semantic statements.
 */
function convertRestrictedSequence(statements, terminalKind, convertTerminal, language, filename, source) {
  const terminal = statements.at(-1)

  if (!terminal || terminal.type != terminalKind) {
    const location = terminal ? nodeLocation(terminal, filename, source) : moduleLocation(filename, source)

    return unsupportedSyntax(language, `statement sequence without terminal ${terminalKind}`, location)
  }

  return [...statements.slice(0, -1).map((statement) => convertLocalStatement(statement, language, filename, source)), convertTerminal(terminal)]
}

/**
 * Converts a block containing only supported return statements.
 * @param {import("@babel/types").Statement} node - Babel statement or block.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {(import("../semantic/types.js").LocalStatement | import("../semantic/types.js").ReturnStatement)[]} Semantic branch statements.
 */
function convertReturnBlock(node, language, filename, source) {
  const statements = node.type == "BlockStatement" ? node.body : [node]

  return /** @type {(import("../semantic/types.js").LocalStatement | import("../semantic/types.js").ReturnStatement)[]} */ (
    convertRestrictedSequence(statements, "ReturnStatement", (statement) => convertReturn(statement, language, filename, source), language, filename, source)
  )
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
 * Requires a supported JavaScript JSDoc scalar type spelling.
 * @param {string | undefined} sourceType - Source-language type.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} location - Source location.
 * @returns {import("../semantic/types.js").TypeReference} Semantic type.
 */
function convertType(sourceType, language, subject, location) {
  return requireSourceScalarType(language, sourceType, subject, location)
}

/**
 * Converts one exact TypeScript scalar keyword annotation.
 * @param {import("@babel/types").TypeAnnotation | import("@babel/types").TSTypeAnnotation | import("@babel/types").Noop | null | undefined} annotation - Type annotation.
 * @param {string} subject - Typed subject.
 * @param {import("../semantic/types.js").SourceLocation} ownerLocation - Owning declaration location.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").TypeReference} Semantic scalar type.
 */
function convertTypeScriptType(annotation, subject, ownerLocation, filename, source) {
  if (!annotation) return missingType("typescript", subject, ownerLocation)
  if (annotation.type != "TSTypeAnnotation") {
    return unsupportedSyntax("typescript", "unsupported scalar type", nodeLocation(annotation, filename, source))
  }

  const typeNode = annotation.typeAnnotation
  const sourceType = typeNode.type == "TSNumberKeyword"
    ? "number"
    : typeNode.type == "TSBooleanKeyword"
      ? "boolean"
      : typeNode.type == "TSStringKeyword" ? "string" : undefined

  if (!sourceType) {
    return unsupportedSyntax("typescript", "unsupported scalar type", nodeLocation(typeNode, filename, source))
  }

  return requireSourceScalarType("typescript", sourceType, subject, ownerLocation)
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

  const documentedTypes = language == "javascript" ? jsdocTypes(node, filename, source) : undefined
  const parameters = node.params.map((parameter) => {
    const parameterLocation = nodeLocation(parameter, filename, source)

    if (parameter.type != "Identifier") return unsupportedSyntax(language, parameter.type, parameterLocation)

    const type = language == "javascript"
      ? convertType(documentedTypes?.parameters.get(parameter.name), language, `Parameter '${parameter.name}'`, parameterLocation)
      : convertTypeScriptType(parameter.typeAnnotation, `Parameter '${parameter.name}'`, parameterLocation, filename, source)

    return {
      kind: /** @type {const} */ ("Parameter"),
      location: parameterLocation,
      name: parameter.name,
      type
    }
  })
  const returnAnnotation = node.returnType
  const returnType = language == "javascript"
    ? convertType(documentedTypes?.returnType, language, `Function '${node.id.name}' return`, location)
    : convertTypeScriptType(returnAnnotation, `Function '${node.id.name}' return`, location, filename, source)
  const body = convertRestrictedSequence(
    node.body.body,
    "IfStatement",
    (statement) => convertIf(/** @type {import("@babel/types").IfStatement} */ (statement), language, filename, source),
    language,
    filename,
    source
  )

  return {
    body: /** @type {import("../semantic/types.js").FunctionStatement[]} */ (body),
    kind: "FunctionDeclaration",
    location,
    name: node.id.name,
    parameters,
    returnType
  }
}

/**
 * Converts the existing exact if/else terminal shape.
 * @param {import("@babel/types").IfStatement} node - Babel if statement.
 * @param {"javascript" | "typescript"} language - Frontend language.
 * @param {string} filename - Source filename.
 * @param {string} source - Complete source.
 * @returns {import("../semantic/types.js").IfStatement} Semantic branch.
 */
function convertIf(node, language, filename, source) {
  const location = nodeLocation(node, filename, source)

  if (!node.alternate) return unsupportedSyntax(language, "if without else", location)

  return {
    alternate: convertReturnBlock(node.alternate, language, filename, source),
    condition: convertExpression(node.test, language, filename, source),
    consequent: convertReturnBlock(node.consequent, language, filename, source),
    kind: "IfStatement",
    location
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
  const entryNodes = file.program.body.filter((node) => node.type != "FunctionDeclaration")
  const location = moduleLocation(filename, source)

  if (functions.length == 0) return unsupportedSyntax(language, "module without a function", location)
  if (entryNodes.length == 0) return unsupportedSyntax(language, "module without an entry point", location)

  const entryStatements = convertRestrictedSequence(
    entryNodes,
    "ExpressionStatement",
    (statement) => convertPrint(statement, language, filename, source),
    language,
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
