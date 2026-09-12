// @ts-check

import {emitExpression, emitType} from "./shared.js"

/**
 * Emits an independently executable PHP program through the source-aware writer.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @returns {void}
 */
export function generatePhp(module, writer) {
  if (writer.program) emitProgramHeader(module, writer)
  else writer.synthetic("<?php\ndeclare(strict_types=1);\n\n", "PHP program scaffolding", [module])
  const records = module.records ?? []
  const errors = module.errors ?? []

  errors.forEach((error, index) => {
    const path = `/errors/${index}`

    if (index > 0) writer.synthetic("\n\n", "error declaration separator", [error], [path])
    writer.mapped("final class", {mappingKind: "anchor", node: error, path})
    writer.synthetic(" ", "error declaration spacing", [error], [path])
    writer.mapped(error.name, {mappingKind: "exact", node: error, path, role: "name"})
    writer.synthetic(writer.program ? " extends \\RuntimeException {}" : " extends RuntimeException {}",
      "PHP unchecked error scaffolding", [error], [path])
  })
  if (errors.length > 0) writer.synthetic("\n\n", "error/declaration separator", [module])

  records.forEach((record, recordIndex) => {
    const recordPath = `/records/${recordIndex}`

    if (recordIndex > 0) writer.synthetic("\n\n", "record declaration separator", [record], [recordPath])
    emitTemplateDocumentation(writer, record.typeParameters ?? [], `${recordPath}/typeParameters`)
    if ((record.typeParameters?.length ?? 0) > 0) {
      emitDocumentedGenericRecord(writer, record, recordPath)
      return
    }
    writer.mapped("final readonly class", {mappingKind: "anchor", node: record, path: recordPath})
    writer.synthetic(" ", "record declaration spacing", [record], [recordPath])
    writer.mapped(record.name, {mappingKind: "exact", node: record, path: recordPath, role: "name"})
    writer.synthetic(" {\n", "record class scaffolding", [record], [recordPath])
    const documented = record.fields.filter((field) => phpTypeNeedsDocumentation(field.type))

    if (documented.length > 0) {
      writer.synthetic("    /**\n", "PHP record type scaffolding", [record], [recordPath])
      for (const field of documented) {
        const fieldIndex = record.fields.indexOf(field)
        const fieldPath = `${recordPath}/fields/${fieldIndex}`

        writer.synthetic("     * @param ", "PHP record type scaffolding", [field], [fieldPath])
        emitType(writer, field.type, `${fieldPath}/type`, "php")
        writer.synthetic(" ", "PHP record type scaffolding", [field], [fieldPath])
        writer.mapped(`$${field.name}`, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
        writer.synthetic("\n", "PHP record type scaffolding", [field], [fieldPath])
      }
      writer.synthetic("     */\n", "PHP record type scaffolding", [record], [recordPath])
    }
    writer.synthetic("    public function __construct(\n", "PHP record constructor scaffolding", [record], [recordPath])
    record.fields.forEach((field, fieldIndex) => {
      const fieldPath = `${recordPath}/fields/${fieldIndex}`

      writer.synthetic("        public ", "PHP promoted field scaffolding", [field], [fieldPath])
      emitNativePhpType(writer, field.type, `${fieldPath}/type`)
      if (hasNativePhpType(field.type)) writer.synthetic(" ", "PHP promoted field spacing", [field], [fieldPath])
      writer.mapped(`$${field.name}`, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
      writer.synthetic(fieldIndex + 1 == record.fields.length ? "\n" : ",\n", "PHP promoted field separator", [field], [fieldPath])
    })
    writer.synthetic("    ) {}\n}", "PHP record constructor scaffolding", [record], [recordPath])
  })
  if (records.length > 0) writer.synthetic("\n\n", "record/function separator", [module])

  module.functions.forEach((declaration, functionIndex) => {
    if (functionIndex > 0) writer.synthetic("\n\n", "declaration separator", [declaration])

    const documentedParameters = declaration.parameters.map((parameter, index) => [parameter, index])
      .filter(([parameter]) => phpTypeNeedsDocumentation(/** @type {import("../semantic/types.js").Parameter} */ (parameter).type))
    const documentedReturn = phpTypeNeedsDocumentation(declaration.returnType)

    if ((declaration.typeParameters?.length ?? 0) > 0 || documentedParameters.length > 0 || documentedReturn) {
      writer.synthetic("/**\n", "PHP collection type scaffolding", [declaration])
      for (const [parameterIndex, parameter] of (declaration.typeParameters ?? []).entries()) {
        writer.synthetic(" * @template ", "PHP type parameter scaffolding", [parameter], [`/functions/${functionIndex}/typeParameters/${parameterIndex}`])
        writer.mapped(parameter.name, {
          mappingKind: "exact", node: parameter, path: `/functions/${functionIndex}/typeParameters/${parameterIndex}`, role: "name"
        })
        writer.synthetic("\n", "line break", [parameter])
      }
      for (const [candidate, index] of documentedParameters) {
        const parameter = /** @type {import("../semantic/types.js").Parameter} */ (candidate)
        const parameterIndex = /** @type {number} */ (index)
        const parameterPath = `/functions/${functionIndex}/parameters/${parameterIndex}`

        writer.synthetic(" * @param ", "PHP collection type scaffolding", [parameter], [parameterPath])
        emitType(writer, parameter.type, `${parameterPath}/type`, "php")
        writer.synthetic(" ", "PHP collection type scaffolding", [parameter], [parameterPath])
        writer.mapped(`$${parameter.name}`, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
        writer.synthetic("\n", "PHP collection type scaffolding", [parameter], [parameterPath])
      }
      if (documentedReturn) {
        writer.synthetic(" * @return ", "PHP collection type scaffolding", [declaration])
        emitType(writer, declaration.returnType, `/functions/${functionIndex}/returnType`, "php")
        writer.synthetic("\n", "PHP collection type scaffolding", [declaration])
      }
      writer.synthetic(" */\n", "PHP collection type scaffolding", [declaration])
    }
    writer.mapped("function", {mappingKind: "anchor", node: declaration})
    writer.synthetic(" ", "function spacing", [declaration])
    writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, role: "name"})
    writer.mapped("(", {mappingKind: "anchor", node: declaration})
    declaration.parameters.forEach((parameter, index) => {
      const parameterPath = `/functions/${functionIndex}/parameters/${index}`

      if (index > 0) writer.synthetic(", ", "parameter separator", [declaration])
      emitNativePhpType(writer, parameter.type, `${parameterPath}/type`)
      if (hasNativePhpType(parameter.type)) writer.synthetic(" ", "parameter spacing", [parameter], [parameterPath])
      writer.mapped(`$${parameter.name}`, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
    })
    writer.mapped(")", {mappingKind: "anchor", node: declaration})
    if (hasNativePhpType(declaration.returnType)) {
      writer.synthetic(": ", "return type separator", [declaration])
      emitNativePhpType(writer, declaration.returnType, `/functions/${functionIndex}/returnType`)
    }
    writer.synthetic("\n", "line break", [declaration])
    writer.mapped("{", {mappingKind: "anchor", node: declaration})
    writer.synthetic("\n", "line break", [declaration])

    emitBlock(writer, declaration.body, "    ", `/functions/${functionIndex}/body`)
    writer.mapped("}", {mappingKind: "anchor", node: declaration})
  })

  if (!writer.program || writer.isProgramEntry()) {
    writer.synthetic("\n\n", "entry-point separator", [module.entryPoint])
    emitBlock(writer, module.entryPoint.body, "", "/entryPoint/body")
  }
}

/**
 * Emits PHP's exact documented generic-record profile. Private promoted storage
 * plus public getters preserves record immutability when a type variable has no
 * faithful native property type.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").RecordDeclaration} record - Generic semantic record.
 * @param {string} recordPath - Exact record path.
 */
function emitDocumentedGenericRecord(writer, record, recordPath) {
  writer.mapped("final class", {mappingKind: "anchor", node: record, path: recordPath})
  writer.synthetic(" ", "record declaration spacing", [record], [recordPath])
  writer.mapped(record.name, {mappingKind: "exact", node: record, path: recordPath, role: "name"})
  writer.synthetic(" {\n    /**\n", "PHP documented generic record scaffolding", [record], [recordPath])
  record.fields.forEach((field, fieldIndex) => {
    const fieldPath = `${recordPath}/fields/${fieldIndex}`

    writer.synthetic("     * @param ", "PHP documented generic record scaffolding", [field], [fieldPath])
    emitType(writer, field.type, `${fieldPath}/type`, "php")
    writer.synthetic(" ", "PHP documented generic record scaffolding", [field], [fieldPath])
    writer.mapped(`$${field.name}`, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
    writer.synthetic("\n", "PHP documented generic record scaffolding", [field], [fieldPath])
  })
  writer.synthetic("     */\n    public function __construct(\n", "PHP documented generic record scaffolding", [record], [recordPath])
  record.fields.forEach((field, fieldIndex) => {
    const fieldPath = `${recordPath}/fields/${fieldIndex}`

    writer.synthetic("        private ", "PHP private promoted field scaffolding", [field], [fieldPath])
    emitNativePhpType(writer, field.type, `${fieldPath}/type`)
    if (hasNativePhpType(field.type)) writer.synthetic(" ", "PHP promoted field spacing", [field], [fieldPath])
    writer.mapped(`$${field.name}`, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
    writer.synthetic(fieldIndex + 1 == record.fields.length ? "\n" : ",\n", "PHP promoted field separator", [field], [fieldPath])
  })
  writer.synthetic("    ) {}", "PHP documented generic record scaffolding", [record], [recordPath])
  record.fields.forEach((field, fieldIndex) => {
    const fieldPath = `${recordPath}/fields/${fieldIndex}`

    writer.synthetic("\n\n    /**\n     * @return ", "PHP documented generic getter scaffolding", [field], [fieldPath])
    emitType(writer, field.type, `${fieldPath}/type`, "php")
    writer.synthetic("\n     */\n    public function ", "PHP documented generic getter scaffolding", [field], [fieldPath])
    writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
    writer.synthetic("()", "PHP documented generic getter scaffolding", [field], [fieldPath])
    if (hasNativePhpType(field.type)) {
      writer.synthetic(": ", "PHP getter return type spacing", [field], [fieldPath])
      emitNativePhpType(writer, field.type, `${fieldPath}/type`)
    }
    writer.synthetic(" {\n        return $this->", "PHP documented generic getter scaffolding", [field], [fieldPath])
    writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
    writer.synthetic(";\n    }", "PHP documented generic getter scaffolding", [field], [fieldPath])
  })
  writer.synthetic("\n}", "PHP documented generic record scaffolding", [record], [recordPath])
}

/**
 * Emits a standalone PHPDoc template block.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").TypeParameter[]} parameters - Ordered type parameters.
 * @param {string} path - Type-parameter collection path.
 */
function emitTemplateDocumentation(writer, parameters, path) {
  if (parameters.length == 0) return
  writer.synthetic("/**\n", "PHP type parameter scaffolding", parameters)
  parameters.forEach((parameter, index) => {
    writer.synthetic(" * @template ", "PHP type parameter scaffolding", [parameter], [`${path}/${index}`])
    writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: `${path}/${index}`, role: "name"})
    writer.synthetic("\n", "line break", [parameter])
  })
  writer.synthetic(" */\n", "PHP type parameter scaffolding", parameters)
}

/**
 * Emits one canonical namespace, explicit imports, and matching literal load edges.
 * @param {import("../semantic/types.js").SemanticModule} module - Current program module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 */
function emitProgramHeader(module, writer) {
  const programModule = /** @type {import("../semantic/types.js").SemanticProgramModule} */ (/** @type {unknown} */ (module))

  writer.synthetic(`<?php\ndeclare(strict_types=1);\nnamespace Semantifold\\Generated\\${writer.programModuleName(programModule.id)};\n`,
    "PHP semantic namespace", [module])
  for (const imported of programModule.imports) {
    const dependency = writer.programModuleName(imported.moduleId)
    const prefix = imported.symbolKind == "function" ? "use function" : "use"
    const importPath = `/imports/${programModule.imports.indexOf(imported)}`
    const localName = writer.importNameFor(imported)

    writer.synthetic(`${prefix} Semantifold\\Generated\\${dependency}\\`, "PHP semantic import", [imported], [importPath])
    writer.mapped(imported.importedName, {mappingKind: "exact", node: imported, path: importPath, role: "importedName"})
    if (localName != imported.importedName) {
      writer.synthetic(" as ", "PHP semantic import alias", [imported], [importPath])
      writer.mapped(localName, {mappingKind: "exact", node: imported, path: importPath, role: "localName"})
    }
    writer.synthetic(";\n", "PHP semantic import terminator", [imported], [importPath])
  }
  for (const moduleId of [...new Set(programModule.imports.map((item) => item.moduleId))]) {
    const relative = writer.relativeModuleSpecifier(moduleId).replace(/^\.\//u, "")
    const imported = /** @type {import("../semantic/types.js").SemanticImport} */ (
      programModule.imports.find((item) => item.moduleId == moduleId))
    const importPath = `/imports/${programModule.imports.indexOf(imported)}`

    writer.synthetic("require_once __DIR__ . ", "PHP require-once edge", [imported], [importPath])
    writer.mapped(JSON.stringify(`/${relative}`), {mappingKind: "anchor", node: imported, path: importPath, role: "path"})
    writer.synthetic(";\n", "PHP require-once terminator", [imported], [importPath])
  }
  writer.synthetic("\n", "PHP namespace/declaration separator", [module])
}

/**
 * Returns whether a PHP native type needs an accompanying recursive PHPDoc type.
 * @param {import("../semantic/types.js").SemanticFunctionReturnType} type - Semantic type.
 * @returns {boolean} Whether the type contains a collection.
 */
function phpTypeNeedsDocumentation(type) {
  return type.kind == "TypeVariableReference" || type.kind == "ListType" || type.kind == "MapType" ||
    type.kind == "RecordType" && (type.arguments?.length ?? 0) > 0 ||
    type.kind == "OptionalType" && phpTypeNeedsDocumentation(type.valueType)
}

/**
 * Emits the exact native PHP carrier while retaining recursive type mappings.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").SemanticFunctionReturnType} type - Semantic type.
 * @param {string} path - Exact type occurrence path.
 * @returns {void}
 */
function emitNativePhpType(writer, type, path) {
  if (type.kind == "TypeVariableReference") return
  if (type.kind == "RecordType") {
    const record = writer.recordForId(type.declarationId)

    writer.mapped(writer.recordNameForId(type.declarationId), {
      mappingKind: "exact", name: record.name, node: type, path, role: "type"
    })
    return
  }
  if (type.kind == "TypeReference") {
    emitType(writer, type, path, "php")
    return
  }
  if (type.kind == "OptionalType") {
    writer.mapped("?", {mappingKind: "exact", node: type, path, role: "type"})
    if (type.valueType.kind == "RecordType") emitNativePhpType(writer, type.valueType, `${path}/valueType`)
    else if (type.valueType.kind == "TypeReference") emitType(writer, type.valueType, `${path}/valueType`, "php")
    else writer.mapped("array", {mappingKind: "anchor", node: type, path})
    return
  }

  writer.mapped("array", {mappingKind: "exact", node: type, path, role: "type"})
}

/**
 * Returns whether PHP has a faithful native carrier for one exact semantic type.
 * @param {import("../semantic/types.js").SemanticFunctionReturnType} type - Semantic type.
 * @returns {boolean} Whether a native annotation can be emitted.
 */
function hasNativePhpType(type) {
  return type.kind != "TypeVariableReference" &&
    !(type.kind == "OptionalType" && type.valueType.kind == "TypeVariableReference")
}

/**
 * Emits one ordered PHP block body.
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
 * Emits one PHP statement.
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
    writer.mapped(statement.kind == "BreakStatement" ? "break" : "continue", {mappingKind: "exact", node: statement, path})
    writer.mapped(";", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ForEachStatement") {
    writer.mapped("foreach", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" (", "loop scaffolding", [statement], [path])
    emitExpression(writer, statement.list, `${path}/list`, "php", phpIdentifier)
    writer.synthetic(" as ", "loop scaffolding", [statement], [path])
    writer.mapped(`$${statement.valueBinding.name}`, {
      mappingKind: "exact", node: statement.valueBinding, path: `${path}/valueBinding`, role: "name"
    })
    writer.synthetic(") ", "loop scaffolding", [statement], [path])
    writer.mapped("{", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.body, `${indent}    `, `${path}/body`)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "RaiseStatement") {
    const type = statement.error.error
    const error = writer.errorForId(type.declarationId)

    writer.mapped("throw", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" new ", "error construction scaffolding", [statement.error], [`${path}/error`])
    writer.mapped(writer.errorNameForId(type.declarationId), {mappingKind: "exact", name: error.name, node: statement.error, path: `${path}/error`, role: "type"})
    writer.synthetic("(", "error construction open", [statement.error], [`${path}/error`])
    emitExpression(writer, statement.error.message, `${path}/error/message`, "php", phpIdentifier)
    writer.synthetic(");\n", "error construction close", [statement.error], [`${path}/error`])
    return
  }
  if (statement.kind == "TryStatement") {
    const caught = writer.errorForId(statement.catchType.declarationId)

    writer.mapped("try", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "try spacing", [statement], [path])
    writer.mapped("{", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.body, `${indent}    `, `${path}/body`)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic(" ", "catch spacing", [statement], [path])
    writer.mapped("catch", {mappingKind: "anchor", node: statement, path, role: "catch"})
    writer.synthetic(" (", "catch binding scaffolding", [statement.catchBinding], [`${path}/catchBinding`])
    writer.mapped(writer.errorNameForId(statement.catchType.declarationId), {mappingKind: "exact", name: caught.name, node: statement.catchType, path: `${path}/catchType`, role: "type"})
    writer.synthetic(" ", "catch binding spacing", [statement.catchBinding], [`${path}/catchBinding`])
    writer.mapped(`$${statement.catchBinding.name}`, {mappingKind: "exact", node: statement.catchBinding, path: `${path}/catchBinding`, role: "name"})
    writer.synthetic(") ", "catch binding scaffolding", [statement.catchBinding], [`${path}/catchBinding`])
    writer.mapped("{", {mappingKind: "anchor", node: statement.catchBody, path: `${path}/catchBody`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.catchBody, `${indent}    `, `${path}/catchBody`)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.catchBody, path: `${path}/catchBody`})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ReturnStatement") {
    writer.mapped("return", {mappingKind: "anchor", node: statement, path})
    if (statement.expression) {
      writer.synthetic(" ", "return spacing", [statement], [path])
      emitExpression(writer, statement.expression, `${path}/expression`, "php", phpIdentifier)
    }
    writer.mapped(";", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ExpressionStatement") {
    emitExpression(writer, statement.expression, `${path}/expression`, "php", phpIdentifier)
    writer.mapped(";", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "PrintStatement") {
    writer.mapped("echo", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "print spacing", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "php", phpIdentifier)
    writer.synthetic(", ", "PHP print separator", [statement], [path])
    writer.mapped("PHP_EOL", {mappingKind: "anchor", node: statement, path})
    writer.mapped(";", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  writer.mapped("if", {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  writer.mapped("(", {mappingKind: "anchor", node: statement, path})
  emitExpression(writer, statement.condition, `${path}/condition`, "php", phpIdentifier)
  writer.mapped(")", {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  writer.mapped("{", {mappingKind: "anchor", node: statement.consequent, path: `${path}/consequent`})
  writer.synthetic("\n", "line break", [statement], [path])
  emitBlock(writer, statement.consequent, `${indent}    `, `${path}/consequent`)
  writer.synthetic(indent, "indentation", [statement], [path])
  writer.mapped("}", {mappingKind: "anchor", node: statement.consequent, path: `${path}/consequent`})
  if (statement.alternate) {
    writer.synthetic(" ", "conditional spacing", [statement], [path])
    writer.mapped("else", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "conditional spacing", [statement], [path])
    writer.mapped("{", {mappingKind: "anchor", node: statement.alternate, path: `${path}/alternate`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.alternate, `${indent}    `, `${path}/alternate`)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.alternate, path: `${path}/alternate`})
  }
  writer.synthetic("\n", "line break", [statement], [path])
}

/**
 * Emits one PHP local statement with its exact Semantifold profile metadata.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").LocalStatement} statement - Local statement.
 * @param {string} indent - Leading indentation.
 * @param {string} statementPath - Exact JSON Pointer for this statement occurrence.
 * @returns {void}
 */
function emitLocal(writer, statement, indent, statementPath) {
  writer.synthetic(indent, "indentation", [statement], [statementPath])

  if (statement.kind == "AssignmentStatement") {
    writer.mapped(`$${statement.target.name}`, {mappingKind: "exact", node: statement.target, path: `${statementPath}/target`, role: "name"})
    writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
    writer.mapped("=", {mappingKind: "exact", node: statement, path: statementPath, role: "operator"})
    writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
    emitExpression(writer, statement.expression, `${statementPath}/expression`, "php", phpIdentifier)
    writer.mapped(";", {mappingKind: "anchor", node: statement, path: statementPath})
    writer.synthetic("\n", "line break", [statement], [statementPath])
    return
  }

  if (statement.mutable) {
    writer.synthetic("/** @var ", "PHP local type scaffolding", [statement], [statementPath])
    emitType(writer, statement.type, `${statementPath}/type`, "php")
    writer.synthetic(" ", "PHP local type scaffolding", [statement], [statementPath])
    writer.mapped(`$${statement.name}`, {mappingKind: "exact", node: statement, path: statementPath, role: "name"})
    writer.synthetic(" */\n", "PHP local type scaffolding", [statement], [statementPath])
  } else {
    writer.synthetic("/**\n", "PHP local type scaffolding", [statement], [statementPath])
    writer.synthetic(`${indent} * @var `, "PHP local type scaffolding", [statement], [statementPath])
    emitType(writer, statement.type, `${statementPath}/type`, "php")
    writer.synthetic(" ", "PHP local type scaffolding", [statement], [statementPath])
    writer.mapped(`$${statement.name}`, {mappingKind: "exact", node: statement, path: statementPath, role: "name"})
    writer.synthetic(`\n${indent} * @semantifold-immutable\n${indent} */\n`, "PHP local type scaffolding", [statement], [statementPath])
  }

  writer.synthetic(indent, "indentation", [statement], [statementPath])
  writer.mapped(`$${statement.name}`, {mappingKind: "exact", node: statement, path: statementPath, role: "name"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  writer.mapped("=", {mappingKind: "exact", node: statement, path: statementPath, role: "operator"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  emitExpression(writer, statement.initializer, `${statementPath}/initializer`, "php", phpIdentifier)
  writer.mapped(";", {mappingKind: "anchor", node: statement, path: statementPath})
  writer.synthetic("\n", "line break", [statement], [statementPath])
}

/**
 * Formats one PHP variable identifier.
 * @param {string} name - Semantic identifier.
 * @returns {string} PHP identifier.
 */
function phpIdentifier(name) {
  return `$${name}`
}
