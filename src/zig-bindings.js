// @ts-check

/**
 * Collects semantic binding reads and explicit assignment targets for Zig's compile-error-level binding checks.
 * @param {import("./semantic/types.js").Block} block - Complete function or entry block.
 * @returns {{reads: Set<string>, writes: Set<string>}} Binding usage by exact source name.
 */
export function collectZigBindingUsage(block) {
  const reads = new Set()
  const writes = new Set()
  /**
   * Records every binding read in one expression.
   * @param {import("./semantic/types.js").Expression} expression - Expression to traverse.
   */
  const expression = (expression) => {
    if (expression.kind == "IdentifierExpression") reads.add(expression.name)
    else if (expression.kind == "CallExpression") expression.arguments.forEach(argument => expressionVisit(argument))
    else if (expression.kind == "UnaryExpression") expressionVisit(expression.operand)
    else if (expression.kind == "BinaryExpression") {
      expressionVisit(expression.left)
      expressionVisit(expression.right)
    }
  }
  const expressionVisit = expression
  /**
   * Records reads and writes throughout one block subtree.
   * @param {import("./semantic/types.js").Block} current - Block to traverse.
   */
  const visit = (current) => {
    for (const statement of current.statements) {
      if (statement.kind == "LocalDeclaration") expressionVisit(statement.initializer)
      else if (statement.kind == "AssignmentStatement") {
        writes.add(statement.target.name)
        expressionVisit(statement.expression)
      } else if (statement.kind == "IfStatement") {
        expressionVisit(statement.condition)
        visit(statement.consequent)
        if (statement.alternate) visit(statement.alternate)
      } else if (statement.kind == "ExpressionStatement" || statement.kind == "PrintStatement") expressionVisit(statement.expression)
      else if (statement.kind == "ReturnStatement" && statement.expression) expressionVisit(statement.expression)
    }
  }

  visit(block)
  return {reads, writes}
}
