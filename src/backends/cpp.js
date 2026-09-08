// @ts-check

import {unsupportedCapability} from "../diagnostic.js"
import {statementSignature, planNativeModule} from "./ordered-expressions.js"
import {cppRuntime} from "./cpp-runtime.js"
import {maximumCppSourceLength, validateCppValues} from "./cpp-validation.js"
import {emitScalarType} from "./scalars.js"
import {SourceWriter} from "./writer.js"

/** @typedef {import("../semantic/types.js").SemanticModule} SemanticModule */
/** @typedef {import("../semantic/types.js").SemanticNode} SemanticNode */
/** @typedef {import("../semantic/types.js").Statement} Statement */
/** @typedef {import("../semantic/types.js").Block} Block */
/** @typedef {import("./ordered-expressions.js").PlannedValue} PlannedValue */
/** @typedef {import("./ordered-expressions.js").PlannedStep} PlannedStep */
/** @typedef {import("./ordered-expressions.js").StatementPlan} StatementPlan */

const binaryTokens = new Map([
  ["IntegerAdd", "semantifold_integer_add"], ["IntegerSubtract", "semantifold_integer_subtract"],
  ["IntegerMultiply", "semantifold_integer_multiply"], ["StringConcat", "semantifold_string_concat"],
  ["StringEqual", "semantifold_string_equal"], ["StringNotEqual", "semantifold_string_not_equal"],
  ["IntegerEqual", "=="], ["IntegerNotEqual", "!="], ["BooleanEqual", "=="], ["BooleanNotEqual", "!="],
  ["IntegerLessThan", "<"], ["IntegerLessThanOrEqual", "<="],
  ["IntegerGreaterThan", ">"], ["IntegerGreaterThanOrEqual", ">="]
])

/**
 * Emits the one fully validated C++20 translation unit with owned by-value strings.
 * @param {SemanticModule} module - Shared validated semantics.
 * @param {SourceWriter} [writer] - Optional caller-owned provenance writer.
 * @returns {string} Deterministic source for public generation or same-language CST validation.
 */
export function generateCpp(module, writer) {
  validateCppValues(module)
  const plans = planNativeModule(module, "cpp")

  new CppEmitter(undefined, plans, module.location).program(module)
  const output = writer ?? new SourceWriter({filename: "program.cpp", language: "cpp", module})

  new CppEmitter(output, plans, module.location).program(module)
  return output.finish().generated.content
}

/** Writes only target syntax from validated semantic occurrences and private plans. */
class CppEmitter {
  /**
   * Binds the writer and complete plan.
   * @param {SourceWriter | undefined} writer - Provenance writer; omitted for exact size preflight.
   * @param {Map<string, StatementPlan>} plans - Validated occurrence plans.
   * @param {import("../semantic/types.js").SourceLocation} location - Root diagnostic location.
   */
  constructor(writer, plans, location) {
    this.writer = writer
    this.plans = plans
    this.location = location
    this.length = 0
  }

  /**
   * Writes generated scaffold with a related semantic origin.
   * @param {string} text - C++ syntax.
   * @param {SemanticNode} node - Related node.
   * @param {string} path - Occurrence path.
   * @returns {void}
   */
  synthetic(text, node, path) {
    this.checkSize(text, node)
    this.writer?.synthetic(text, "C++20 ordered-expression and lifetime scaffold", [node], [path])
  }

  /**
   * Writes an original semantic token or anchor.
   * @param {string} text - Target token.
   * @param {SemanticNode} node - Original node.
   * @param {string} path - Occurrence path.
   * @param {string} [role] - Parser token role.
   * @returns {void}
   */
  mapped(text, node, path, role) {
    this.checkSize(text, node)
    this.writer?.mapped(text, {mappingKind: role ? "exact" : "anchor", node, path, ...(role ? {role} : {})})
  }

  /**
   * Bounds private emission before any artifact can escape the parser's proven input profile.
   * @param {string} text - Next exact output chunk.
   * @param {SemanticNode} node - Related semantic occurrence.
   * @returns {void}
   */
  checkSize(text, node) {
    this.length += text.length
    if (this.length > maximumCppSourceLength) unsupportedCapability("cpp", "generated program exceeds the frozen CPP parser's 32767 UTF-16 input limit",
      "location" in node ? node.location : this.location)
  }

  /**
   * Emits canonical prototypes, definitions, and the parameterless main.
   * @param {SemanticModule} module - Semantic module.
   * @returns {void}
   */
  program(module) {
    this.synthetic("/* semantifold:program:cpp:v1 */\n" + cppRuntime + "\n", module, "")
    module.functions.forEach((declaration, index) => {
      const parameters = declaration.parameters.map((parameter) => `${emitScalarType("cpp", parameter.type)} ${parameter.name}`).join(", ")

      this.synthetic(`${emitScalarType("cpp", declaration.returnType)} ${declaration.name}(${parameters});\n`, declaration, `/functions/${index}`)
    })
    module.functions.forEach((declaration, index) => {
      const path = `/functions/${index}`

      this.synthetic("\n", declaration, path)
      this.mapped(emitScalarType("cpp", declaration.returnType), declaration.returnType, `${path}/returnType`, "type")
      this.synthetic(" ", declaration, path)
      this.mapped(declaration.name, declaration, path, "name")
      this.synthetic("(", declaration, path)
      declaration.parameters.forEach((parameter, parameterIndex) => {
        const parameterPath = `${path}/parameters/${parameterIndex}`

        if (parameterIndex) this.synthetic(", ", parameter, parameterPath)
        this.mapped(emitScalarType("cpp", parameter.type), parameter.type, `${parameterPath}/type`, "type")
        this.synthetic(" ", parameter, parameterPath)
        this.mapped(parameter.name, parameter, parameterPath, "name")
      })
      this.synthetic(") {\n", declaration, path)
      declaration.parameters.forEach((parameter, parameterIndex) => this.synthetic(`    (void)${parameter.name};\n`, parameter, `${path}/parameters/${parameterIndex}`))
      this.block(declaration.body, `${path}/body`, "    ")
      this.synthetic("}\n", declaration, path)
    })
    this.synthetic("\nint main() {\n", module.entryPoint, "/entryPoint")
    this.block(module.entryPoint.body, "/entryPoint/body", "    ")
    this.synthetic("    return 0;\n}\n", module.entryPoint, "/entryPoint")
  }

  /**
   * Emits statements in semantic source order.
   * @param {Block} block - Semantic block.
   * @param {string} path - Occurrence path.
   * @param {string} indent - Current indentation.
   * @returns {void}
   */
  block(block, path, indent) {
    block.statements.forEach((statement, index) => this.statement(statement, `${path}/statements/${index}`, indent))
  }

  /**
   * Emits one paired region with a pure final consumer.
   * @param {Statement} statement - Original statement.
   * @param {string} path - Occurrence path.
   * @param {string} indent - Current indentation.
   * @returns {void}
   */
  statement(statement, path, indent) {
    const plan = this.plans.get(path)

    if (!plan) throw new Error("Missing validated C++ statement plan.")
    const marker = `semantifold:ordered-expression:cpp:v1`
    const signature = statementSignature(statement)

    this.synthetic(`${indent}/* ${marker} begin ${plan.id} ${signature} */\n`, statement, path)
    this.steps(plan.steps, indent)
    this.synthetic(indent, statement, path)
    if (statement.kind == "LocalDeclaration") {
      if (!statement.mutable) this.synthetic("const ", statement, path)
      this.mapped(emitScalarType("cpp", statement.type), statement.type, `${path}/type`, "type")
      this.synthetic(" ", statement, path)
      this.mapped(statement.name, statement, path, "name")
      this.synthetic(" ", statement, path)
      this.mapped("=", statement, path, "operator")
      this.synthetic(" ", statement, path)
    } else if (statement.kind == "AssignmentStatement") {
      this.mapped(statement.target.name, statement.target, `${path}/target`, "name")
      this.synthetic(" ", statement, path)
      this.mapped("=", statement, path, "operator")
      this.synthetic(" ", statement, path)
    } else if (statement.kind == "ReturnStatement") this.mapped("return ", statement, path)
    else if (statement.kind == "PrintStatement") this.mapped(`semantifold_print_${plan.value.type}(`, statement, path)
    else this.mapped("if (", statement, path)
    this.value(plan.value)
    if (statement.kind == "IfStatement") {
      this.synthetic(") {\n", statement, path)
      this.block(statement.consequent, `${path}/consequent`, `${indent}    `)
      this.synthetic(`${indent}}`, statement, path)
      if (statement.alternate) {
        this.mapped(" else ", statement, path)
        this.synthetic("{\n", statement, path)
        this.block(statement.alternate, `${path}/alternate`, `${indent}    `)
        this.synthetic(`${indent}}`, statement, path)
      }
      this.synthetic("\n", statement, path)
    } else {
      this.synthetic(`${statement.kind == "PrintStatement" ? ")" : ""};\n`, statement, path)
      if (statement.kind == "LocalDeclaration") this.synthetic(`${indent}(void)${statement.name};\n`, statement, path)
    }
    this.synthetic(`${indent}/* ${marker} end ${plan.id} ${signature} */\n`, statement, path)
  }

  /**
   * Emits each eager step or conditional RHS at its planned location.
   * @param {PlannedStep[]} steps - Ordered private steps.
   * @param {string} indent - Current indentation.
   * @returns {void}
   */
  steps(steps, indent) {
    for (const step of steps) {
      const {result, operands, rightSteps} = step
      const {expression, path, name} = result
      const type = emitScalarType("cpp", {kind: "TypeReference", name: result.type})

      this.synthetic(`${indent}${type} ${name} = `, expression, path)
      if (rightSteps) {
        this.value(operands[0])
        this.synthetic(`;\n${indent}if (`, expression, path)
        if (expression.kind != "BinaryExpression") throw new Error("Invalid conditional C++ plan.")
        this.synthetic(`${expression.operation == "BooleanOr" ? "!" : ""}${name}) {\n`, expression, path)
        this.steps(rightSteps, `${indent}    `)
        this.synthetic(`${indent}    ${name} = (${name} `, expression, path)
        this.mapped(expression.operation == "BooleanOr" ? "||" : "&&", expression, path, "operator")
        this.synthetic(" ", expression, path)
        this.value(operands[1])
        this.synthetic(`);\n${indent}}\n`, expression, path)
      } else {
        this.operation(step)
        this.synthetic(";\n", expression, path)
      }
    }
  }

  /**
   * Emits one nontrivial operation with pure operands.
   * @param {PlannedStep} step - Eager step.
   * @returns {void}
   */
  operation({result: {expression, path}, operands}) {
    if (expression.kind == "CallExpression") {
      this.mapped(expression.callee, expression, path, "callee")
      this.synthetic("(", expression, path)
      operands.forEach((operand, index) => {
        if (index) this.synthetic(", ", expression, path)
        this.value(operand)
      })
      this.synthetic(")", expression, path)
    } else if (expression.kind == "UnaryExpression") {
      this.mapped(expression.operation == "IntegerNegate" ? "semantifold_integer_negate" : "!", expression, path, "operator")
      this.synthetic("(", expression, path)
      this.value(operands[0])
      this.synthetic(")", expression, path)
    } else if (expression.kind == "BinaryExpression") {
      const token = binaryTokens.get(expression.operation)

      if (!token) throw new Error("Unsupported operation passed C++ planning.")
      const helper = token.startsWith("semantifold_")

      if (helper) this.mapped(token, expression, path, "operator")
      this.synthetic("(", expression, path)
      this.value(operands[0])
      if (helper) this.synthetic(", ", expression, path)
      else {
        this.synthetic(" ", expression, path)
        this.mapped(token, expression, path, "operator")
        this.synthetic(" ", expression, path)
      }
      this.value(operands[1])
      this.synthetic(")", expression, path)
    } else throw new Error("Pure expression was scheduled as a CPP operation.")
  }

  /**
   * Emits a pure operand with original token provenance or a synthetic temporary use.
   * @param {PlannedValue} value - Planned pure operand.
   * @returns {void}
   */
  value({expression, path, name}) {
    if (name) return this.synthetic(name, expression, path)
    if (expression.kind == "IdentifierExpression") return this.mapped(expression.name, expression, path, "name")
    if (expression.kind == "BooleanLiteral") return this.mapped(String(expression.value), expression, path, "literal")
    if (expression.kind == "IntegerLiteral") return this.mapped(`std::int64_t(${expression.value})`, expression, path, "literal")
    if (expression.kind == "StringLiteral") {
      const bytes = new TextEncoder().encode(expression.value)
      const literal = Array.from(bytes, (byte) => `\\${byte.toString(8).padStart(3, "0")}`).join("")

      return this.mapped(`std::string("${literal}", ${bytes.length})`, expression, path, "literal")
    }
    throw new Error("Unsequenced expression passed C++ planning.")
  }
}
