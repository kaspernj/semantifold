// @ts-check

import {emitExpression, emitType} from "./shared.js"
import {emitEffectPrefixes, emitEffectSupport} from "./effects.js"

/** @type {WeakMap<import("./writer.js").SourceWriter, Set<string>>} */
const generatedNames = new WeakMap()

/**
 * Emits an independently executable Java `Main` program through the source-aware writer.
 * @param {import("../semantic/types.js").SemanticModule} module - Semantic module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @returns {void}
 */
export function generateJava(module, writer) {
  generatedNames.set(writer, collectNames(module))
  const records = module.records ?? []
  const classes = module.classes ?? []
  const errors = module.errors ?? []
  const programModule = writer.program?.modules.find(({id}) => id == Reflect.get(module, "id"))

  if (programModule) {
    writer.synthetic(`package semantifold.generated.${programModule.id};\n`, "Java program package", [module])
    const imports = new Map(programModule.imports.map((imported) => {
      const owner = /** @type {import("../semantic/types.js").SemanticProgramModule} */ (
        writer.program?.modules.find(({id}) => id == imported.moduleId))
      const record = owner.records?.find(({id}) => id == imported.declarationId)
      const error = owner.errors?.find(({id}) => id == imported.declarationId)
      const name = record?.name ?? error?.name ?? writer.programModuleName(owner.id)

      return [`semantifold.generated.${owner.id}.${name}`, imported]
    }))

    for (const [name, imported] of imports) {
      const importPath = `/imports/${programModule.imports.indexOf(imported)}`

      writer.synthetic("import ", "Java program import", [imported], [importPath])
      writer.mapped(name, {mappingKind: "anchor", node: imported, path: importPath, role: "path"})
      writer.synthetic(";\n", "Java program import terminator", [imported], [importPath])
    }
    writer.synthetic("\n", "Java program header separator", [module])
  }

  emitEffectSupport(writer, module, "java", "top")
  errors.forEach((error, index) => {
    const path = `/errors/${index}`

    if (index > 0) writer.synthetic("\n\n", "error declaration separator", [error], [path])
    writer.mapped(programModule && writer.isExported(error.id) ? "public final class" : "final class",
      {mappingKind: "anchor", node: error, path})
    writer.synthetic(" ", "error declaration spacing", [error], [path])
    writer.mapped(error.name, {mappingKind: "exact", node: error, path, role: "name"})
    writer.synthetic(" extends RuntimeException {\n  ", "Java unchecked error scaffolding", [error], [path])
    if (programModule) writer.synthetic("public ", "Java exported error constructor", [error], [path])
    writer.mapped(error.name, {mappingKind: "exact", node: error, path, role: "name"})
    writer.synthetic("(String message) {\n    super(message);\n  }\n}", "Java unchecked error scaffolding", [error], [path])
  })
  if (errors.length > 0) writer.synthetic("\n\n", "error/declaration separator", [module])

  records.forEach((record, recordIndex) => {
    const recordPath = `/records/${recordIndex}`

    if (recordIndex > 0) writer.synthetic("\n\n", "record declaration separator", [record], [recordPath])
    writer.mapped(programModule && writer.isExported(record.id) ? "public final class" : "final class",
      {mappingKind: "anchor", node: record, path: recordPath})
    writer.synthetic(" ", "record declaration spacing", [record], [recordPath])
    writer.mapped(record.name, {mappingKind: "exact", node: record, path: recordPath, role: "name"})
    emitTypeParameters(writer, record.typeParameters ?? [], `${recordPath}/typeParameters`)
    writer.synthetic(" {\n", "Java record class scaffolding", [record], [recordPath])
    record.fields.forEach((field, fieldIndex) => {
      const fieldPath = `${recordPath}/fields/${fieldIndex}`

      writer.synthetic("  private final ", "Java record storage scaffolding", [field], [fieldPath])
      emitType(writer, field.type, `${fieldPath}/type`, "java")
      writer.synthetic(" ", "Java record field spacing", [field], [fieldPath])
      writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
      writer.synthetic(";\n", "Java record storage scaffolding", [field], [fieldPath])
    })
    writer.synthetic(programModule ? "\n  public " : "\n  ", "Java record constructor spacing", [record], [recordPath])
    writer.mapped(record.name, {mappingKind: "exact", node: record, path: recordPath, role: "name"})
    writer.synthetic("(", "Java record constructor scaffolding", [record], [recordPath])
    record.fields.forEach((field, fieldIndex) => {
      const fieldPath = `${recordPath}/fields/${fieldIndex}`

      if (fieldIndex) writer.synthetic(", ", "record field separator", [record], [recordPath])
      emitType(writer, field.type, `${fieldPath}/type`, "java")
      writer.synthetic(" ", "Java record field spacing", [field], [fieldPath])
      writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
    })
    writer.synthetic(") {\n", "Java record constructor scaffolding", [record], [recordPath])
    record.fields.forEach((field, fieldIndex) => {
      const fieldPath = `${recordPath}/fields/${fieldIndex}`

      writer.synthetic("    this.", "Java record initialization scaffolding", [field], [fieldPath])
      writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
      writer.synthetic(" = ", "Java record initialization scaffolding", [field], [fieldPath])
      writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
      writer.synthetic(";\n", "Java record initialization scaffolding", [field], [fieldPath])
    })
    writer.synthetic("  }\n", "Java record constructor scaffolding", [record], [recordPath])
    record.fields.forEach((field, fieldIndex) => {
      const fieldPath = `${recordPath}/fields/${fieldIndex}`

      writer.synthetic(programModule ? "\n  public " : "\n  ", "Java record accessor spacing", [field], [fieldPath])
      emitType(writer, field.type, `${fieldPath}/type`, "java")
      writer.synthetic(" ", "Java record accessor spacing", [field], [fieldPath])
      writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
      writer.synthetic("() {\n    return this.", "Java record accessor scaffolding", [field], [fieldPath])
      writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
      writer.synthetic(";\n  }\n", "Java record accessor scaffolding", [field], [fieldPath])
    })
    writer.synthetic("}", "Java record class scaffolding", [record], [recordPath])
  })
  if (programModule && records.length + errors.length > 0) {
    writer.synthetic("\n", "Java source terminator", [module])
    return
  }
  classes.forEach((declaration, classIndex) => {
    if (records.length > 0 || classIndex > 0) writer.synthetic("\n\n", "reference class separator", [declaration], [`/classes/${classIndex}`])
    emitReferenceClass(writer, declaration, classIndex)
  })
  if (records.length + classes.length > 0) writer.synthetic("\n\n", "nominal/Main separator", [module])
  const className = programModule
    ? writer.isProgramEntry() ? "Main" : writer.programModuleName(programModule.id)
    : "Main"

  writer.synthetic(`public final class ${className} {\n`, "Java class scaffolding", [module])
  emitEffectSupport(writer, module, "java", "members")

  module.functions.forEach((declaration, functionIndex) => {
    if (functionIndex > 0) writer.synthetic("\n\n", "declaration separator", [declaration])

    writer.synthetic("  ", "indentation", [declaration])
    writer.mapped(programModule && writer.isExported(declaration.id) ? "public static" :
      !programModule && classes.length > 0 ? "static" : "private static",
      {mappingKind: "anchor", node: declaration})
    writer.synthetic(" ", "method spacing", [declaration])
    emitTypeParameters(writer, declaration.typeParameters ?? [], `/functions/${functionIndex}/typeParameters`)
    if ((declaration.typeParameters?.length ?? 0) > 0) writer.synthetic(" ", "generic method spacing", [declaration])
    emitType(writer, declaration.returnType, `/functions/${functionIndex}/returnType`, "java")
    writer.synthetic(" ", "method spacing", [declaration])
    writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, role: "name"})
    writer.mapped("(", {mappingKind: "anchor", node: declaration})
    declaration.parameters.forEach((parameter, index) => {
      const parameterPath = `/functions/${functionIndex}/parameters/${index}`

      if (index > 0) writer.synthetic(", ", "parameter separator", [declaration])
      emitType(writer, parameter.type, `${parameterPath}/type`, "java")
      writer.synthetic(" ", "parameter spacing", [parameter], [parameterPath])
      writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
    })
    writer.mapped(")", {mappingKind: "anchor", node: declaration})
    writer.synthetic(" ", "method spacing", [declaration])
    writer.mapped("{", {mappingKind: "anchor", node: declaration})
    writer.synthetic("\n", "line break", [declaration])

    emitBlock(writer, declaration.body, "    ", `/functions/${functionIndex}/body`)
    writer.synthetic("  ", "indentation", [declaration])
    writer.mapped("}", {mappingKind: "anchor", node: declaration})
  })

  if (!programModule || writer.isProgramEntry()) {
    writer.synthetic("\n\n", "entry-point separator", [module.entryPoint])
    writer.synthetic("  ", "indentation", [module.entryPoint])
    writer.mapped("public static void main", {mappingKind: "anchor", node: module.entryPoint})
    writer.mapped("(", {mappingKind: "anchor", node: module.entryPoint})
    writer.synthetic("String[] args", "Java entry-point signature", [module.entryPoint])
    writer.mapped(")", {mappingKind: "anchor", node: module.entryPoint})
    writer.synthetic(" ", "method spacing", [module.entryPoint])
    writer.mapped("{", {mappingKind: "anchor", node: module.entryPoint})
    writer.synthetic("\n", "line break", [module.entryPoint])

    emitBlock(writer, module.entryPoint.body, "    ", "/entryPoint/body")
    writer.synthetic("  ", "indentation", [module.entryPoint])
    writer.mapped("}", {mappingKind: "anchor", node: module.entryPoint})
  }
  writer.synthetic("\n}\n", "Java class scaffolding", [module])
}

/**
 * Emits one package-private final Java reference class.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").ClassDeclaration} declaration - Reference class.
 * @param {number} classIndex - Module class index.
 * @returns {void}
 */
function emitReferenceClass(writer, declaration, classIndex) {
  const path = `/classes/${classIndex}`

  writer.mapped("final class", {mappingKind: "anchor", node: declaration, path})
  writer.synthetic(" ", "reference class spacing", [declaration], [path])
  writer.mapped(declaration.name, {mappingKind: "exact", node: declaration, path, role: "name"})
  writer.synthetic(" {\n", "reference class open", [declaration], [path])
  declaration.fields.forEach((field, index) => {
    const fieldPath = `${path}/fields/${index}`

    writer.synthetic("  private ", "private field scaffolding", [field], [fieldPath])
    emitType(writer, field.type, `${fieldPath}/type`, "java")
    writer.synthetic(" ", "private field spacing", [field], [fieldPath])
    writer.mapped(field.name, {mappingKind: "exact", node: field, path: fieldPath, role: "name"})
    writer.synthetic(";\n", "line break", [field], [fieldPath])
  })
  const constructor = declaration.constructor
  const constructorPath = `${path}/constructor`

  writer.synthetic("\n  ", "constructor spacing", [constructor], [constructorPath])
  writer.mapped(declaration.name, {mappingKind: "exact", node: constructor, path: constructorPath, role: "constructor"})
  emitJavaParameters(writer, constructor.parameters, `${constructorPath}/parameters`)
  writer.synthetic(" {\n", "constructor open", [constructor], [constructorPath])
  writer.beginReferenceClassEmission()
  try {
    emitBlock(writer, constructor.body, "    ", `${constructorPath}/body`)
  } finally {
    writer.endReferenceClassEmission()
  }
  writer.synthetic("  }", "constructor close", [constructor], [constructorPath])
  declaration.methods.forEach((method, index) => {
    const methodPath = `${path}/methods/${index}`

    writer.synthetic("\n\n  ", "method spacing", [method], [methodPath])
    emitType(writer, method.returnType, `${methodPath}/returnType`, "java")
    writer.synthetic(" ", "method spacing", [method], [methodPath])
    writer.mapped(method.name, {mappingKind: "exact", node: method, path: methodPath, role: "name"})
    emitJavaParameters(writer, method.parameters, `${methodPath}/parameters`)
    writer.synthetic(" {\n", "method open", [method], [methodPath])
    writer.beginReferenceClassEmission()
    try {
      emitBlock(writer, method.body, "    ", `${methodPath}/body`)
    } finally {
      writer.endReferenceClassEmission()
    }
    writer.synthetic("  }", "method close", [method], [methodPath])
  })
  writer.synthetic("\n", "line break", [declaration], [path])
  writer.mapped("}", {mappingKind: "anchor", node: declaration, path})
}

/**
 * Emits one Java parameter list.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Parameter[]} parameters - Ordered parameters.
 * @param {string} path - Parameter collection path.
 * @returns {void}
 */
function emitJavaParameters(writer, parameters, path) {
  writer.synthetic("(", "parameter list open", parameters)
  parameters.forEach((parameter, index) => {
    const parameterPath = `${path}/${index}`

    if (index) writer.synthetic(", ", "parameter separator", parameters)
    emitType(writer, parameter.type, `${parameterPath}/type`, "java")
    writer.synthetic(" ", "parameter spacing", [parameter], [parameterPath])
    writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: parameterPath, role: "name"})
  })
  writer.synthetic(")", "parameter list close", parameters)
}

/**
 * Emits native invariant Java declaration parameters.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").TypeParameter[]} parameters - Ordered type parameters.
 * @param {string} path - Type-parameter collection path.
 */
function emitTypeParameters(writer, parameters, path) {
  if (parameters.length == 0) return
  writer.synthetic("<", "Java type parameter open", parameters)
  parameters.forEach((parameter, index) => {
    if (index) writer.synthetic(", ", "Java type parameter separator", parameters)
    writer.mapped(parameter.name, {mappingKind: "exact", node: parameter, path: `${path}/${index}`, role: "name"})
  })
  writer.synthetic(">", "Java type parameter close", parameters)
}

/**
 * Emits one ordered Java block body.
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
 * Emits one Java statement.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").Statement} statement - Semantic statement.
 * @param {string} indent - Indentation.
 * @param {string} path - Exact statement path.
 * @returns {void}
 */
function emitStatement(writer, statement, indent, path) {
  emitEffectPrefixes(writer, statement, indent, path, "java",
    (expression, expressionPath) => emitExpression(writer, expression, expressionPath, "java", identity))
  if (statement.kind == "LocalDeclaration" || statement.kind == "AssignmentStatement") return emitLocal(writer, statement, indent, path)
  writer.synthetic(indent, "indentation", [statement], [path])
  if (statement.kind == "PrivateFieldWriteStatement") {
    emitExpression(writer, statement.receiver, `${path}/receiver`, "java", identity)
    const field = writer.privateFieldForId(statement.field)

    writer.mapped(`.${field.name}`, {mappingKind: "exact", name: field.name, node: statement, path, role: "member"})
    writer.synthetic(" = ", "private field assignment", [statement], [path])
    emitExpression(writer, statement.expression, `${path}/expression`, "java", identity)
    writer.mapped(";", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "BreakStatement" || statement.kind == "ContinueStatement") {
    writer.mapped(statement.kind == "BreakStatement" ? "break" : "continue", {mappingKind: "exact", node: statement, path})
    writer.mapped(";", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "WhileStatement") {
    writer.mapped("while", {mappingKind: "exact", node: statement, path})
    writer.synthetic(" (", "condition-controlled loop spacing", [statement], [path])
    emitExpression(writer, statement.condition, `${path}/condition`, "java", identity)
    writer.synthetic(") ", "condition-controlled loop spacing", [statement], [path])
    writer.mapped("{", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.body, `${indent}  `, `${path}/body`)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ForEachStatement") {
    writer.mapped("for", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" (", "loop scaffolding", [statement], [path])
    emitType(writer, statement.valueBinding.type, `${path}/valueBinding/type`, "java", true)
    writer.synthetic(" ", "iteration binding spacing", [statement.valueBinding], [`${path}/valueBinding`])
    writer.mapped(statement.valueBinding.name, {
      mappingKind: "exact", node: statement.valueBinding, path: `${path}/valueBinding`, role: "name"
    })
    writer.synthetic(" : ", "loop scaffolding", [statement], [path])
    emitExpression(writer, statement.list, `${path}/list`, "java", identity)
    writer.synthetic(") ", "loop scaffolding", [statement], [path])
    writer.mapped("{", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.body, `${indent}  `, `${path}/body`)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ForEachMapStatement") {
    const entryName = freshGeneratedName(writer, "__semantifold_entry")

    writer.mapped("for", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" (java.util.Map.Entry<", "ordered-map loop scaffolding", [statement], [path])
    emitType(writer, statement.keyBinding.type, `${path}/keyBinding/type`, "java", true)
    writer.synthetic(",", "ordered-map entry type separator", [statement], [path])
    emitType(writer, statement.valueBinding.type, `${path}/valueBinding/type`, "java", true)
    writer.synthetic(`> ${entryName} : `, "ordered-map loop scaffolding", [statement], [path])
    emitExpression(writer, statement.map, `${path}/map`, "java", identity)
    writer.synthetic(".sequencedEntrySet()) ", "ordered-map loop scaffolding", [statement], [path])
    writer.mapped("{", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitJavaMapPairBinding(writer, statement.keyBinding, `${indent}  `, `${path}/keyBinding`, entryName, "getKey")
    emitJavaMapPairBinding(writer, statement.valueBinding, `${indent}  `, `${path}/valueBinding`, entryName, "getValue")
    emitBlock(writer, statement.body, `${indent}  `, `${path}/body`)
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
    emitExpression(writer, statement.error.message, `${path}/error/message`, "java", identity)
    writer.synthetic(");\n", "error construction close", [statement.error], [`${path}/error`])
    return
  }
  if (statement.kind == "TryStatement") {
    const caught = writer.errorForId(statement.catchType.declarationId)

    writer.mapped("try", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "try spacing", [statement], [path])
    writer.mapped("{", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.body, `${indent}  `, `${path}/body`)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.body, path: `${path}/body`})
    writer.synthetic(" ", "catch spacing", [statement], [path])
    writer.mapped("catch", {mappingKind: "anchor", node: statement, path, role: "catch"})
    writer.synthetic(" (", "catch binding scaffolding", [statement.catchBinding], [`${path}/catchBinding`])
    writer.mapped(writer.errorNameForId(statement.catchType.declarationId), {mappingKind: "exact", name: caught.name, node: statement.catchType, path: `${path}/catchType`, role: "type"})
    writer.synthetic(" ", "catch binding spacing", [statement.catchBinding], [`${path}/catchBinding`])
    writer.mapped(statement.catchBinding.name, {mappingKind: "exact", node: statement.catchBinding, path: `${path}/catchBinding`, role: "name"})
    writer.synthetic(") ", "catch binding scaffolding", [statement.catchBinding], [`${path}/catchBinding`])
    writer.mapped("{", {mappingKind: "anchor", node: statement.catchBody, path: `${path}/catchBody`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.catchBody, `${indent}  `, `${path}/catchBody`)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.catchBody, path: `${path}/catchBody`})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ReturnStatement") {
    writer.mapped("return", {mappingKind: "anchor", node: statement, path})
    if (statement.expression) {
      writer.synthetic(" ", "return spacing", [statement], [path])
      emitExpression(writer, statement.expression, `${path}/expression`, "java", identity)
    }
    writer.mapped(";", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "ExpressionStatement") {
    emitExpression(writer, statement.expression, `${path}/expression`, "java", identity)
    writer.mapped(";", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  if (statement.kind == "PrintStatement") {
    writer.mapped("System.out.println", {mappingKind: "anchor", node: statement, path})
    writer.mapped("(", {mappingKind: "anchor", node: statement, path})
    emitExpression(writer, statement.expression, `${path}/expression`, "java", identity)
    writer.mapped(")", {mappingKind: "anchor", node: statement, path})
    writer.mapped(";", {mappingKind: "anchor", node: statement, path})
    writer.synthetic("\n", "line break", [statement], [path])
    return
  }
  writer.mapped("if", {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  writer.mapped("(", {mappingKind: "anchor", node: statement, path})
  emitExpression(writer, statement.condition, `${path}/condition`, "java", identity)
  writer.mapped(")", {mappingKind: "anchor", node: statement, path})
  writer.synthetic(" ", "conditional spacing", [statement], [path])
  writer.mapped("{", {mappingKind: "anchor", node: statement.consequent, path: `${path}/consequent`})
  writer.synthetic("\n", "line break", [statement], [path])
  emitBlock(writer, statement.consequent, `${indent}  `, `${path}/consequent`)
  writer.synthetic(indent, "indentation", [statement], [path])
  writer.mapped("}", {mappingKind: "anchor", node: statement.consequent, path: `${path}/consequent`})
  if (statement.alternate) {
    writer.synthetic(" ", "conditional spacing", [statement], [path])
    writer.mapped("else", {mappingKind: "anchor", node: statement, path})
    writer.synthetic(" ", "conditional spacing", [statement], [path])
    writer.mapped("{", {mappingKind: "anchor", node: statement.alternate, path: `${path}/alternate`})
    writer.synthetic("\n", "line break", [statement], [path])
    emitBlock(writer, statement.alternate, `${indent}  `, `${path}/alternate`)
    writer.synthetic(indent, "indentation", [statement], [path])
    writer.mapped("}", {mappingKind: "anchor", node: statement.alternate, path: `${path}/alternate`})
  }
  writer.synthetic("\n", "line break", [statement], [path])
}

/**
 * Emits one Java local statement.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").LocalStatement} statement - Local statement.
 * @param {string} indent - Leading indentation.
 * @param {string} statementPath - Exact JSON Pointer for this statement occurrence.
 * @returns {void}
 */
function emitLocal(writer, statement, indent, statementPath) {
  if (statement.kind == "LocalDeclaration" && statement.initializer.kind == "OrderedMapLiteral" &&
    statement.type.kind == "OrderedMapType") {
    const backingName = freshGeneratedName(writer, `__semantifold_${statement.name}_backing`)

    writer.synthetic(`${indent}final java.util.LinkedHashMap<`, "ordered-map backing declaration", [statement], [statementPath])
    emitType(writer, statement.type.keyType, `${statementPath}/type/keyType`, "java", true)
    writer.synthetic(",", "ordered-map backing type separator", [statement], [statementPath])
    emitType(writer, statement.type.valueType, `${statementPath}/type/valueType`, "java", true)
    writer.synthetic(`> ${backingName} = new java.util.LinkedHashMap<>();\n`, "ordered-map backing construction", [statement], [statementPath])
    statement.initializer.entries.forEach((entry, index) => {
      const entryPath = `${statementPath}/initializer/entries/${index}`

      writer.synthetic(`${indent}${backingName}.`, "ordered-map insertion receiver", [entry], [entryPath])
      writer.mapped("put", {mappingKind: "anchor", node: entry, path: entryPath, role: "operator"})
      writer.synthetic("(", "ordered-map insertion open", [entry], [entryPath])
      emitExpression(writer, entry.key, `${entryPath}/key`, "java", identity)
      writer.synthetic(", ", "ordered-map insertion separator", [entry], [entryPath])
      emitExpression(writer, entry.value, `${entryPath}/value`, "java", identity)
      writer.synthetic(");\n", "ordered-map insertion close", [entry], [entryPath])
    })
    writer.synthetic(indent, "indentation", [statement], [statementPath])
    writer.mapped("final", {mappingKind: "anchor", node: statement, path: statementPath})
    writer.synthetic(" ", "modifier spacing", [statement], [statementPath])
    emitType(writer, statement.type, `${statementPath}/type`, "java")
    writer.synthetic(" ", "declaration spacing", [statement], [statementPath])
    writer.mapped(statement.name, {mappingKind: "exact", node: statement, path: statementPath, role: "name"})
    writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
    writer.mapped("=", {mappingKind: "exact", node: statement, path: statementPath, role: "operator"})
    writer.synthetic(` java.util.Collections.unmodifiableSequencedMap(${backingName});\n`,
      "ordered-map immutable boundary", [statement.initializer], [`${statementPath}/initializer`])
    return
  }
  writer.synthetic(indent, "indentation", [statement], [statementPath])

  if (statement.kind == "AssignmentStatement") {
    writer.mapped(statement.target.name, {mappingKind: "exact", node: statement.target, path: `${statementPath}/target`, role: "name"})
    writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
    writer.mapped("=", {mappingKind: "exact", node: statement, path: statementPath, role: "operator"})
    writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
    emitExpression(writer, statement.expression, `${statementPath}/expression`, "java", identity)
    writer.mapped(";", {mappingKind: "anchor", node: statement, path: statementPath})
    writer.synthetic("\n", "line break", [statement], [statementPath])
    return
  }

  if (!statement.mutable) {
    writer.mapped("final", {mappingKind: "anchor", node: statement, path: statementPath})
    writer.synthetic(" ", "modifier spacing", [statement], [statementPath])
  }
  emitType(writer, statement.type, `${statementPath}/type`, "java")
  writer.synthetic(" ", "declaration spacing", [statement], [statementPath])
  writer.mapped(statement.name, {mappingKind: "exact", node: statement, path: statementPath, role: "name"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  writer.mapped("=", {mappingKind: "exact", node: statement, path: statementPath, role: "operator"})
  writer.synthetic(" ", "assignment spacing", [statement], [statementPath])
  emitExpression(writer, statement.initializer, `${statementPath}/initializer`, "java", identity)
  writer.mapped(";", {mappingKind: "anchor", node: statement, path: statementPath})
  writer.synthetic("\n", "line break", [statement], [statementPath])
}

/**
 * Emits one immutable semantic map-loop binding from the hidden native entry.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {import("../semantic/types.js").ValueBinding} binding - Semantic binding.
 * @param {string} indent - Leading indentation.
 * @param {string} path - Exact binding path.
 * @param {string} entryName - Collision-safe hidden entry name.
 * @param {"getKey" | "getValue"} accessor - Native accessor.
 * @returns {void}
 */
function emitJavaMapPairBinding(writer, binding, indent, path, entryName, accessor) {
  writer.synthetic(`${indent}final `, "ordered-map binding declaration", [binding], [path])
  emitType(writer, binding.type, `${path}/type`, "java")
  writer.synthetic(" ", "ordered-map binding spacing", [binding], [path])
  writer.mapped(binding.name, {mappingKind: "exact", node: binding, path, role: "name"})
  writer.synthetic(` = ${entryName}.${accessor}();\n`, "ordered-map entry access", [binding], [path])
}

/**
 * Allocates a Java identifier that cannot capture any semantic source name in this module.
 * @param {import("./writer.js").SourceWriter} writer - Source-aware writer.
 * @param {string} preferred - Stable readable prefix.
 * @returns {string} Fresh identifier.
 */
function freshGeneratedName(writer, preferred) {
  const names = generatedNames.get(writer) ?? new Set()
  let name = preferred
  let suffix = 2

  while (names.has(name)) {
    name = `${preferred}_${suffix}`
    suffix += 1
  }
  names.add(name)
  generatedNames.set(writer, names)
  return name
}

/**
 * Collects every semantic name so generated Java temporaries remain hygienic.
 * @param {unknown} value - Semantic subtree.
 * @param {Set<object>} [seen] - Cycle protection.
 * @param {Set<string>} [names] - Accumulated names.
 * @returns {Set<string>} All explicit names.
 */
function collectNames(value, seen = new Set(), names = new Set()) {
  if (!value || typeof value != "object" || seen.has(value)) return names
  seen.add(value)
  if (!Array.isArray(value) && typeof Reflect.get(value, "name") == "string") {
    names.add(/** @type {string} */ (Reflect.get(value, "name")))
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) collectNames(child, seen, names)

  return names
}

/**
 * Returns an unchanged Java identifier.
 * @param {string} name - Identifier.
 * @returns {string} Identifier.
 */
function identity(name) {
  return name
}
