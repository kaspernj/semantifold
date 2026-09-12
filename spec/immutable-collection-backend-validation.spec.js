// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {generate, generateArtifact, generateArtifactSet, languageCapabilities, parse, SemantifoldDiagnostic} from "../index.js"

const cohort = ["php", "ruby", "javascript", "typescript", "java"]

async function collectionModule() {
  const source = await readFile(new URL("fixtures/collections/program.ts", import.meta.url), "utf8")

  return parse({filename: "program.ts", language: "typescript", source})
}

function backendFailure(language) {
  return (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" && error.language == language
}

describe("immutable collection backend validation", () => {
  it("advertises exactly the original-five immutable collection cohort", () => {
    expect(languageCapabilities.filter(({features}) => features.immutableCollections).map(({id}) => id)).toEqual(cohort)
  })

  it("rejects cyclic recursive types and stale access proofs through every generation API", async () => {
    for (const mutate of [
      (module) => {
        const local = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (module.entryPoint.body.statements[0])
        const cycle = /** @type {any} */ ({kind: "ListType"})

        cycle.elementType = cycle
        local.type = cycle
      },
      (module) => {
        const outputStatement = /** @type {import("../src/semantic/types.js").PrintStatement} */ (module.entryPoint.body.statements[5])
        const access = /** @type {import("../src/semantic/types.js").ListIndexExpression} */ (outputStatement.expression)

        access.index = {
          kind: "IntegerLiteral", location: outputStatement.expression.location, value: 99
        }
      }
    ]) {
      for (const api of [generate, generateArtifact, generateArtifactSet]) {
        const module = await collectionModule()

        mutate(module)
        assert.throws(() => api({language: "typescript", module}), backendFailure("typescript"))
      }
    }
  })

  it("rejects Java Map.of arity limits before emitting an artifact", () => {
    const entries = Array.from({length: 11}, (_, index) => `["key${index}", ${index}]`).join(", ")
    const module = parse({
      filename: "many.ts",
      language: "typescript",
      source: `function identity(value: number): number { return value }\nconst values: ReadonlyMap<string, number> = new Map([${entries}])\nconsole.log(values.size)\n`
    })

    assert.throws(() => generate({language: "java", module}), backendFailure("java"))
  })

  it("does not translate target-specific absence failures into optional reads", () => {
    const ruby = parse({
      filename: "dynamic.rb",
      language: "ruby",
      source: `# @param values [Hash[String,Integer]]
# @param key [String]
# @return [Integer]
def read(values, key)
  return values.fetch(key)
end
# @type [Hash[String,Integer]]
values = {"present" => 1}
puts read(values, "present")
`
    })

    expect(generate({language: "ruby", module: ruby})).toContain(".fetch(")
    for (const language of ["javascript", "typescript", "php", "java"]) {
      assert.throws(() => generate({language, module: ruby}), backendFailure(language))
    }
  })

  it("keeps Java dynamic list bounds failure target-specific", () => {
    const java = parse({
      filename: "Main.java",
      language: "java",
      source: `public final class Main {
  private static int read(java.util.List<Integer> values, int index) {
    return values.get(index);
  }
  public static void main(String[] args) {
    System.out.println(read(java.util.List.of(7), 0));
  }
}
`
    })

    expect(generate({language: "java", module: java})).toContain(".get(index)")
    for (const language of ["javascript", "typescript", "php", "ruby"]) {
      assert.throws(() => generate({language, module: java}), backendFailure(language))
    }
  })

  it("checks Java inherited-method collisions with collection parameter erasure", () => {
    const module = parse({
      filename: "wait.ts",
      language: "typescript",
      source: `function wait(values: readonly number[]): readonly number[] {
  return values
}
const values: readonly number[] = [1]
console.log(wait(values).length)
`
    })

    expect(generate({language: "java", module})).toContain("wait(java.util.List<Integer> values)")
  })

  it("rejects shadowed Map construction and collection runtime-helper capture before emission", () => {
    const mapCaptureSource = `function Map(value: number): number { return value }
const values: ReadonlyMap<string, number> = new Map([["answer", 42]])
console.log(values.size)
`

    assert.throws(
      () => parse({filename: "map-capture.ts", language: "typescript", source: mapCaptureSource}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" &&
        mapCaptureSource.slice(error.location.start.offset, error.location.end.offset) == "Map"
    )
    const countCapture = parse({
      filename: "count-capture.ts",
      language: "typescript",
      source: `function count(value: number): number { return value }
const values: readonly number[] = [1]
console.log(values.length)
`
    })

    assert.throws(() => generate({language: "php", module: countCapture}), backendFailure("php"))
  })

  it("rejects Java package-qualifier capture transactionally", () => {
    const source = `function singleton(java: number): readonly number[] {
  return [java]
}
console.log(singleton(42).length)
`

    for (const api of [generate, generateArtifact, generateArtifactSet]) {
      const module = parse({filename: "java-capture.ts", language: "typescript", source})

      assert.throws(
        () => api({language: "java", module}),
        (error) => backendFailure("java")(error) && error.detail.includes("function parameter 'java' captures java.util factory syntax") &&
          source.slice(error.location.start.offset, error.location.end.offset) == "java: number"
      )
    }
  })

  it("rejects a Java local that captures its own collection factory initializer", () => {
    const source = `function identity(value: number): number { return value }
const java: readonly number[] = [1]
console.log(java.length)
`

    for (const api of [generate, generateArtifact, generateArtifactSet]) {
      const module = parse({filename: "java-self-capture.ts", language: "typescript", source})

      assert.throws(
        () => api({language: "java", module}),
        (error) => backendFailure("java")(error) && error.detail.includes("entry local 'java' captures java.util factory syntax") &&
          source.slice(error.location.start.offset, error.location.end.offset) == "const java: readonly number[] = [1]"
      )
    }

    const safeModule = parse({
      filename: "java-without-factory-capture.ts",
      language: "typescript",
      source: `function pass(values: readonly number[]): readonly number[] {
  return values
}
const values: readonly number[] = [1]
const java: readonly number[] = pass(values)
console.log(java.length)
`
    })

    expect(generate({language: "java", module: safeModule})).toContain("java.util.List<Integer> java = pass(values)")
  })

  it("rejects a cyclic recursive type in a forward call signature without native recursion failure", () => {
    const module = parse({
      filename: "forward.ts",
      language: "typescript",
      source: `function caller(): readonly number[] { return callee() }
function callee(): readonly number[] { return [1] }
console.log(caller().length)
`
    })
    const cycle = /** @type {any} */ ({kind: "ListType"})

    cycle.elementType = cycle
    module.functions[1].returnType = cycle
    assert.throws(() => generate({language: "typescript", module}), backendFailure("typescript"))
  })
})
