// @ts-check

import {emitExpression, emitType, requiresCanonicalZeroRendering} from "./shared.js"

/**
 * Emits an independently executable TypeScript program through the source-aware writer.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @returns {void}
 */
export function generateTypeScript(module, writer) {
  const canonicalizeZero = requiresCanonicalZeroRendering(module)
  const records = module.records ?? []

  emitProgramImports(module, writer)

  records.forEach((record, recordIndex) => {
    const recordPath = `/records/${recordIndex}`

    if (recordIndex > 0) writer.synthetic("\n\n", "record declaration separator", [record], [recordPath])
    if (writer.isDirectlyExported(record.id)) writer.synthetic("export ", "ESM record export", [record], [recordPath])
    writer.mapped("class", {mappingKind: "anchor", node: record, path: recordPath})
    writer.synthetic(" ", "record declaration spacing", [record], [recordPath])
    writer.mapped(record.name, {mappingKind: "exact", node: record, path: recordPath, role: "name"})
    writer.synthetic(" {\n  constructor(", "TypeScript record constructor scaffolding", [record], [recordPath])
    record.fields.forEach((field, fieldIndex) => {
      const fieldPath = `${recordPath}/fields/${fieldIndex}`

      if (fieldIndex) writer.synthetic(", ", "record field separator", [record], [recordPath])
      writer.synthetic("readonly ", "TypeScript readonly field scaffolding", [field], [fieldPath])
      writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
      writer.synthetic(": ", "type separator", [field], [fieldPath])
      emitType(writer, field.type, `${fieldPath}/type`, "typescript")
    })
    writer.synthetic(") {}\n}", "TypeScript record constructor scaffolding", [record], [recordPath])
  })
  if (records.length > 0) writer.synthetic("\n\n", "record/function separator", [module])

  module.functions.forEach((declaration, functionIndex) => {
    if (functionIndex > 0) writer.synthetic("\n\n", "declaration separator", [declaration])

    if (writer.isDirectlyExported(declaration.id)) writer.synthetic("export ", "ESM function export", [declaration])
    writer.mapped("function", {mappingKind: "anchor", node: declaration})
    writer.synthetic(" ", "function spacing", [declaration])
    writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, role: "name"})
    writer.mapped("(", {mappingKind: "anchor", node: declaration})
    declaration.parameters.forEach((parameter, index) => {
      const parameterPath = `/functions/${functionIndex}/parameters/${index}`

      if (index > 0) writer.synthetic(", ", "parameter separator", [declaration])
      writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
      writer.synthetic(": ", "type separator", [parameter], [parameterPath])
      emitType(writer, parameter.type, `${parameterPath}/type`, "typescript")
    })
    writer.mapped(")", {mappingKind: "anchor", node: declaration})
    writer.synthetic(": ", "return type separator", [declaration])
    emitType(writer, declaration.returnType, `/functions/${functionIndex}/returnType`, "typescript")
    writer.synthetic(" ", "function spacing", [declaration])
    writer.mapped("{", {mappingKind: "anchor", node: declaration})
    writer.synthetic("\n", "line break", [declaration])

    emitBlock(writer, declaration.body, "  ", `/functions/${functionIndex}/body`, canonicalizeZero)
    writer.mapped("}", {mappingKind: "anchor", node: declaration})
  })

  emitAliasedExports(module, writer)
  if (!writer.program || writer.isProgramEntry()) {
    writer.synthetic("\n\n", "entry-point separator", [module.entryPoint])
    emitBlock(writer, module.entryPoint.body, "", "/entryPoint/body", canonicalizeZero)
  }
}

/**
 * Emits grouped value and type-only ESM imports for a program module.
 * @param {import("../semantic/types.js").SemanticModule} module - Current module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 */
function emitProgramImports(module, writer) {
  if (!writer.program) return
  const imports = /** @type {import("../semantic/types.js").SemanticProgramModule} */ (/** @type {unknown} */ (module)).imports
  const groups = []

  for (const moduleId of [...new Set(imports.map((item) => item.moduleId))]) {
    const selected = imports.filter((item) => item.moduleId == moduleId)
    const typeOnly = selected.filter((item) => item.typeOnly)
    const values = selected.filter((item) => !item.typeOnly)

    if (typeOnly.length > 0) groups.push({items: typeOnly, moduleId, typeOnly: true})
    if (values.length > 0) groups.push({items: values, moduleId, typeOnly: false})
  }
  for (const group of groups) {
    writer.synthetic(group.typeOnly ? "import type {" : "import {", "TypeScript ESM import declaration", group.items)
    group.items.forEach((item, index) => {
      const itemPath = `/imports/${imports.indexOf(item)}`
      const localName = writer.importNameFor(item)

      if (index) writer.synthetic(", ", "ESM import separator", group.items)
      writer.mapped(item.importedName, {mappingKind: "exact", node: item, path: itemPath, role: "importedName"})
      if (localName != item.importedName) {
        writer.synthetic(" as ", "ESM import alias", [item], [itemPath])
        writer.mapped(localName, {mappingKind: "exact", node: item, path: itemPath, role: "localName"})
      }
    })
    writer.synthetic("} from ", "ESM import source", group.items)
    writer.mapped(JSON.stringify(writer.relativeModuleSpecifier(group.moduleId, ".js")), {
      mappingKind: "anchor", node: group.items[0], path: `/imports/${imports.indexOf(group.items[0])}`, role: "path"
    })
    writer.synthetic("\n", "ESM import terminator", group.items)
  }
  if (groups.length > 0) writer.synthetic("\n", "ESM import separator", [module])
}

/**
 * Emits explicit ESM export clauses for source aliases.
 * @param {import("../semantic/types.js").SemanticModule} module - Current module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 */
function emitAliasedExports(module, writer) {
  if (!writer.program) return
  const programModule = /** @type {import("../semantic/types.js").SemanticProgramModule} */ (/** @type {unknown} */ (module))
  const aliases = programModule.exports.filter((item) => !writer.isDirectlyExported(item.declarationId))

  if (aliases.length == 0) return
  writer.synthetic("\n\nexport {", "ESM aliased exports", [module])
  aliases.forEach((item, index) => {
    if (index) writer.synthetic(", ", "ESM export separator", [module])
    const declaration = [...programModule.functions, ...(programModule.records ?? [])].find(({id}) => id == item.declarationId)

    if (!declaration) throw new RangeError(`Unknown exported declaration '${item.declarationId}'.`)
    const exportPath = `/exports/${programModule.exports.indexOf(item)}`

    writer.mapped(declaration.name, {mappingKind: "exact", name: declaration.name, node: item, path: exportPath, role: "localName"})
    writer.synthetic(" as ", "ESM aliased export operator", [item], [exportPath])
    writer.mapped(item.exportedName, {mappingKind: "exact", name: item.exportedName, node: item, path: exportPath, role: "exportedName"})
  })
  writer.synthetic("}", "ESM aliased export close", [module])
}

/**
 * Emits one ordered TypeScript block body.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Block} block - Semantic block.
 * @param {string} indent - Indentation.
 * @param {string} path - Exact block path.
 * @param {boolean} canonicalizeZero - Whether printed integer zero must be canonicalized.
 * @returns {void}
 */
function emitBlock(writer, block, indent, path, canonicalizeZero) {
  block.statements.forEach((statement, index) => emitStatement(writer, statement, indent, `${path}/statements/${index}`, canonicalizeZero))
}

/**
 * Emits one TypeScript statement.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Statement} statement - Semantic statement.
 * @param {string} indent - Indentation.
 * @param {string} path - Exact statement path.
 * @param {boolean} canonicalizeZero - Whether printed integer zero must be canonicalized.
 * @returns {void}
 */
function emitStatement(writer, statement, indent, path, canonicalizeZero) {
  if (statement.kind == "LocalDeclaration" || statement.kind == "AssignmentStatement") {
    emitLocal(writer, statement, indent, path)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  writer.synthetic(indent, "indentation", [statement], [path])
  if (statement.kind == "BreakStatement" || statement.kind == "ContinueStatement") {
    writer.mapped(statement.kind == "BreakStatement" ? "break" : "continue", {mappingKind: "exact", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ForEachStatement") {
    writer.mapped("for", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" (const ", "loop scaffolding", [statement], [path])
    writer.mapped(statement.valueBinding.name, {
      mappingKind: "exact", node: statement.valueBinding, path: `${path}/valueBinding`, role: "name"
    })
    writer.synthetic(" of ", "loop scaffolding", [statement], [path])
    emitExpression(writer, statement.list, `${path}/list`, "typescript", identity)
    writer.synthetic(") ", "loop scaffolding", [statement], [path])
    writer.mapped("{", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.body, `${indent}  `, `${path}/body`, canonicalizeZero)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ReturnStatement") {
    writer.mapped("return", {mappingKind: "anchor", node: statement, path})
    if (statement.expression) {
      writer.synthetic(" ", "return spacing", [statement], [path])
      emitExpression(writer, statement.expression, `${path}/expression`, "typescript", identity)
    }
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ExpressionStatement") {
    emitExpression(writer, statement.expression, `${path}/expression`, "typescript", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "PrintStatement") {
    writer.mapped("console.log", {mappingKind: "anchor", node: statement, path})
    writer.mapped("(", {mappingKind: "anchor", node: statement, path})
    if (canonicalizeZero) writer.synthetic("(", "canonical integer output", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "typescript", identity)
    if (canonicalizeZero) writer.synthetic(").toString()", "canonical integer output", [statement], [path])
    writer.mapped(")", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  writer.mapped("if", {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  writer.mapped("(", {mappingKind: "anchor", node: statement, path})
  emitExpression(writer, statement.condition, `${path}/condition`, "typescript", identity)
  writer.mapped(")", {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  writer.mapped("{", {mappingKind: "anchor", node: statement.consequent, path: `${path}/consequent`})
  writer.synthetic("\n", "line break", [statement], [path])
  emitBlock(writer, statement.consequent, `${indent}  `, `${path}/consequent`, canonicalizeZero)
  writer.synthetic(indent, "indentation", [statement], [path])
  writer.mapped("}", {mappingKind: "anchor", node: statement.consequent, path: `${path}/consequent`})
  if (statement.alternate) {
    writer.synthetic(" ", "conditional spacing", [statement], [path])
    writer.mapped("else", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "conditional spacing", [statement], [path])
    writer.mapped("{", {mappingKind: "anchor", node: statement.alternate, path: `${path}/alternate`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.alternate, `${indent}  `, `${path}/alternate`, canonicalizeZero)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.alternate, path: `${path}/alternate`})
  }
  writer.synthetic("\n", "line break", [statement], [path])
}

/**
 * Emits one TypeScript local statement.
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
    emitExpression(writer, statement.expression, `${statementPath}/expression`, "typescript", identity)
    return
  }

  writer.mapped(statement.mutable ? "let" : "const", {mappingKind: "anchor", node: statement, path: statementPath})
  writer.synthetic(" ", "declaration spacing", [statement], [statementPath])
  writer.mapped(statement.name, {mappingKind: "exact", node: statement, path: statementPath, role: "name"})
  writer.synthetic(": ", "type separator", [statement], [statementPath])
  emitType(writer, statement.type, `${statementPath}/type`, "typescript")
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  writer.mapped("=", {mappingKind: "exact", node: statement, path: statementPath, role: "operator"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  emitExpression(writer, statement.initializer, `${statementPath}/initializer`, "typescript", identity)
}

/**
 * Returns an unchanged TypeScript identifier.
 * @param {string} name - Identifier.
 * @returns {string} Identifier.
 */
function identity(name) {
  return name
}
