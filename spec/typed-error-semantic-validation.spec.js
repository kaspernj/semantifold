// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {SemantifoldDiagnostic} from "../index.js"
import {validateParsedModule} from "../src/semantic/validate.js"

const location = {
  end: {column: 2, line: 1, offset: 1},
  filename: "errors.ts",
  start: {column: 1, line: 1, offset: 0}
}

const stringType = {kind: /** @type {const} */ ("TypeReference"), name: /** @type {const} */ ("string")}
const errorType = (declarationId = "error:0") => ({declarationId, kind: /** @type {const} */ ("ErrorType")})
const literal = (value) => ({kind: /** @type {const} */ ("StringLiteral"), location, value})
const block = (...statements) => ({kind: /** @type {const} */ ("Block"), location, statements})
const raised = (declarationId = "error:0", message = "bad") => ({
  error: {error: errorType(declarationId), kind: /** @type {const} */ ("ErrorConstruction"), location, message: literal(message)},
  kind: /** @type {const} */ ("RaiseStatement"),
  location
})
const returned = (value) => ({expression: literal(value), kind: /** @type {const} */ ("ReturnStatement"), location})
const identifier = (name) => ({kind: /** @type {const} */ ("IdentifierExpression"), location, name})
const called = (callee) => ({arguments: [], callee, kind: /** @type {const} */ ("CallExpression"), location})

function moduleWith(body, errors = [{id: "error:0", kind: /** @type {const} */ ("ErrorDeclaration"), location, name: "ValidationError"}]) {
  return {
    entryPoint: {body: block(), kind: /** @type {const} */ ("EntryPoint"), location},
    errors,
    functions: [{
      body,
      id: "function:0",
      kind: /** @type {const} */ ("FunctionDeclaration"),
      location,
      name: "read",
      parameters: [],
      returnType: stringType
    }],
    kind: /** @type {const} */ ("Module"),
    location
  }
}

function rejects(module, code) {
  assert.throws(
    () => validateParsedModule(/** @type {import("../src/semantic/types.js").SemanticModule} */ (module), "typescript"),
    (error) => error instanceof SemantifoldDiagnostic && error.code == code && error.location?.filename == "errors.ts"
  )
}

describe("typed error semantic validation", () => {
  it("treats an exact nominal typed raise as abrupt function completion", () => {
    const module = moduleWith(block(raised()))

    expect(validateParsedModule(/** @type {import("../src/semantic/types.js").SemanticModule} */ (module), "typescript")).toEqual(module)
  })

  it("catches only the exact declared error and keeps the catch binding immutable and scoped", () => {
    const errors = [
      {id: "error:0", kind: /** @type {const} */ ("ErrorDeclaration"), location, name: "ValidationError"},
      {id: "error:1", kind: /** @type {const} */ ("ErrorDeclaration"), location, name: "ProcessingError"}
    ]
    const exactCatch = {
      body: block(raised("error:0")),
      catchBinding: {kind: /** @type {const} */ ("CatchBinding"), location, mutable: false, name: "error", type: errorType("error:0")},
      catchBody: block(returned("caught")),
      catchType: errorType("error:0"),
      kind: /** @type {const} */ ("TryStatement"),
      location
    }

    expect(validateParsedModule(/** @type {import("../src/semantic/types.js").SemanticModule} */ (moduleWith(block(exactCatch), errors)), "typescript").errors?.length).toEqual(2)

    const mismatched = structuredClone(exactCatch)
    mismatched.catchBinding.type = errorType("error:1")
    rejects(moduleWith(block(mismatched), errors), "INVALID_ERROR_HANDLER")
  })

  it("rejects unknown error types, non-string payloads, and statements after raise deterministically", () => {
    rejects(moduleWith(block(raised("error:9"))), "UNKNOWN_ERROR")

    const wrongPayload = moduleWith(block(raised()))
    wrongPayload.functions[0].body.statements[0].error.message = {
      kind: /** @type {const} */ ("IntegerLiteral"), location, value: 1
    }
    rejects(wrongPayload, "NON_ERROR_RAISE")
    rejects(moduleWith(block(raised(), returned("never"))), "UNREACHABLE_STATEMENT")
  })

  it("keeps catch bindings immutable, catch-scoped, and message-only", () => {
    const assignment = {
      expression: literal("changed"),
      kind: /** @type {const} */ ("AssignmentStatement"),
      location,
      target: identifier("error")
    }
    const caught = {
      body: block(raised()),
      catchBinding: {kind: /** @type {const} */ ("CatchBinding"), location, mutable: false, name: "error", type: errorType()},
      catchBody: block(assignment),
      catchType: errorType(),
      kind: /** @type {const} */ ("TryStatement"),
      location
    }

    rejects(moduleWith(block(caught)), "IMMUTABLE_ASSIGNMENT")

    const scoped = structuredClone(caught)
    scoped.catchBody = block()
    const leakedRead = {
      expression: {kind: /** @type {const} */ ("ErrorMessageRead"), location, receiver: identifier("error")},
      kind: /** @type {const} */ ("ReturnStatement"),
      location
    }

    rejects(moduleWith(block(scoped, leakedRead)), "UNRESOLVED_BINDING")

    const arbitraryMember = structuredClone(caught)
    arbitraryMember.catchBody = block({
      expression: {field: "detail", kind: /** @type {const} */ ("MemberRead"), location, receiver: identifier("error")},
      kind: /** @type {const} */ ("ReturnStatement"),
      location
    })

    rejects(moduleWith(block(arbitraryMember)), "TYPE_MISMATCH")
  })

  it("rejects a handler whose exact nominal error cannot escape its protected body", () => {
    const unreachable = {
      body: block(returned("done")),
      catchBinding: {kind: /** @type {const} */ ("CatchBinding"), location, mutable: false, name: "error", type: errorType()},
      catchBody: block(returned("caught")),
      catchType: errorType(),
      kind: /** @type {const} */ ("TryStatement"),
      location
    }

    rejects(moduleWith(block(unreachable)), "UNREACHABLE_HANDLER")
  })

  it("uses fixed-point call effects for exact catches without adding checked signatures", () => {
    const firstCall = {expression: called("second"), kind: /** @type {const} */ ("ReturnStatement"), location}
    const protectedCall = {expression: called("first"), kind: /** @type {const} */ ("ReturnStatement"), location}
    const handler = {
      body: block(protectedCall),
      catchBinding: {kind: /** @type {const} */ ("CatchBinding"), location, mutable: false, name: "error", type: errorType()},
      catchBody: block(returned("caught")),
      catchType: errorType(),
      kind: /** @type {const} */ ("TryStatement"),
      location
    }
    const module = moduleWith(block(handler))

    module.functions.unshift({
      body: block(firstCall),
      id: "function:1",
      kind: /** @type {const} */ ("FunctionDeclaration"),
      location,
      name: "first",
      parameters: [],
      returnType: stringType
    }, {
      body: block(raised()),
      id: "function:2",
      kind: /** @type {const} */ ("FunctionDeclaration"),
      location,
      name: "second",
      parameters: [],
      returnType: stringType
    })

    expect(validateParsedModule(/** @type {import("../src/semantic/types.js").SemanticModule} */ (module), "typescript")).toEqual(module)
    expect(module.functions.map((declaration) => Object.keys(declaration).sort())).toEqual([
      ["body", "id", "kind", "location", "name", "parameters", "returnType"],
      ["body", "id", "kind", "location", "name", "parameters", "returnType"],
      ["body", "id", "kind", "location", "name", "parameters", "returnType"]
    ])
  })

  it("treats imported effects as resolved facts instead of reinterpreting dependency-local names", () => {
    const imported = {
      body: block({expression: called("helper"), kind: /** @type {const} */ ("ReturnStatement"), location}),
      id: "dependency#function:0",
      kind: /** @type {const} */ ("FunctionDeclaration"),
      location,
      name: "dependencyFunction",
      parameters: [],
      returnType: stringType
    }
    const protectedCall = {expression: called("dependencyAlias"), kind: /** @type {const} */ ("ReturnStatement"), location}
    const handler = {
      body: block(protectedCall),
      catchBinding: {kind: /** @type {const} */ ("CatchBinding"), location, mutable: false, name: "error", type: errorType()},
      catchBody: block(returned("caught")),
      catchType: errorType(),
      kind: /** @type {const} */ ("TryStatement"),
      location
    }
    const module = moduleWith(block(handler))

    module.functions.unshift({
      body: block(raised()),
      id: "function:1",
      kind: /** @type {const} */ ("FunctionDeclaration"),
      location,
      name: "helper",
      parameters: [],
      returnType: stringType
    })

    assert.throws(
      () => validateParsedModule(/** @type {import("../src/semantic/types.js").SemanticModule} */ (module), "typescript", {
        callEffects: new Map([["dependencyAlias", new Set()]]),
        functions: new Map([["dependencyAlias", imported]])
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNREACHABLE_HANDLER"
    )
  })
})
