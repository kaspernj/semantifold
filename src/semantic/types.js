// @ts-check

/** @typedef {"php" | "ruby" | "javascript" | "typescript" | "java"} SemanticLanguage */
/** @typedef {"integer"} SemanticTypeName */

/**
 * @typedef SourcePoint
 * @property {number} line - One-based line.
 * @property {number} column - One-based column.
 * @property {number} offset - Zero-based UTF-16 source offset.
 */

/**
 * @typedef SourceLocation
 * @property {string} filename - Originating filename.
 * @property {SourcePoint} start - Inclusive start.
 * @property {SourcePoint} end - Exclusive end.
 */

/**
 * @typedef TypeReference
 * @property {"TypeReference"} kind - Node discriminator.
 * @property {SemanticTypeName} name - Normalized type name.
 */

/**
 * @typedef Parameter
 * @property {"Parameter"} kind - Node discriminator.
 * @property {string} name - Parameter name.
 * @property {TypeReference} type - Parameter type.
 * @property {SourceLocation} location - Source location.
 */

/**
 * @typedef IdentifierExpression
 * @property {"IdentifierExpression"} kind - Node discriminator.
 * @property {string} name - Referenced name.
 * @property {SourceLocation} location - Source location.
 */

/**
 * @typedef IntegerLiteral
 * @property {"IntegerLiteral"} kind - Node discriminator.
 * @property {number} value - JavaScript-safe integer value.
 * @property {SourceLocation} location - Source location.
 */

/**
 * @typedef BinaryExpression
 * @property {"BinaryExpression"} kind - Node discriminator.
 * @property {">" | "-" | "+"} operator - Supported binary operator.
 * @property {Expression} left - Left operand.
 * @property {Expression} right - Right operand.
 * @property {SourceLocation} location - Source location.
 */

/**
 * @typedef CallExpression
 * @property {"CallExpression"} kind - Node discriminator.
 * @property {string} callee - Function name.
 * @property {Expression[]} arguments - Positional arguments.
 * @property {SourceLocation} location - Source location.
 */

/** @typedef {IdentifierExpression | IntegerLiteral | BinaryExpression | CallExpression} Expression */

/**
 * @typedef ReturnStatement
 * @property {"ReturnStatement"} kind - Node discriminator.
 * @property {Expression} expression - Returned expression.
 * @property {SourceLocation} location - Source location.
 */

/**
 * @typedef IfStatement
 * @property {"IfStatement"} kind - Node discriminator.
 * @property {Expression} condition - Branch condition.
 * @property {ReturnStatement[]} consequent - True branch.
 * @property {ReturnStatement[]} alternate - False branch.
 * @property {SourceLocation} location - Source location.
 */

/** @typedef {IfStatement | ReturnStatement} FunctionStatement */

/**
 * @typedef FunctionDeclaration
 * @property {"FunctionDeclaration"} kind - Node discriminator.
 * @property {string} name - Function name.
 * @property {Parameter[]} parameters - Function parameters.
 * @property {TypeReference} returnType - Return type.
 * @property {FunctionStatement[]} body - Function body.
 * @property {SourceLocation} location - Source location.
 */

/**
 * @typedef PrintStatement
 * @property {"PrintStatement"} kind - Node discriminator.
 * @property {Expression} expression - Printed expression.
 * @property {SourceLocation} location - Source location.
 */

/**
 * @typedef EntryPoint
 * @property {"EntryPoint"} kind - Node discriminator.
 * @property {PrintStatement[]} body - Entry-point statements.
 * @property {SourceLocation} location - Source location.
 */

/**
 * @typedef SemanticModule
 * @property {"Module"} kind - Node discriminator.
 * @property {FunctionDeclaration[]} functions - Top-level functions.
 * @property {EntryPoint} entryPoint - Executable entry point.
 * @property {SourceLocation} location - Source location.
 */

/** @typedef {SemanticModule | FunctionDeclaration | Parameter | FunctionStatement | PrintStatement | EntryPoint | Expression} SemanticNode */
/** @typedef {SemanticNode} SemanticNodeWithoutLocations */

export {}
