// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

const withoutLocations = (value) => JSON.parse(JSON.stringify(value, (key, nested) =>
  key == "location" || key == "provenance" || key == "sourceProvenance" ? undefined : nested))

/**
 * Parses Python and requires one diagnostic code.
 * @param {string} source - Python source.
 * @param {string} code - Expected diagnostic code.
 * @param {number} [line] - Expected start line.
 * @returns {void}
 */
function expectDiagnostic(source, code, line) {
  assert.throws(
    () => parse({filename: "program.py", language: "python", source}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == code && error.language == "python" &&
      (line === undefined || error.location?.start.line == line)
  )
}

describe("Python frontend validation", () => {
  it("normalizes every Tasks 001-004 Python fixture to the existing typed semantic meaning", async () => {
    for (const [directory, comparison] of [
      ["", "program.ts"],
      ["scalars/", "scalars/program.ts"],
      ["locals/", "locals/program.ts"],
      ["operators/", "operators/program.ts"],
      ["statements/", "statements/program.ts"]
    ]) {
      const [python, typescript] = await Promise.all([
        readFile(new URL(`fixtures/${directory}program.py`, import.meta.url), "utf8"),
        readFile(new URL(`fixtures/${comparison}`, import.meta.url), "utf8")
      ])
      const actual = parse({filename: "program.py", language: "python", source: python})
      const expected = parse({filename: "program.ts", language: "typescript", source: typescript})

      expect(withoutLocations(actual)).toEqual(withoutLocations(expected))
    }
  })

  it("verifies parser boundaries as exact UTF-16 locations across astral text and CRLF", () => {
    const source = "# 😀\r\ndef café(text: str, enabled: bool) -> str:\r\n    if enabled:\r\n        return \"😀\\n\"\r\n    else:\r\n        return text\r\n\r\nprint(café(\"é\", True))\r\n"
    const module = parse({filename: "unicode.py", language: "python", source})
    const declaration = module.functions[0]
    const result = /** @type {import("../src/semantic/types.js").ReturnStatement} */ (
      /** @type {import("../src/semantic/types.js").IfStatement} */ (declaration.body.statements[0]).consequent.statements[0])
    const literal = /** @type {import("../src/semantic/types.js").StringLiteral} */ (result.expression)

    expect(declaration.name).toEqual("café")
    expect(declaration.location.start).toEqual({column: 1, line: 2, offset: 6})
    expect(literal.value).toEqual("😀\n")
    expect(literal.location.start).toEqual({column: 16, line: 4, offset: 82})
    expect(literal.location.end).toEqual({column: 22, line: 4, offset: 88})
  })

  it("distinguishes missing types from unsupported annotations at useful spans", () => {
    expectDiagnostic("def choose(left, right: int) -> int:\n    return right\n\nprint(choose(1, 2))\n", "MISSING_TYPE", 1)
    expectDiagnostic("def choose(left: int, right: int):\n    return right\n\nprint(choose(1, 2))\n", "MISSING_TYPE", 1)
    expectDiagnostic("def choose(left: int, right: int) -> int:\n    value = left\n    return value\n\nprint(choose(1, 2))\n", "MISSING_TYPE", 2)

    for (const annotation of ["Any", "object", "None", "list[int]", "int | str", "\"int\""]) {
      expectDiagnostic(`def choose(left: ${annotation}, right: int) -> int:\n    return right\n\nprint(choose(1, 2))\n`, "UNSUPPORTED_SYNTAX", 1)
    }
  })

  it("rejects parser recovery, invalid Unicode scalar input, truthiness, and Boolean-integer mixing explicitly", () => {
    expectDiagnostic("def broken(left: int, right: int -> int:\n    return left\n", "PARSE_ERROR", 1)
    expectDiagnostic("# \uD800\ndef choose(left: int, right: int) -> int:\n    return left\n\nprint(choose(1, 2))\n", "PARSE_ERROR")
    expectDiagnostic("def choose(left: int, right: int) -> int:\n    if left:\n        return left\n    else:\n        return right\n\nprint(choose(1, 2))\n", "NON_BOOLEAN_CONDITION", 2)
    expectDiagnostic("def choose(left: bool, right: int) -> int:\n    return left + right\n\nprint(choose(True, 2))\n", "INVALID_OPERAND_TYPE", 2)
  })

  it("rejects Python dynamic forms and every executable child that is not adapted", () => {
    const sources = [
      "import os\n",
      "class Value:\n    pass\n",
      "async def choose(left: int, right: int) -> int:\n    return left\n",
      "@decorator\ndef choose(left: int, right: int) -> int:\n    return left\n",
      "def choose(left: int = 1, right: int = 2) -> int:\n    return left\n",
      "def choose(*values: int) -> int:\n    return 1\n",
      "def choose(left: int, /, right: int) -> int:\n    return left\n",
      "def choose(left: int, *, right: int) -> int:\n    return left\n",
      "def choose(left: int, right: int) -> int:\n    for value in (left, right):\n        return value\n    return right\n",
      "def choose(left: int, right: int) -> int:\n    while left < right:\n        return left\n    return right\n",
      "def choose(left: int, right: int) -> int:\n    with resource:\n        return left\n    return right\n",
      "def choose(left: int, right: int) -> int:\n    try:\n        return left\n    except Exception:\n        return right\n",
      "def choose(left: int, right: int) -> int:\n    match left:\n        case 1:\n            return right\n    return left\n",
      "def choose(left: int, right: int) -> int:\n    global value\n    return left\n",
      "def choose(left: int, right: int) -> int:\n    def nested(a: int, b: int) -> int:\n        return a\n    return nested(left, right)\n",
      "def choose(left: int, right: int) -> int:\n    return [value for value in (left, right)][0]\n",
      "def choose(left: int, right: int) -> int:\n    return (value := left)\n",
      "def choose(left: int, right: int) -> int:\n    yield left\n    return right\n",
      "def choose(left: int, right: int) -> int:\n    return (lambda value: value)(left)\n",
      "def choose(left: int, right: int) -> int:\n    return object.method(left, right)\n",
      "def choose(left: int, right: int) -> int:\n    return values[left]\n",
      "def choose(left: int, right: int) -> int:\n    return left if left > right else right\n",
      "def choose(left: int, right: int) -> int:\n    \"docstring\"\n    return left\n",
      "def choose(left: int, right: int) -> int:\n    return left\n\nprint(choose(left=1, right=2))\n",
      "def choose(left: int, right: int) -> int:\n    return left\n\nprint(choose(*(1, 2)))\n",
      "def choose(left: int, right: int) -> int:\n    return left\n\nprint(choose(1, 2), 3)\n",
      "def choose(left: int, right: int) -> int:\n    return b\"bytes\"\n\nprint(choose(1, 2))\n",
      "def choose(left: int, right: int) -> str:\n    return f\"{left}\"\n\nprint(choose(1, 2))\n",
      "def choose(left: int, right: int) -> str:\n    return r\"raw\"\n\nprint(choose(1, 2))\n",
      "def choose(left: int, right: int) -> str:\n    return \"a\" \"b\"\n\nprint(choose(1, 2))\n",
      "def choose(left: int, right: int) -> str:\n    return \"\\uD800\"\n\nprint(choose(1, 2))\n"
    ]

    for (const source of sources) expectDiagnostic(source, "UNSUPPORTED_SYNTAX")
    expectDiagnostic("def choose(left: int, right: int) -> int:\n    value: int = left\n\nprint(choose(1, 2))\n", "MISSING_RETURN")
  })

  it("preserves mutable locals and the exact adjacent immutable carrier without treating comments as code", () => {
    const source = `def choose(flag: bool, fallback: str) -> str:
    # ordinary comment
    mutable: str = fallback
    # @semantifold-immutable
    fixed: str = "yes"
    if flag:
        return fixed
    else:
        return mutable

print(choose(True, "no"))
`
    const module = parse({filename: "locals.py", language: "python", source})
    const [mutable, fixed] = /** @type {import("../src/semantic/types.js").LocalDeclaration[]} */ (module.functions[0].body.statements.slice(0, 2))

    expect({fixed: fixed.mutable, mutable: mutable.mutable}).toEqual({fixed: false, mutable: true})
    expectDiagnostic(source.replace("return fixed", "fixed = mutable\n        return fixed"), "IMMUTABLE_ASSIGNMENT", 7)
  })

  it("rejects hard/soft keywords and annotation or print capture hazards", () => {
    for (const name of ["match", "case", "type", "_", "print", "int", "bool", "str", "K"]) {
      expectDiagnostic(`def ${name}(left: int, right: int) -> int:\n    return left\n\nprint(${name}(1, 2))\n`, "UNSUPPORTED_SYNTAX")
    }
  })
})
