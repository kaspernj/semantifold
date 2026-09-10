// @ts-check

import {describe, expect, it} from "@velocious/testing"
import assert from "node:assert/strict"
import {parse, SemantifoldDiagnostic} from "../index.js"

function withoutSource(value) {
  return JSON.parse(JSON.stringify(value, (key, item) =>
    ["location", "provenance", "sourceProvenance"].includes(key) ? undefined : item))
}

function rejects(source, code) {
  assert.throws(
    () => parse({filename: "optional-flow.ts", language: "typescript", source}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == code
  )
}

describe("optional values and presence narrowing", () => {
  it("models contextual presence, absence, testing, and guarded unwrap", () => {
    const module = parse({
      filename: "optional.ts",
      language: "typescript",
      source: `function maybe(value: string, present: boolean): string | null {
  if (present) return value
  else return null
}
function label(value: string | null): string {
  if (value !== null) return value
  else return "absent"
}
console.log(label(maybe("ready", true)))
`
    })
    const maybe = module.functions[0]
    const label = module.functions[1]
    const maybeBranch = /** @type {import("../src/semantic/types.js").IfStatement} */ (maybe.body.statements[0])
    const labelBranch = /** @type {import("../src/semantic/types.js").IfStatement} */ (label.body.statements[0])
    const maybeAlternate = /** @type {import("../src/semantic/types.js").Block} */ (maybeBranch.alternate)

    expect(withoutSource(maybe.returnType)).toEqual({
      kind: "OptionalType",
      valueType: {kind: "TypeReference", name: "string"}
    })
    expect(/** @type {import("../src/semantic/types.js").ReturnStatement} */ (
      maybeBranch.consequent.statements[0]
    ).expression?.kind).toEqual("OptionalSome")
    expect(/** @type {import("../src/semantic/types.js").ReturnStatement} */ (
      maybeAlternate.statements[0]
    ).expression?.kind).toEqual("OptionalNone")
    expect(labelBranch.condition.kind).toEqual("OptionalIsPresent")
    expect(/** @type {import("../src/semantic/types.js").ReturnStatement} */ (
      labelBranch.consequent.statements[0]
    ).expression?.kind).toEqual("OptionalUnwrap")
  })

  it("rejects unchecked and assignment-invalidated unwraps with one stable semantic failure", () => {
    rejects(`function unchecked(value: string | null): string {
  if (value !== null) return "present"
  else return value
}
console.log(unchecked(null))
`, "UNCHECKED_OPTIONAL_UNWRAP")
    rejects(`function invalidated(seed: string | null): string {
  let value: string | null = seed
  if (value !== null) {
    value = seed
    return value
  } else return "absent"
}
console.log(invalidated(null))
`, "UNCHECKED_OPTIONAL_UNWRAP")
    rejects(`function invalidatedAfterJoin(seed: string | null, rewrite: boolean): string {
  let value: string | null = seed
  if (value !== null) {
    if (rewrite) {
      value = seed
    } else {
      console.log("unchanged")
    }
    return value
  } else return "absent"
}
console.log(invalidatedAfterJoin(null, false))
`, "UNCHECKED_OPTIONAL_UNWRAP")
    rejects(`function invalidatedByAbruptLoopExit(seed: string | null, rewrite: boolean): string {
  let value: string | null = seed
  if (value !== null) {
    const iterations: readonly number[] = [1]
    for (const ignored of iterations) {
      if (rewrite) { value = null; break }
    }
    return value
  } else return "absent"
}
console.log(invalidatedByAbruptLoopExit("ready", true))
`, "UNCHECKED_OPTIONAL_UNWRAP")
  })

  it("retains shadowing rejection and optional return completeness", () => {
    rejects(`function shadowed(value: string | null): string {
  if (value !== null) {
    const value: string = "shadow"
    return value
  } else return "absent"
}
console.log(shadowed(null))
`, "DUPLICATE_BINDING")
    rejects(`function incomplete(value: string, present: boolean): string | null {
  if (present) return value
}
console.log(incomplete("ready", true))
`, "MISSING_RETURN")
  })

  it("requires Some to contain the exact non-void optional constituent", () => {
    rejects(`function wrong(): string | null {
  return 1
}
console.log(wrong())
`, "TYPE_MISMATCH")
    rejects(`function ping(): void {
  return
}
function wrong(): string | null {
  return ping()
}
console.log(wrong())
`, "VOID_AS_VALUE")
  })

  it("narrows the alternate branch of one directly negated presence test", () => {
    const module = parse({
      filename: "optional-alternate.ts",
      language: "typescript",
      source: `function label(value: string | null): string {
  if (!(value !== null)) return "absent"
  else return value
}
console.log(label(null))
`
    })
    const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.functions[0].body.statements[0])
    const alternate = /** @type {import("../src/semantic/types.js").Block} */ (branch.alternate)

    expect(branch.condition.kind).toEqual("UnaryExpression")
    expect(/** @type {import("../src/semantic/types.js").ReturnStatement} */ (
      alternate.statements[0]
    ).expression?.kind).toEqual("OptionalUnwrap")
  })
})
