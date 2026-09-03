// @ts-check

import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import {describe, expect, it} from "@velocious/testing"
import {generate, parse, SemantifoldDiagnostic} from "../index.js"

const execFileAsync = promisify(execFile)
const targets = ["php", "ruby", "javascript", "typescript", "java"]
const filenames = new Map([
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"]
])

/**
 * Removes source locations to compare modeled meaning.
 * @param {import("../src/semantic/types.js").SemanticModule} module - Semantic module.
 * @returns {import("../src/semantic/types.js").SemanticNodeWithoutLocations} Location-free semantic value.
 */
function withoutLocations(module) {
  return JSON.parse(JSON.stringify(module, (key, value) =>
    key == "location" || key == "provenance" || key == "sourceProvenance" ? undefined : value))
}

/**
 * Executes one generated program with its real language toolchain.
 * @param {string} language - Backend language.
 * @param {string} source - Generated source.
 * @returns {Promise<string>} Standard output.
 */
async function executeGenerated(language, source) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `semantifold-${language}-`))

  try {
    if (language == "php") {
      const filename = path.join(directory, "program.php")
      await writeFile(filename, source)

      return (await execFileAsync("php", [filename])).stdout
    }

    if (language == "ruby") {
      const filename = path.join(directory, "program.rb")
      await writeFile(filename, source)

      return (await execFileAsync("ruby", [filename])).stdout
    }

    if (language == "javascript") {
      const filename = path.join(directory, "program.js")
      await writeFile(filename, source)

      return (await execFileAsync(process.execPath, [filename])).stdout
    }

    if (language == "typescript") {
      const filename = path.join(directory, "program.ts")
      const compiler = path.resolve("node_modules/.bin/tsc")
      await writeFile(filename, source)
      await execFileAsync(compiler, [filename, "--target", "ES2024", "--module", "nodenext"], {cwd: directory})

      return (await execFileAsync(process.execPath, [path.join(directory, "program.js")])).stdout
    }

    const filename = path.join(directory, "Main.java")
    await writeFile(filename, source)
    await execFileAsync("javac", [filename], {cwd: directory})

    return (await execFileAsync("java", ["-cp", directory, "Main"])).stdout
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}

/**
 * Requires one backend capability diagnostic without losing its target context.
 * @param {() => unknown} callback - Generation callback.
 * @param {string} language - Expected backend language.
 * @returns {void}
 */
function expectUnsupportedCapability(callback, language) {
  /** @type {unknown} */
  let error

  try {
    callback()
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(SemantifoldDiagnostic)

  const diagnostic = /** @type {SemantifoldDiagnostic} */ (error)

  expect({code: diagnostic.code, expectedLanguage: language, language: diagnostic.language}).toEqual({
    code: "UNSUPPORTED_CAPABILITY",
    expectedLanguage: language,
    language
  })
}

/**
 * Checks captured process output for an expected compiler or runtime diagnostic.
 * @param {unknown} error - Rejected process error.
 * @param {string} fragment - Expected output fragment.
 * @returns {boolean} Whether stdout or stderr contains the fragment.
 */
function processFailureIncludes(error, fragment) {
  return error instanceof Error &&
    (("stdout" in error && typeof error.stdout == "string" && error.stdout.includes(fragment)) ||
      ("stderr" in error && typeof error.stderr == "string" && error.stderr.includes(fragment)))
}

describe("source backends", () => {
  it("generates independently executable exact-output programs for all five languages", async () => {
    const source = await readFile(new URL("fixtures/program.js", import.meta.url), "utf8")
    const semanticModule = parse({filename: "program.js", language: "javascript", source})

    for (const language of targets) {
      const generated = generate({language, module: semanticModule})
      const generatedModule = parse({filename: filenames.get(language), language, source: generated})
      const output = await executeGenerated(language, generated)

      expect({language, module: withoutLocations(generatedModule)}).toEqual({language, module: withoutLocations(semanticModule)})
      expect({language, output}).toEqual({language, output: "5\n"})
    }
  })

  it("decodes Java Unicode escapes through the real Java runtime", async () => {
    const source = `public final class Main {
  private static String label(boolean flag, String fallback) {
    if (flag) {
      return "\\u0061\\u005c\\u006e";
    } else {
      return fallback;
    }
  }

  public static void main(String[] args) {
    System.out.println(label(true, "no"));
  }
}
`
    const semanticModule = parse({filename: "Main.java", language: "java", source})
    const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (semanticModule.functions[0].body[0])
    const literal = /** @type {import("../src/semantic/types.js").StringLiteral} */ (branch.consequent[0].expression)

    expect(literal.value).toEqual("a\n")

    const generated = generate({language: "java", module: semanticModule})

    expect(await executeGenerated("java", generated)).toEqual("a\n\n")
  })

  it("round-trips and executes boolean and string scalar programs in all five languages", async () => {
    const source = await readFile(new URL("fixtures/scalars/program.js", import.meta.url), "utf8")
    const semanticModule = parse({filename: "program.js", language: "javascript", source})
    const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (semanticModule.functions[0].body[0])
    const literal = /** @type {import("../src/semantic/types.js").StringLiteral} */ (branch.consequent[0].expression)
    const expected = "quote \" slash \\ line\n tab\t dollar $ hash #{ snowman ☃ emoji 😀 nul \0"

    literal.value = expected

    for (const language of targets) {
      const generated = generate({language, module: semanticModule})
      const generatedModule = parse({filename: filenames.get(language), language, source: generated})
      const output = await executeGenerated(language, generated)

      expect({language, module: withoutLocations(generatedModule)}).toEqual({language, module: withoutLocations(semanticModule)})
      expect({language, output}).toEqual({language, output: `${expected}\n`})
    }
  })

  it("round-trips typed locals and assignment through all five real toolchains", async () => {
    const source = await readFile(new URL("fixtures/locals/program.js", import.meta.url), "utf8")
    const semanticModule = parse({filename: "program.js", language: "javascript", source})

    for (const language of targets) {
      const generated = generate({language, module: semanticModule})
      const generatedModule = parse({filename: filenames.get(language), language, source: generated})
      const output = await executeGenerated(language, generated)

      expect({language, module: withoutLocations(generatedModule)}).toEqual({language, module: withoutLocations(semanticModule)})
      expect({language, output}).toEqual({language, output: "yes\n"})
    }
  })

  it("rejects TypeScript strict-mode local bindings before the real compiler while JavaScript remains legal", async () => {
    const moduleWithLocal = (name) => parse({
      filename: `${name}.js`,
      language: "javascript",
      source: `/**
 * @param {boolean} flag - Selection flag.
 * @param {string} fallback - Fallback value.
 * @returns {string} Selected value.
 */
function select(flag, fallback) {
  /** @type {string} */
  let ${name} = fallback
  ${name} = "yes"
  if (flag) return ${name}
  else return fallback
}
console.log(select(true, "no"))
`
    })

    for (const name of ["arguments", "eval"]) {
      const module = moduleWithLocal(name)
      const javascript = generate({language: "javascript", module})

      expect(await executeGenerated("javascript", javascript)).toEqual("yes\n")
      await assert.rejects(
        () => executeGenerated("typescript", javascript),
        (error) => processFailureIncludes(error, "TS1215"),
        name
      )
      assert.throws(
        () => generate({language: "typescript", module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == "typescript" && error.location?.filename == `${name}.js` && error.location.start.line == 8,
        name
      )
    }

    for (const name of ["argument", "evaluate"]) {
      const generated = generate({language: "typescript", module: moduleWithLocal(name)})

      expect({name, output: await executeGenerated("typescript", generated)}).toEqual({name, output: "yes\n"})
    }
  })

  it("rejects TypeScript strict-mode function bindings before the real compiler", async () => {
    const moduleWithFunction = (name) => parse({
      filename: `${name}-function.js`,
      language: "javascript",
      source: `/**
 * @param {boolean} flag - Selection flag.
 * @param {string} fallback - Fallback value.
 * @returns {string} Selected value.
 */
function ${name}(flag, fallback) {
  if (flag) return fallback
  else return fallback
}
console.log(${name}(true, "safe"))
`
    })

    for (const name of ["arguments", "eval"]) {
      const module = moduleWithFunction(name)
      const javascript = generate({language: "javascript", module})

      expect(await executeGenerated("javascript", javascript)).toEqual("safe\n")
      await assert.rejects(
        () => executeGenerated("typescript", javascript),
        (error) => processFailureIncludes(error, "TS1215"),
        name
      )
      assert.throws(
        () => generate({language: "typescript", module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == "typescript" && error.location?.filename == `${name}-function.js` &&
          error.location.start.line == 6,
        name
      )
    }

    for (const name of ["argument", "evaluate"]) {
      const generated = generate({language: "typescript", module: moduleWithFunction(name)})

      expect({name, output: await executeGenerated("typescript", generated)}).toEqual({name, output: "safe\n"})
    }
  })

  it("enforces exact PHP predefined variable binding roles before the real runtime", async () => {
    const invalidParameterNames = ["GLOBALS", "_SERVER", "_GET", "_POST", "_FILES", "_COOKIE", "_SESSION", "_REQUEST", "_ENV", "this"]
    const invalidAssignedNames = ["GLOBALS", "this"]
    const moduleWithLocal = (keyword, name) => parse({
      filename: `${name}-local.ts`,
      language: "typescript",
      source: `function select(flag: boolean, fallback: string): string {
  if (flag) return fallback
  else return fallback
}
${keyword} ${name}: string = "safe"
console.log(select(true, "safe"))
`
    })
    const moduleWithParameter = (name) => parse({
      filename: `${name}-parameter.ts`,
      language: "typescript",
      source: `function select(flag: boolean, ${name}: string): string {
  if (flag) return "safe"
  else return "safe"
}
console.log(select(true, "safe"))
`
    })
    const moduleWithFunction = (name) => {
      const sourceName = name == "this" ? "thisFunction" : name
      const module = parse({
        filename: `${name}-function.ts`,
        language: "typescript",
        source: `function ${sourceName}(flag: boolean, fallback: string): string {
  if (flag) return fallback
  else return fallback
}
console.log(${sourceName}(true, "safe"))
`
      })

      if (name == "this") {
        module.functions[0].name = name
        const print = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body[0])
        const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (print.expression)

        call.callee = name
      }

      return module
    }
    const moduleWithAssignment = (name) => parse({
      filename: `${name}-assignment.ts`,
      language: "typescript",
      source: `function select(flag: boolean, fallback: string): string {
  if (flag) return fallback
  else return fallback
}
let ${name}: string = "before"
${name} = "safe"
console.log(select(true, ${name}))
`
    })

    for (const name of invalidParameterNames) {
      await assert.rejects(
        () => executeGenerated("php", `<?php\nfunction select($${name}, $fallback) { return $fallback; }\n`),
        (error) => processFailureIncludes(error, name)
      )
    }
    for (const name of invalidAssignedNames) {
      await assert.rejects(
        () => executeGenerated("php", `<?php\n$${name} = "safe";\n`),
        (error) => processFailureIncludes(error, name)
      )
    }

    for (const name of invalidAssignedNames) {
      for (const keyword of ["let", "const"]) {
        assert.throws(
          () => generate({language: "php", module: moduleWithLocal(keyword, name)}),
          (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
            error.language == "php" && error.location?.filename == `${name}-local.ts` && error.location.start.line == 5,
          `${keyword} ${name}`
        )
      }
    }
    for (const name of invalidParameterNames) {
      assert.throws(
        () => generate({language: "php", module: moduleWithParameter(name)}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == "php" && error.location?.filename == `${name}-parameter.ts` && error.location.start.line == 1,
        name
      )
    }

    for (const name of ["globals", "This", "_get", "thisValue"]) {
      expect({name, output: await executeGenerated("php", generate({language: "php", module: moduleWithAssignment(name)}))})
        .toEqual({name, output: "safe\n"})
    }
    for (const name of ["_SERVER", "_GET", "_POST", "_FILES", "_COOKIE", "_SESSION", "_REQUEST", "_ENV"]) {
      expect({name, output: await executeGenerated("php", generate({language: "php", module: moduleWithAssignment(name)}))})
        .toEqual({name, output: "safe\n"})
    }
    for (const name of ["php_errormsg", "http_response_header", "argc", "argv"]) {
      expect({name, output: await executeGenerated("php", generate({language: "php", module: moduleWithParameter(name)}))})
        .toEqual({name, output: "safe\n"})
    }
    for (const name of invalidParameterNames) {
      expect({name, output: await executeGenerated("php", generate({language: "php", module: moduleWithFunction(name)}))})
        .toEqual({name, output: "safe\n"})
    }
  })

  it("rejects Ruby numbered binding names while preserving _10", async () => {
    const moduleWithLocal = (name) => parse({
      filename: `${name}-local.ts`,
      language: "typescript",
      source: `function select(flag: boolean, fallback: string): string {
  if (flag) return fallback
  else return fallback
}
let ${name}: string = "safe"
console.log(select(true, ${name}))
`
    })
    const moduleWithParameter = (name) => parse({
      filename: `${name}-parameter.ts`,
      language: "typescript",
      source: `function select(flag: boolean, ${name}: string): string {
  if (flag) return ${name}
  else return ${name}
}
console.log(select(true, "safe"))
`
    })
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

    for (const source of [
      "_1 = \"safe\"\nputs _1\n",
      "def select(_1, fallback)\n  fallback\nend\n",
      "def _1(flag, fallback)\n  fallback\nend\n"
    ]) {
      await assert.rejects(
        () => executeGenerated("ruby", source),
        (error) => processFailureIncludes(error, "reserved for numbered parameter")
      )
    }

    for (let index = 1; index <= 9; index++) {
      const name = `_${index}`

      assert.throws(
        () => generate({language: "ruby", module: moduleWithLocal(name)}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == "ruby" && error.location?.filename == `${name}-local.ts` && error.location.start.line == 5,
        name
      )
    }
    for (const [role, module] of [["parameter", moduleWithParameter("_1")], ["function", moduleWithFunction("_9")]]) {
      assert.throws(
        () => generate({language: "ruby", module}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
          error.language == "ruby" && error.location?.filename == `_${role == "parameter" ? "1" : "9"}-${role}.ts` &&
          error.location.start.line == 1,
        role
      )
    }

    for (const module of [moduleWithLocal("_10"), moduleWithParameter("_10"), moduleWithFunction("_10")]) {
      expect(await executeGenerated("ruby", generate({language: "ruby", module}))).toEqual("safe\n")
    }
  })

  it("reparses generated Ruby local metadata after a multibyte initializer", async () => {
    const source = await readFile(new URL("fixtures/locals/program.js", import.meta.url), "utf8")
    const semanticModule = parse({filename: "program.js", language: "javascript", source})
    const preferred = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (semanticModule.functions[0].body[0])

    Reflect.set(preferred.initializer, "value", "☃")

    const generated = generate({language: "ruby", module: semanticModule})
    const generatedModule = parse({filename: "program.rb", language: "ruby", source: generated})

    expect(withoutLocations(generatedModule)).toEqual(withoutLocations(semanticModule))
    expect(await executeGenerated("ruby", generated)).toEqual("☃\n")
  })

  it("rejects unsafe scaffolding captures while executing safe Ruby and PHP spellings", async () => {
    const moduleWithEntryLocal = (name) => parse({
      filename: `${name}.ts`,
      language: "typescript",
      source: `function select(flag: boolean, fallback: string): string {
  if (flag) return fallback
  else return fallback
}
let ${name}: string = "captured"
console.log(select(true, "safe"))
`
    })

    for (const [language, name] of [["javascript", "console"], ["typescript", "console"], ["java", "args"], ["java", "System"]]) {
      expectUnsupportedCapability(() => generate({language, module: moduleWithEntryLocal(name)}), language)
    }

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

    for (const [language, name] of [["javascript", "console"], ["typescript", "console"], ["ruby", "puts"]]) {
      expectUnsupportedCapability(() => generate({language, module: moduleWithFunction(name)}), language)
    }

    const rubySource = generate({language: "ruby", module: moduleWithEntryLocal("puts")})
    const phpSource = generate({language: "php", module: moduleWithEntryLocal("PHP_EOL")})

    expect(await executeGenerated("ruby", rubySource)).toEqual("safe\n")
    expect(await executeGenerated("php", phpSource)).toEqual("safe\n")

    for (const [language, name] of [["javascript", "puts"], ["typescript", "puts"], ["ruby", "console"], ["php", "console"], ["java", "puts"]]) {
      const source = generate({language, module: moduleWithFunction(name)})

      expect({language, output: await executeGenerated(language, source)}).toEqual({language, output: "safe\n"})
    }
  })
})
