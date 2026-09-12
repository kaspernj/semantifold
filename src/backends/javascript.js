// @ts-check

import {emitExpression, emitType, requiresCanonicalZeroRendering} from "./shared.js"
import {emitEffectPrefixes, emitEffectSupport} from "./effects.js"

/**
 * Emits an independently executable JavaScript program with JSDoc types.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @returns {void}
 */
export function generateJavaScript(module, writer) {
  const canonicalizeZero = requiresCanonicalZeroRendering(module)
  const records = module.records ?? []
  const classes = module.classes ?? []
  const errors = module.errors ?? []

  emitProgramImports(module, writer)
  emitEffectSupport(writer, module, "javascript")

  errors.forEach((error, errorIndex) => {
    const path = `/errors/${errorIndex}`

    if (errorIndex > 0) writer.synthetic("\n\n", "error declaration separator", [error], [path])
    if (writer.isDirectlyExported(error.id)) writer.synthetic("export ", "ESM error export", [error], [path])
    writer.mapped("class", {mappingKind: "anchor", node: error, path})
    writer.synthetic(" ", "error declaration spacing", [error], [path])
    writer.mapped(error.name, {mappingKind: "exact", node: error, path, role: "name"})
    writer.synthetic(" extends Error {}", "JavaScript unchecked error scaffolding", [error], [path])
  })
  if (errors.length > 0) writer.synthetic("\n\n", "error/declaration separator", [module])

  records.forEach((record, recordIndex) => {
    const recordPath = `/records/${recordIndex}`

    if (recordIndex > 0) writer.synthetic("\n\n", "record declaration separator", [record], [recordPath])
    emitTemplateDocumentation(writer, record.typeParameters ?? [], `${recordPath}/typeParameters`, "JavaScript")
    if (writer.isDirectlyExported(record.id)) writer.synthetic("export ", "ESM record export", [record], [recordPath])
    writer.mapped("class", {mappingKind: "anchor", node: record, path: recordPath})
    writer.synthetic(" ", "record declaration spacing", [record], [recordPath])
    writer.mapped(record.name, {mappingKind: "exact", node: record, path: recordPath, role: "name"})
    writer.synthetic(" {\n  /**\n", "JavaScript record constructor scaffolding", [record], [recordPath])
    record.fields.forEach((field, fieldIndex) => {
      const fieldPath = `${recordPath}/fields/${fieldIndex}`

      writer.synthetic("   * @param {", "JavaScript record field type scaffolding", [field], [fieldPath])
      emitType(writer, field.type, `${fieldPath}/type`, "javascript")
      writer.synthetic("} ", "JavaScript record field type scaffolding", [field], [fieldPath])
      writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
      writer.synthetic("\n", "line break", [field], [fieldPath])
    })
    writer.synthetic("   */\n  constructor(", "JavaScript record constructor scaffolding", [record], [recordPath])
    record.fields.forEach((field, fieldIndex) => {
      if (fieldIndex) writer.synthetic(", ", "record field separator", [record], [recordPath])
      writer.mapped(field.name, {mappingKind: "exact", node: field, path: `${recordPath}/fields/${fieldIndex}`, role: "name"})
    })
    writer.synthetic(") {\n", "JavaScript record constructor scaffolding", [record], [recordPath])
    record.fields.forEach((field, fieldIndex) => {
      const fieldPath = `${recordPath}/fields/${fieldIndex}`

      writer.synthetic("    /** @readonly */\n    this.", "JavaScript readonly field scaffolding", [field], [fieldPath])
      writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
      writer.synthetic(" = ", "JavaScript record assignment scaffolding", [field], [fieldPath])
      writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
      writer.synthetic(";\n", "JavaScript record assignment terminator", [field], [fieldPath])
    })
    writer.synthetic("    ({}).constructor.freeze(this)\n  }\n}", "JavaScript record immutability scaffolding", [record], [recordPath])
  })
  if (records.length > 0) writer.synthetic("\n\n", "record/function separator", [module])

  classes.forEach((declaration, classIndex) => {
    if (classIndex > 0) writer.synthetic("\n\n", "reference class separator", [declaration], [`/classes/${classIndex}`])
    emitReferenceClass(writer, declaration, classIndex, canonicalizeZero)
  })
  if (classes.length > 0) writer.synthetic("\n\n", "reference class/function separator", [module])

  module.functions.forEach((declaration, functionIndex) => {
    if (functionIndex > 0) writer.synthetic("\n\n", "declaration separator", [declaration])

    writer.synthetic("/**\n * Generated semantic function.\n", "JavaScript type scaffolding", [declaration])
    for (const [parameterIndex, parameter] of (declaration.typeParameters ?? []).entries()) {
      writer.synthetic(" * @template ", "JavaScript type parameter scaffolding", [parameter], [`/functions/${functionIndex}/typeParameters/${parameterIndex}`])
      writer.mapped(parameter.name, {
        mappingKind: "exact", node: parameter, path: `/functions/${functionIndex}/typeParameters/${parameterIndex}`, role: "name"
      })
      writer.synthetic("\n", "line break", [parameter])
    }
    for (const [parameterIndex, parameter] of declaration.parameters.entries()) {
      const parameterPath = `/functions/${functionIndex}/parameters/${parameterIndex}`

      writer.synthetic(" * @param {", "JavaScript type scaffolding", [parameter], [parameterPath])
      emitType(writer, parameter.type, `${parameterPath}/type`, "javascript")
      writer.synthetic("} ", "JavaScript type scaffolding", [parameter], [parameterPath])
      writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
      writer.synthetic(" - Semantic parameter.\n", "JavaScript type scaffolding", [parameter], [parameterPath])
    }
    writer.synthetic(" * @returns {", "JavaScript type scaffolding", [declaration])
    emitType(writer, declaration.returnType, `/functions/${functionIndex}/returnType`, "javascript")
    writer.synthetic("} Semantic result.\n */\n", "JavaScript type scaffolding", [declaration])
    if (writer.isDirectlyExported(declaration.id)) writer.synthetic("export ", "ESM function export", [declaration])
    writer.mapped("function", {mappingKind: "anchor", node: declaration})
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
 * Emits one native JavaScript private-field reference class.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").ClassDeclaration} declaration - Reference class.
 * @param {number} classIndex - Module class index.
 * @param {boolean} canonicalizeZero - Whether scalar output canonicalizes zero.
 * @returns {void}
 */
function emitReferenceClass(writer, declaration, classIndex, canonicalizeZero) {
  const path = `/classes/${classIndex}`

  writer.mapped("class", {mappingKind: "anchor", node: declaration, path})
  writer.synthetic(" ", "reference class spacing", [declaration], [path])
  writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, path, role: "name"})
  writer.synthetic(" {\n", "reference class open", [declaration], [path])
  declaration.fields.forEach((field, index) => {
    const fieldPath = `${path}/fields/${index}`

    writer.synthetic("  /** @type {", "private field type scaffolding", [field], [fieldPath])
    emitType(writer, field.type, `${fieldPath}/type`, "javascript")
    writer.synthetic("} */\n  #", "private field scaffolding", [field], [fieldPath])
    writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
    writer.synthetic("\n", "line break", [field], [fieldPath])
  })
  const constructor = declaration.constructor
  const constructorPath = `${path}/constructor`

  emitJsdoc(writer, constructor.parameters, undefined, `${constructorPath}/parameters`, undefined)
  writer.synthetic("  ", "constructor indentation", [constructor], [constructorPath])
  writer.mapped("constructor", {mappingKind: "exact", node: constructor, path: constructorPath, role: "constructor"})
  emitBareParameters(writer, constructor.parameters, `${constructorPath}/parameters`)
  writer.synthetic(" {\n", "constructor open", [constructor], [constructorPath])
  emitBlock(writer, constructor.body, "    ", `${constructorPath}/body`, canonicalizeZero)
  writer.synthetic("  }", "constructor close", [constructor], [constructorPath])
  declaration.methods.forEach((method, index) => {
    const methodPath = `${path}/methods/${index}`

    writer.synthetic("\n\n", "method spacing", [method], [methodPath])
    emitJsdoc(writer, method.parameters, method.returnType, `${methodPath}/parameters`, `${methodPath}/returnType`)
    writer.synthetic("  ", "method indentation", [method], [methodPath])
    writer.mapped(method.name, {mappingKind: "exact", node: method, path: methodPath, role: "name"})
    emitBareParameters(writer, method.parameters, `${methodPath}/parameters`)
    writer.synthetic(" {\n", "method open", [method], [methodPath])
    emitBlock(writer, method.body, "    ", `${methodPath}/body`, canonicalizeZero)
    writer.synthetic("  }", "method close", [method], [methodPath])
  })
  writer.synthetic("\n", "line break", [declaration], [path])
  writer.mapped("}", {mappingKind: "anchor", node: declaration, path})
}

/**
 * Emits exact JavaScript callable type documentation.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Parameter[]} parameters - Ordered parameters.
 * @param {import("../semantic/types.js").SemanticFunctionReturnType | undefined} returnType - Optional return type.
 * @param {string} parameterPath - Parameter collection path.
 * @param {string | undefined} returnPath - Return type path.
 * @returns {void}
 */
function emitJsdoc(writer, parameters, returnType, parameterPath, returnPath) {
  writer.synthetic("\n  /**\n", "JavaScript callable documentation", parameters)
  for (const [index, parameter] of parameters.entries()) {
    writer.synthetic("   * @param {", "parameter type scaffolding", [parameter], [`${parameterPath}/${index}`])
    emitType(writer, parameter.type, `${parameterPath}/${index}/type`, "javascript")
    writer.synthetic("} ", "parameter documentation", [parameter], [`${parameterPath}/${index}`])
    writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: `${parameterPath}/${index}`, role: "name"})
    writer.synthetic("\n", "line break", [parameter])
  }
  if (returnType && returnPath) {
    writer.synthetic("   * @returns {", "return type scaffolding", [])
    emitType(writer, returnType, returnPath, "javascript")
    writer.synthetic("}\n", "line break", [])
  }
  writer.synthetic("   */\n", "JavaScript callable documentation close", parameters)
}

/**
 * Emits one untyped JavaScript parameter list.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Parameter[]} parameters - Ordered parameters.
 * @param {string} path - Parameter collection path.
 * @returns {void}
 */
function emitBareParameters(writer, parameters, path) {
  writer.synthetic("(", "parameter list open", parameters)
  parameters.forEach((parameter, index) => {
    if (index) writer.synthetic(", ", "parameter separator", parameters)
    writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: `${path}/${index}`, role: "name"})
  })
  writer.synthetic(")", "parameter list close", parameters)
}

/**
 * Emits a standalone JSDoc template block.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").TypeParameter[]} parameters - Ordered type parameters.
 * @param {string} path - Type-parameter collection path.
 * @param {string} target - Target label.
 */
function emitTemplateDocumentation(writer, parameters, path, target) {
  if (parameters.length == 0) return
  writer.synthetic("/**\n", `${target} type parameter scaffolding`, parameters)
  parameters.forEach((parameter, index) => {
    writer.synthetic(" * @template ", `${target} type parameter scaffolding`, [parameter], [`${path}/${index}`])
    writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: `${path}/${index}`, role: "name"})
    writer.synthetic("\n", "line break", [parameter])
  })
  writer.synthetic(" */\n", `${target} type parameter scaffolding`, parameters)
}

/**
 * Emits grouped named ESM imports for a program module.
 * @param {import("../semantic/types.js").SemanticModule} module - Current module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 */
function emitProgramImports(module, writer) {
  if (!writer.program) return
  const imports = /** @type {import("../semantic/types.js").SemanticProgramModule} */ (/** @type {unknown} */ (module)).imports
  const moduleIds = [...new Set(imports.map(({moduleId}) => moduleId))]

  for (const moduleId of moduleIds) {
    const selected = imports.filter((item) => item.moduleId == moduleId)

    writer.synthetic("import {", "ESM import declaration", selected)
    selected.forEach((item, index) => {
      const itemPath = `/imports/${imports.indexOf(item)}`
      const localName = writer.importNameFor(item)

      if (index) writer.synthetic(", ", "ESM import separator", selected)
      writer.mapped(item.importedName, {mappingKind: "exact", node: item, path: itemPath, role: "importedName"})
      if (localName != item.importedName) {
        writer.synthetic(" as ", "ESM import alias", [item], [itemPath])
        writer.mapped(localName, {mappingKind: "exact", node: item, path: itemPath, role: "localName"})
      }
    })
    writer.synthetic("} from ", "ESM import source", selected)
    writer.mapped(JSON.stringify(writer.relativeModuleSpecifier(moduleId, ".js")), {
      mappingKind: "anchor", node: selected[0], path: `/imports/${imports.indexOf(selected[0])}`, role: "path"
    })
    writer.synthetic("\n", "ESM import terminator", selected)
  }
  if (moduleIds.length > 0) writer.synthetic("\n", "ESM import separator", [module])
}

/**
 * Emits explicit ESM export clauses for source aliases.
 * @param {import("../semantic/types.js").SemanticModule} module - Current module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 */
function emitAliasedExports(module, writer) {
  if (!writer.program) return
  const programModule = /** @type {import("../semantic/types.js").SemanticProgramModule} */ (/** @type {unknown} */ (module))
  const aliases = programModule.exports.filter((item) => !writer.isDirectExport(item))

  if (aliases.length == 0) return
  writer.synthetic("\n\nexport {", "ESM aliased exports", [module])
  aliases.forEach((item, index) => {
    if (index) writer.synthetic(", ", "ESM export separator", [module])
    const declaration = [...programModule.functions, ...programModule.records ?? [], ...programModule.errors ?? []].find(({id}) => id == item.declarationId)

    if (!declaration) throw new RangeError(`Unknown exported declaration '${item.declarationId}'.`)
    const exportPath = `/exports/${programModule.exports.indexOf(item)}`

    writer.mapped(declaration.name, {mappingKind: "exact", name: declaration.name, node: item, path: exportPath, role: "localName"})
    writer.synthetic(" as ", "ESM aliased export operator", [item], [exportPath])
    writer.mapped(item.exportedName, {mappingKind: "exact", name: item.exportedName, node: item, path: exportPath, role: "exportedName"})
  })
  writer.synthetic("}", "ESM aliased export close", [module])
}

/**
 * Emits one ordered JavaScript block body.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Block} block - Semantic block.
 * @param {string} indent - Indentation.
 * @param {string} blockPath - Exact JSON Pointer for the block.
 * @param {boolean} canonicalizeZero - Whether printed integer zero must be canonicalized.
 * @returns {void}
 */
function emitBlock(writer, block, indent, blockPath, canonicalizeZero) {
  block.statements.forEach((statement, index) => emitStatement(
    writer, statement, indent, `${blockPath}/statements/${index}`, canonicalizeZero
  ))
}

/**
 * Emits one JavaScript statement.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Statement} statement - Semantic statement.
 * @param {string} indent - Indentation.
 * @param {string} path - Exact statement path.
 * @param {boolean} canonicalizeZero - Whether printed integer zero must be canonicalized.
 * @returns {void}
 */
function emitStatement(writer, statement, indent, path, canonicalizeZero) {
  emitEffectPrefixes(writer, statement, indent, path, "javascript",
    (expression, expressionPath) => emitExpression(writer, expression, expressionPath, "javascript", identity))
  if (statement.kind == "LocalDeclaration" || statement.kind == "AssignmentStatement") return emitLocal(writer, statement, indent, path)

  writer.synthetic(indent, "indentation", [statement], [path])
  if (statement.kind == "PrivateFieldWriteStatement") {
    emitExpression(writer, statement.receiver, `${path}/receiver`, "javascript", identity)
    const field = writer.privateFieldForId(statement.field)

    writer.mapped(`.#${field.name}`, {mappingKind: "exact", name: field.name, node: statement, path, role: "member"})
    writer.synthetic(" = ", "private field assignment", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "javascript", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "BreakStatement" || statement.kind == "ContinueStatement") {
    writer.mapped(statement.kind == "BreakStatement" ? "break" : "continue", {mappingKind: "exact", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "WhileStatement") {
    writer.mapped("while", {mappingKind: "exact", node: statement, path})
    writer.synthetic(" (", "condition-controlled loop spacing", [statement], [path])
    emitExpression(writer, statement.condition, `${path}/condition`, "javascript", identity)
    writer.synthetic(") ", "condition-controlled loop spacing", [statement], [path])
    writer.mapped("{", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.body, `${indent}  `, `${path}/body`, canonicalizeZero)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
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
    emitExpression(writer, statement.list, `${path}/list`, "javascript", identity)
    writer.synthetic(") ", "loop scaffolding", [statement], [path])
    writer.mapped("{", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.body, `${indent}  `, `${path}/body`, canonicalizeZero)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ForEachMapStatement") {
    writer.mapped("for", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" (const [", "map loop scaffolding", [statement], [path])
    writer.mapped(statement.keyBinding.name, {
      mappingKind: "exact", node: statement.keyBinding, path: `${path}/keyBinding`, role: "name"
    })
    writer.synthetic(", ", "map iteration binding separator", [statement], [path])
    writer.mapped(statement.valueBinding.name, {
      mappingKind: "exact", node: statement.valueBinding, path: `${path}/valueBinding`, role: "name"
    })
    writer.synthetic("] of ", "map loop scaffolding", [statement], [path])
    emitExpression(writer, statement.map, `${path}/map`, "javascript", identity)
    writer.synthetic(") ", "map loop scaffolding", [statement], [path])
    writer.mapped("{", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.body, `${indent}  `, `${path}/body`, canonicalizeZero)
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
    emitExpression(writer, statement.error.message, `${path}/error/message`, "javascript", identity)
    writer.synthetic(")\n", "error construction close", [statement.error], [`${path}/error`])
    return
  }
  if (statement.kind == "TryStatement") {
    const caught = writer.errorForId(statement.catchType.declarationId)
    const targetName = writer.errorNameForId(statement.catchType.declarationId)

    writer.mapped("try", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "try spacing", [statement], [path])
    writer.mapped("{", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.body, `${indent}  `, `${path}/body`, canonicalizeZero)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic(" ", "catch spacing", [statement], [path])
    writer.mapped("catch", {mappingKind: "anchor", node: statement, path, role: "catch"})
    writer.synthetic(" (", "catch binding scaffolding", [statement.catchBinding], [`${path}/catchBinding`])
    writer.mapped(statement.catchBinding.name, {mappingKind: "exact", node: statement.catchBinding, path: `${path}/catchBinding`, role: "name"})
    writer.synthetic(") {\n", "catch binding scaffolding", [statement.catchBinding], [`${path}/catchBinding`])
    writer.synthetic(`${indent}  if (!(`, "exact catch guard", [statement], [path])
    writer.mapped(statement.catchBinding.name, {mappingKind: "exact", node: statement.catchBinding, path: `${path}/catchBinding`, role: "name"})
    writer.synthetic(" instanceof ", "exact catch guard", [statement], [path])
    writer.mapped(targetName, {mappingKind: "exact", name: caught.name, node: statement.catchType, path: `${path}/catchType`, role: "type"})
    writer.synthetic(`)) {\n${indent}    throw `, "unmatched error propagation", [statement], [path])
    writer.mapped(statement.catchBinding.name, {mappingKind: "exact", node: statement.catchBinding, path: `${path}/catchBinding`, role: "name"})
    writer.synthetic(`\n${indent}  }\n`, "unmatched error propagation", [statement], [path])
    emitBlock(writer, statement.catchBody, `${indent}  `, `${path}/catchBody`, canonicalizeZero)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.catchBody, path: `${path}/catchBody`})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ReturnStatement") {
    writer.mapped("return", {mappingKind: "anchor", node: statement, path})
    if (statement.expression) {
      writer.synthetic(" ", "return spacing", [statement], [path])
      emitExpression(writer, statement.expression, `${path}/expression`, "javascript", identity)
    }
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ExpressionStatement") {
    emitExpression(writer, statement.expression, `${path}/expression`, "javascript", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "PrintStatement") {
    writer.mapped("console.log", {mappingKind: "anchor", node: statement, path})
    writer.mapped("(", {mappingKind: "anchor", node: statement, path})
    if (canonicalizeZero) writer.synthetic("(", "canonical integer output", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "javascript", identity)
    if (canonicalizeZero) writer.synthetic(").toString()", "canonical integer output", [statement], [path])
    writer.mapped(")", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }

  writer.mapped("if", {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  writer.mapped("(", {mappingKind: "anchor", node: statement, path})
  emitExpression(writer, statement.condition, `${path}/condition`, "javascript", identity)
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
 * Emits one JavaScript local statement and its JSDoc type carrier.
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
    emitExpression(writer, statement.expression, `${statementPath}/expression`, "javascript", identity)
    writer.synthetic("\n", "line break", [statement], [statementPath])
    return
  }

  writer.synthetic("/** @type {", "JavaScript local type scaffolding", [statement], [statementPath])
  emitType(writer, statement.type, `${statementPath}/type`, "javascript")
  writer.synthetic("} */\n", "JavaScript local type scaffolding", [statement], [statementPath])
  writer.synthetic(indent, "indentation", [statement], [statementPath])
  writer.mapped(statement.mutable ? "let" : "const", {mappingKind: "anchor", node: statement, path: statementPath})
  writer.synthetic(" ", "declaration spacing", [statement], [statementPath])
  writer.mapped(statement.name, {mappingKind: "exact", node: statement, path: statementPath, role: "name"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  writer.mapped("=", {mappingKind: "exact", node: statement, path: statementPath, role: "operator"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  emitExpression(writer, statement.initializer, `${statementPath}/initializer`, "javascript", identity)
  writer.synthetic("\n", "line break", [statement], [statementPath])
}

/**
 * Returns an unchanged JavaScript identifier.
 * @param {string} name - Identifier.
 * @returns {string} Identifier.
 */
function identity(name) {
  return name
}
