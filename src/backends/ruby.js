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
  const classes = module.classes ?? []
  const errors = module.errors ?? []

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

  errors.forEach((error, index) => {
    const path = `/errors/${index}`

    if (index > 0) writer.synthetic("\n\n", "error declaration separator", [error], [path])
    writer.mapped("class", {mappingKind: "anchor", node: error, path})
    writer.synthetic(" ", "error declaration spacing", [error], [path])
    writer.mapped(error.name, {mappingKind: "exact", node: error, path, role: "name"})
    writer.synthetic(" < StandardError\nend", "Ruby unchecked error scaffolding", [error], [path])
  })
  if (errors.length > 0) writer.synthetic("\n\n", "error/declaration separator", [module])

  records.forEach((record, recordIndex) => {
    const recordPath = `/records/${recordIndex}`

    if (recordIndex > 0) writer.synthetic("\n\n", "record declaration separator", [record], [recordPath])
    emitTemplateComments(writer, record.typeParameters ?? [], `${recordPath}/typeParameters`)
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

  classes.forEach((declaration, classIndex) => {
    if (classIndex > 0) writer.synthetic("\n\n", "reference class separator", [declaration], [`/classes/${classIndex}`])
    emitReferenceClass(writer, declaration, classIndex)
  })
  if (classes.length > 0) writer.synthetic("\n\n", "reference class/function separator", [module])

  module.functions.forEach((declaration, functionIndex) => {
    if (functionIndex > 0) writer.synthetic("\n\n", "declaration separator", [declaration])

    emitTemplateComments(writer, declaration.typeParameters ?? [], `/functions/${functionIndex}/typeParameters`)
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
    const privateNominals = [...errors, ...records].filter((declaration) => !writer.isExported(declaration.id))
    const privateFunctions = module.functions.filter((declaration) => !writer.isExported(declaration.id))

    for (const declaration of privateNominals) {
      writer.synthetic("\nprivate_constant :", "Ruby private semantic nominal declaration", [declaration])
      writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, role: "name"})
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
 * Emits one native Ruby reference class.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").ClassDeclaration} declaration - Reference class.
 * @param {number} classIndex - Module class index.
 * @returns {void}
 */
function emitReferenceClass(writer, declaration, classIndex) {
  const path = `/classes/${classIndex}`

  writer.mapped("class", {mappingKind: "anchor", node: declaration, path})
  writer.synthetic(" ", "reference class spacing", [declaration], [path])
  writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, path, role: "name"})
  writer.synthetic("\n", "line break", [declaration], [path])
  declaration.fields.forEach((field, index) => {
    const fieldPath = `${path}/fields/${index}`

    writer.synthetic("  # @semantifold-private ", "private field metadata", [field], [fieldPath])
    writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
    writer.synthetic(" [", "private field type metadata", [field], [fieldPath])
    emitType(writer, field.type, `${fieldPath}/type`, "ruby")
    writer.synthetic("]\n", "line break", [field], [fieldPath])
  })
  const constructor = declaration.constructor
  const constructorPath = `${path}/constructor`

  writer.synthetic("\n", "constructor spacing", [constructor], [constructorPath])
  emitRubyCallableComments(writer, constructor.parameters, undefined, `${constructorPath}/parameters`, undefined)
  writer.synthetic("  ", "constructor indentation", [constructor], [constructorPath])
  writer.mapped("def initialize", {mappingKind: "exact", node: constructor, path: constructorPath, role: "constructor"})
  emitRubyParameters(writer, constructor.parameters, `${constructorPath}/parameters`)
  writer.synthetic("\n", "line break", [constructor], [constructorPath])
  emitBlock(writer, constructor.body, "    ", `${constructorPath}/body`)
  writer.synthetic("  end", "constructor close", [constructor], [constructorPath])
  declaration.methods.forEach((method, index) => {
    const methodPath = `${path}/methods/${index}`

    writer.synthetic("\n\n", "method spacing", [method], [methodPath])
    emitRubyCallableComments(writer, method.parameters, method.returnType, `${methodPath}/parameters`, `${methodPath}/returnType`)
    writer.synthetic("  def ", "method indentation", [method], [methodPath])
    writer.mapped(method.name, {mappingKind: "exact", node: method, path: methodPath, role: "name"})
    emitRubyParameters(writer, method.parameters, `${methodPath}/parameters`)
    writer.synthetic("\n", "line break", [method], [methodPath])
    emitBlock(writer, method.body, "    ", `${methodPath}/body`)
    writer.synthetic("  end", "method close", [method], [methodPath])
  })
  writer.synthetic("\n", "line break", [declaration], [path])
  writer.mapped("end", {mappingKind: "anchor", node: declaration, path})
}

/**
 * Emits exact Ruby callable type comments.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Parameter[]} parameters - Ordered parameters.
 * @param {import("../semantic/types.js").SemanticFunctionReturnType | undefined} returnType - Optional return type.
 * @param {string} parameterPath - Parameter collection path.
 * @param {string | undefined} returnPath - Return type path.
 * @returns {void}
 */
function emitRubyCallableComments(writer, parameters, returnType, parameterPath, returnPath) {
  for (const [index, parameter] of parameters.entries()) {
    writer.synthetic("  # @param ", "parameter type metadata", [parameter], [`${parameterPath}/${index}`])
    writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: `${parameterPath}/${index}`, role: "name"})
    writer.synthetic(" [", "parameter type metadata", [parameter], [`${parameterPath}/${index}`])
    emitType(writer, parameter.type, `${parameterPath}/${index}/type`, "ruby")
    writer.synthetic("]\n", "line break", [parameter])
  }
  if (returnType && returnPath) {
    writer.synthetic("  # @return [", "return type metadata", [])
    emitType(writer, returnType, returnPath, "ruby")
    writer.synthetic("]\n", "line break", [])
  }
}

/**
 * Emits one Ruby parameter list.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Parameter[]} parameters - Ordered parameters.
 * @param {string} path - Parameter collection path.
 * @returns {void}
 */
function emitRubyParameters(writer, parameters, path) {
  writer.synthetic("(", "parameter list open", parameters)
  parameters.forEach((parameter, index) => {
    if (index) writer.synthetic(", ", "parameter separator", parameters)
    writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: `${path}/${index}`, role: "name"})
  })
  writer.synthetic(")", "parameter list close", parameters)
}

/**
 * Emits exact RDoc declaration parameters.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").TypeParameter[]} parameters - Ordered type parameters.
 * @param {string} path - Type-parameter collection path.
 */
function emitTemplateComments(writer, parameters, path) {
  parameters.forEach((parameter, index) => {
    writer.synthetic("# @template ", "Ruby type parameter scaffolding", [parameter], [`${path}/${index}`])
    writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: `${path}/${index}`, role: "name"})
    writer.synthetic("\n", "line break", [parameter])
  })
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
  if (statement.kind == "PrivateFieldWriteStatement") {
    const field = writer.privateFieldForId(statement.field)

    writer.mapped(`@${field.name}`, {mappingKind: "exact", name: field.name, node: statement, path, role: "member"})
    writer.synthetic(" = ", "private field assignment", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "ruby", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "BreakStatement" || statement.kind == "ContinueStatement") {
    writer.mapped(statement.kind == "BreakStatement" ? "break" : "next", {mappingKind: "exact", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "WhileStatement") {
    writer.mapped("while", {mappingKind: "exact", node: statement, path})
    writer.synthetic(" ", "condition-controlled loop spacing", [statement], [path])
    emitExpression(writer, statement.condition, `${path}/condition`, "ruby", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.body, `${indent}  `, `${path}/body`)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("end", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
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
  if (statement.kind == "ForEachMapStatement") {
    emitExpression(writer, statement.map, `${path}/map`, "ruby", identity)
    writer.mapped(".each", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "map loop spacing", [statement], [path])
    writer.mapped("do", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic(" |", "map iteration binding delimiter", [statement], [path])
    writer.mapped(statement.keyBinding.name, {
      mappingKind: "exact", node: statement.keyBinding, path: `${path}/keyBinding`, role: "name"
    })
    writer.synthetic(", ", "map iteration binding separator", [statement], [path])
    writer.mapped(statement.valueBinding.name, {
      mappingKind: "exact", node: statement.valueBinding, path: `${path}/valueBinding`, role: "name"
    })
    writer.synthetic("|\n", "map iteration binding delimiter", [statement], [path])
    emitBlock(writer, statement.body, `${indent}  `, `${path}/body`)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("end", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "RaiseStatement") {
    const type = statement.error.error
    const error = writer.errorForId(type.declarationId)

    writer.mapped("raise", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "raise spacing", [statement], [path])
    writer.mapped(writer.errorNameForId(type.declarationId), {mappingKind: "exact", name: error.name, node: statement.error, path: `${path}/error`, role: "type"})
    writer.synthetic(", ", "error message separator", [statement.error], [`${path}/error`])
    emitExpression(writer, statement.error.message, `${path}/error/message`, "ruby", identity)
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "TryStatement") {
    const caught = writer.errorForId(statement.catchType.declarationId)

    writer.mapped("begin", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.body, `${indent}  `, `${path}/body`)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("rescue", {mappingKind: "anchor", node: statement, path, role: "catch"})
    writer.synthetic(" ", "rescue spacing", [statement], [path])
    writer.mapped(writer.errorNameForId(statement.catchType.declarationId), {mappingKind: "exact", name: caught.name, node: statement.catchType, path: `${path}/catchType`, role: "type"})
    writer.synthetic(" => ", "catch binding separator", [statement.catchBinding], [`${path}/catchBinding`])
    writer.mapped(statement.catchBinding.name, {mappingKind: "exact", node: statement.catchBinding, path: `${path}/catchBinding`, role: "name"})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.catchBody, `${indent}  `, `${path}/catchBody`)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("end", {mappingKind: "anchor", node: statement.catchBody, path: `${path}/catchBody`})
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
