// @ts-check

import assert from "node:assert/strict"
import {describe, it} from "@velocious/testing"
import {generate, parse, SemantifoldDiagnostic} from "../index.js"

describe("backend identifier validation", () => {
  it("rejects a PHP-reserved function and callee name", () => {
    const source = `
function echo(left: number, right: number): number {
  if (left > right) return left - right
  else return right - left
}
console.log(echo(4, 9))
`
    const module = parse({filename: "echo.ts", language: "typescript", source})

    assert.throws(
      () => generate({language: "php", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "php" && error.location?.filename == "echo.ts"
    )
  })

  it("rejects Ruby-reserved parameter and identifier names", () => {
    const source = `
function difference(left: number, end: number): number {
  if (left > end) return left - end
  else return end - left
}
console.log(difference(4, 9))
`
    const module = parse({filename: "end.ts", language: "typescript", source})

    assert.throws(
      () => generate({language: "ruby", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == "ruby" && error.location?.filename == "end.ts"
    )
  })

  it("rejects target-reserved local declarations and assignment targets at their own locations", () => {
    const source = `function select(flag: boolean, fallback: string): string {
  let end: string = fallback
  end = "yes"
  if (flag) return end
  else return fallback
}
console.log(select(true, "no"))
`
    const module = parse({filename: "reserved-local.ts", language: "typescript", source})

    assert.throws(
      () => generate({language: "ruby", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "ruby" && error.location?.filename == "reserved-local.ts" && error.location.start.line == 2
    )

    const declaration = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.functions[0].body.statements[0])
    const assignment = /** @type {import("../src/semantic/types.js").AssignmentStatement} */ (module.functions[0].body.statements[1])

    declaration.name = "value"
    assignment.target.name = "end"

    assert.throws(
      () => generate({language: "ruby", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "ruby" && error.location?.start.line == 3
    )
  })

  it("rejects TypeScript strict-mode parameter and assignment binding names at their own locations", () => {
    const parameterSource = `function select(flag: boolean, fallback: string): string {
  if (flag) return fallback
  else return fallback
}
console.log(select(true, "no"))
`
    const parameterModule = parse({filename: "strict-parameter.ts", language: "typescript", source: parameterSource})
    const parameterBranch = /** @type {import("../src/semantic/types.js").IfStatement} */ (parameterModule.functions[0].body.statements[0])
    const parameterReference = /** @type {import("../src/semantic/types.js").IdentifierExpression} */ (parameterBranch.condition)

    parameterModule.functions[0].parameters[0].name = "arguments"
    parameterReference.name = "arguments"

    assert.throws(
      () => generate({language: "typescript", module: parameterModule}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "typescript" && error.location?.filename == "strict-parameter.ts" && error.location.start.line == 1
    )

    const assignmentSource = `function select(flag: boolean, fallback: string): string {
  let result: string = fallback
  result = "yes"
  if (flag) return result
  else return fallback
}
console.log(select(true, "no"))
`
    const assignmentModule = parse({filename: "strict-assignment.ts", language: "typescript", source: assignmentSource})
    const assignment = /** @type {import("../src/semantic/types.js").AssignmentStatement} */ (assignmentModule.functions[0].body.statements[1])

    assignment.target.name = "eval"

    assert.throws(
      () => generate({language: "typescript", module: assignmentModule}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "typescript" && error.location?.filename == "strict-assignment.ts" && error.location.start.line == 3
    )

    assert.doesNotThrow(() => generate({language: "javascript", module: parameterModule}))
  })

  it("applies PHP and Ruby runtime binding restrictions to assignment targets", () => {
    const source = `function select(flag: boolean, fallback: string): string {
  let result: string = fallback
  result = "safe"
  if (flag) return result
  else return fallback
}
console.log(select(true, "no"))
`

    for (const [language, name] of [["php", "GLOBALS"], ["php", "this"], ["ruby", "_1"]]) {
      const module = parse({filename: `${name}-assignment.ts`, language: "typescript", source})
      const assignment = /** @type {import("../src/semantic/types.js").AssignmentStatement} */ (module.functions[0].body.statements[1])

      assignment.target.name = name

      assert.throws(
        () => generate({language, module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == language && error.location?.filename == `${name}-assignment.ts` &&
          error.location.start.line == 3 && error.message.includes("assignment target identifier"),
        `${language} ${name}`
      )
    }
  })

  it("rejects exact PHP auto-global parameter bindings at their declaration", () => {
    for (const name of ["_SERVER", "_GET", "_POST", "_FILES", "_COOKIE", "_SESSION", "_REQUEST", "_ENV"]) {
      const source = `function select(flag: boolean, ${name}: string): string {
  if (flag) return ${name}
  else return ${name}
}
console.log(select(true, "safe"))
`
      const module = parse({filename: `${name}-parameter.ts`, language: "typescript", source})

      assert.throws(
        () => generate({language: "php", module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == "php" && error.location?.filename == `${name}-parameter.ts` &&
          error.location.start.line == 1 && error.message.includes("parameter identifier"),
        name
      )
    }
  })

  it("rejects only entry locals that capture backend-owned scaffolding names", () => {
    const moduleWithEntryLocal = (name) => parse({
      filename: `${name}.ts`,
      language: "typescript",
      source: `function select(flag: boolean, fallback: string): string {
  if (flag) return fallback
  else return fallback
}
let ${name}: string = "captured"
console.log(select(true, "no"))
`
    })
    const consoleModule = moduleWithEntryLocal("console")
    const argsModule = moduleWithEntryLocal("args")
    const systemModule = moduleWithEntryLocal("System")

    for (const language of ["javascript", "typescript"]) {
      assert.throws(
        () => generate({language, module: consoleModule}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == language && error.location?.filename == "console.ts" && error.location.start.line == 5
      )
    }
    for (const [name, module] of [["args", argsModule], ["System", systemModule]]) {
      assert.throws(
        () => generate({language: "java", module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == "java" && error.location?.filename == `${name}.ts` && error.location.start.line == 5
      )
    }

    assert.doesNotThrow(() => generate({language: "ruby", module: consoleModule}))
    assert.doesNotThrow(() => generate({language: "javascript", module: argsModule}))
    assert.doesNotThrow(() => generate({language: "typescript", module: systemModule}))
    assert.doesNotThrow(() => generate({language: "ruby", module: moduleWithEntryLocal("puts")}))
    assert.doesNotThrow(() => generate({language: "php", module: moduleWithEntryLocal("PHP_EOL")}))
  })

  it("rejects only callable names that capture backend-owned print functions or receivers", () => {
    const moduleWithFunction = (name) => parse({
      filename: `${name}-function.ts`,
      language: "typescript",
      source: `function ${name}(flag: boolean, fallback: string): string {
  if (flag) return fallback
  else return fallback
}
console.log(${name}(true, "safe"))
`
    })
    const consoleModule = moduleWithFunction("console")
    const putsModule = moduleWithFunction("puts")

    for (const language of ["javascript", "typescript"]) {
      assert.throws(
        () => generate({language, module: consoleModule}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == language && error.location?.filename == "console-function.ts" && error.location.start.line == 1
      )
    }
    assert.throws(
      () => generate({language: "ruby", module: putsModule}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
        error.language == "ruby" && error.location?.filename == "puts-function.ts" && error.location.start.line == 1
    )

    assert.doesNotThrow(() => generate({language: "ruby", module: consoleModule}))
    assert.doesNotThrow(() => generate({language: "php", module: consoleModule}))
    assert.doesNotThrow(() => generate({language: "javascript", module: putsModule}))
    assert.doesNotThrow(() => generate({language: "java", module: putsModule}))
  })
})
