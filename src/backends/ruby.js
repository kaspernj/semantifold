// @ts-check

import {emitExpression, emitType} from "./shared.js"

/**
 * Emits an independently executable Ruby program through the source-aware writer.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @returns {void}
 */
export function generateRuby(module, writer) {
  const records = module.records ?? []

  if (writer.program) {
    const programModule = /** @type {import("../semantic/types.js").SemanticProgramModule} */ (/** @type {unknown} */ (module))

    for (const moduleId of [...new Set(programModule.imports.map((item) => item.moduleId))]) {
      const relative = writer.relativeModuleSpecifier(moduleId).replace(/\.rb$/u, "").replace(/^\.\//u, "")
      const imported = /** @type {import("../semantic/types.js").SemanticImport} */ (
        programModule.imports.find((item) => item.moduleId == moduleId))
      const importPath = `/imports/${programModule.imports.indexOf(imported)}`

      writer.synthetic("require_relative ", "Ruby require-relative edge", [imported], [importPath])
      writer.mapped(JSON.stringify(relative), {mappingKind: "anchor", node: imported, path: importPath, role: "path"})
      writer.synthetic("\n", "Ruby require-relative terminator", [imported], [importPath])
    }
    if (programModule.imports.length > 0) writer.synthetic("\n", "Ruby require/module separator", [module])
    writer.synthetic(`module ${writer.programModuleName(programModule.id)}\n`, "Ruby semantic module wrapper", [module])
    if (module.functions.length > 0) writer.synthetic("module_function\n\n", "Ruby module-function profile", [module])
  }

  records.forEach((record, recordIndex) => {
    const recordPath = `/records/${recordIndex}`

    if (recordIndex > 0) writer.synthetic("\n\n", "record declaration separator", [record], [recordPath])
    writer.mapped("class", {mappingKind: "anchor", node: record, path: recordPath})
    writer.synthetic(" ", "record declaration spacing", [record], [recordPath])
    writer.mapped(record.name, {mappingKind: "exact", node: record, path: recordPath, role: "name"})
    writer.synthetic("\n", "line break", [record], [recordPath])
    record.fields.forEach((field, fieldIndex) => {
      const fieldPath = `${recordPath}/fields/${fieldIndex}`

      writer.synthetic("  # @type [", "Ruby record field type scaffolding", [field], [fieldPath])
      emitType(writer, field.type, `${fieldPath}/type`, "ruby")
      writer.synthetic("]\n  attr_reader :", "Ruby record reader scaffolding", [field], [fieldPath])
      writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
      writer.synthetic("\n", "line break", [field], [fieldPath])
    })
    writer.synthetic("\n", "record constructor separator", [record], [recordPath])
    record.fields.forEach((field, fieldIndex) => {
      const fieldPath = `${recordPath}/fields/${fieldIndex}`

      writer.synthetic("  # @param ", "Ruby record constructor type scaffolding", [field], [fieldPath])
      writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
      writer.synthetic(" [", "Ruby record constructor type scaffolding", [field], [fieldPath])
      emitType(writer, field.type, `${fieldPath}/type`, "ruby")
      writer.synthetic("]\n", "Ruby record constructor type scaffolding", [field], [fieldPath])
    })
    writer.synthetic("  def initialize(", "Ruby record constructor scaffolding", [record], [recordPath])
    record.fields.forEach((field, fieldIndex) => {
      if (fieldIndex) writer.synthetic(", ", "record field separator", [record], [recordPath])
      writer.mapped(field.name, {mappingKind: "exact", node: field, path: `${recordPath}/fields/${fieldIndex}`, role: "name"})
    })
    writer.synthetic(")\n", "Ruby record constructor scaffolding", [record], [recordPath])
    record.fields.forEach((field, fieldIndex) => {
      const fieldPath = `${recordPath}/fields/${fieldIndex}`

      writer.synthetic("    @", "Ruby record storage scaffolding", [field], [fieldPath])
      writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
      writer.synthetic(" = ", "Ruby record storage scaffolding", [field], [fieldPath])
      writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
      writer.synthetic("\n", "line break", [field], [fieldPath])
    })
    writer.synthetic("    ::Kernel.instance_method(:freeze).bind_call(self)\n  end\nend", "Ruby record immutability scaffolding", [record], [recordPath])
  })
  if (records.length > 0) writer.synthetic("\n\n", "record/function separator", [module])

  module.functions.forEach((declaration, functionIndex) => {
    if (functionIndex > 0) writer.synthetic("\n\n", "declaration separator", [declaration])

    for (const [parameterIndex, parameter] of declaration.parameters.entries()) {
      const parameterPath = `/functions/${functionIndex}/parameters/${parameterIndex}`

      writer.synthetic("# @param ", "Ruby type scaffolding", [parameter], [parameterPath])
      writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
      writer.synthetic(" [", "Ruby type scaffolding", [parameter], [parameterPath])
      emitType(writer, parameter.type, `${parameterPath}/type`, "ruby")
      writer.synthetic("]\n", "Ruby type scaffolding", [parameter], [parameterPath])
    }
    writer.synthetic("# @return [", "Ruby type scaffolding", [declaration])
    emitType(writer, declaration.returnType, `/functions/${functionIndex}/returnType`, "ruby")
    writer.synthetic("]\n", "Ruby type scaffolding", [declaration])
    writer.mapped("def", {mappingKind: "anchor", node: declaration})
    writer.synthetic(" ", "function spacing", [declaration])
    writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, role: "name"})
    writer.mapped("(", {mappingKind: "anchor", node: declaration})
    declaration.parameters.forEach((parameter, index) => {
      if (index > 0) writer.synthetic(", ", "parameter separator", [declaration])
      writer.mapped(parameter.name, {
        mappingKind: "exact",
        node: parameter,
        path: `/functions/${functionIndex}/parameters/${index}`,
        role: "name"
      })
    })
    writer.mapped(")", {mappingKind: "anchor", node: declaration})
    writer.synthetic("\n", "line break", [declaration])

    emitBlock(writer, declaration.body, "  ", `/functions/${functionIndex}/body`)
    writer.mapped("end", {mappingKind: "anchor", node: declaration})
  })

  if (writer.program) {
    const privateRecords = records.filter((record) => !writer.isExported(record.id))
    const privateFunctions = module.functions.filter((declaration) => !writer.isExported(declaration.id))

    for (const record of privateRecords) {
      writer.synthetic("\nprivate_constant :", "Ruby private semantic record", [record])
      writer.mapped(record.name, {mappingKind: "exact", node: record, role: "name"})
    }
    for (const declaration of privateFunctions) {
      writer.synthetic("\nprivate_class_method :", "Ruby private semantic function", [declaration])
      writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, role: "name"})
    }
  }

  if (!writer.program || writer.isProgramEntry()) {
    writer.synthetic("\n\n", "entry-point separator", [module.entryPoint])
    emitBlock(writer, module.entryPoint.body, "", "/entryPoint/body")
  }
  if (writer.program) writer.synthetic("\nend\n", "Ruby semantic module close", [module])
}

/**
 * Emits one ordered Ruby block body.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Block} block - Semantic block.
 * @param {string} indent - Indentation.
 * @param {string} path - Exact block path.
 * @returns {void}
 */
function emitBlock(writer, block, indent, path) {
  block.statements.forEach((statement, index) => emitStatement(writer, statement, indent, `${path}/statements/${index}`))
}

/**
 * Emits one Ruby statement.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Statement} statement - Semantic statement.
 * @param {string} indent - Indentation.
 * @param {string} path - Exact statement path.
 * @returns {void}
 */
function emitStatement(writer, statement, indent, path) {
  if (statement.kind == "LocalDeclaration" || statement.kind == "AssignmentStatement") return emitLocal(writer, statement, indent, path)
  writer.synthetic(indent, "indentation", [statement], [path])
  if (statement.kind == "BreakStatement" || statement.kind == "ContinueStatement") {
    writer.mapped(statement.kind == "BreakStatement" ? "break" : "next", {mappingKind: "exact", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ForEachStatement") {
    emitExpression(writer, statement.list, `${path}/list`, "ruby", identity)
    writer.mapped(".each", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "loop spacing", [statement], [path])
    writer.mapped("do", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic(" |", "iteration binding delimiter", [statement.valueBinding], [`${path}/valueBinding`])
    writer.mapped(statement.valueBinding.name, {
      mappingKind: "exact", node: statement.valueBinding, path: `${path}/valueBinding`, role: "name"
    })
    writer.synthetic("|\n", "iteration binding delimiter", [statement.valueBinding], [`${path}/valueBinding`])
    emitBlock(writer, statement.body, `${indent}  `, `${path}/body`)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("end", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ReturnStatement") {
    writer.mapped("return", {mappingKind: "anchor", node: statement, path})
    if (statement.expression) {
      writer.synthetic(" ", "return spacing", [statement], [path])
      emitExpression(writer, statement.expression, `${path}/expression`, "ruby", identity)
    }
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ExpressionStatement") {
    emitExpression(writer, statement.expression, `${path}/expression`, "ruby", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "PrintStatement") {
    writer.mapped("puts", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "print spacing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "ruby", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  writer.mapped("if", {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  emitExpression(writer, statement.condition, `${path}/condition`, "ruby", identity)
  writer.synthetic("\n", "line break", [statement], [path])
  emitBlock(writer, statement.consequent, `${indent}  `, `${path}/consequent`)
  if (statement.alternate) {
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("else", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.alternate, `${indent}  `, `${path}/alternate`)
  }
  writer.synthetic(indent, "indentation", [statement], [path])
  writer.mapped("end", {mappingKind: "anchor", node: statement, path})
  writer.synthetic("\n", "line break", [statement], [path])
}

/**
 * Emits one Ruby local statement with exact Semantifold profile metadata.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").LocalStatement} statement - Local statement.
 * @param {string} indent - Leading indentation.
 * @param {string} statementPath - Exact JSON Pointer for this statement occurrence.
 * @returns {void}
 */
function emitLocal(writer, statement, indent, statementPath) {
  writer.synthetic(indent, "indentation", [statement], [statementPath])

  if (statement.kind == "AssignmentStatement") {
    writer.mapped(statement.target.name, {mappingKind: "exact", node: statement.target, path: `${statementPath}/target`, role: "name"})
    writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
    writer.mapped("=", {mappingKind: "exact", node: statement, path: statementPath, role: "operator"})
    writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
    emitExpression(writer, statement.expression, `${statementPath}/expression`, "ruby", identity)
    writer.synthetic("\n", "line break", [statement], [statementPath])
    return
  }

  writer.synthetic("# @type [", "Ruby local type scaffolding", [statement], [statementPath])
  emitType(writer, statement.type, `${statementPath}/type`, "ruby")
  writer.synthetic("]\n", "Ruby local type scaffolding", [statement], [statementPath])
  if (!statement.mutable) {
    writer.synthetic(`${indent}# @semantifold-immutable\n`, "Ruby immutability scaffolding", [statement], [statementPath])
  }
  writer.synthetic(indent, "indentation", [statement], [statementPath])
  writer.mapped(statement.name, {mappingKind: "exact", node: statement, path: statementPath, role: "name"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  writer.mapped("=", {mappingKind: "exact", node: statement, path: statementPath, role: "operator"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  emitExpression(writer, statement.initializer, `${statementPath}/initializer`, "ruby", identity)
  writer.synthetic("\n", "line break", [statement], [statementPath])
}

/**
 * Returns an unchanged Ruby identifier.
 * @param {string} name - Identifier.
 * @returns {string} Identifier.
 */
function identity(name) {
  return name
}
