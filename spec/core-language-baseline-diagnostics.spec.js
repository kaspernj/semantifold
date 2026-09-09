// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generateArtifactSet, parse, SemantifoldDiagnostic} from "../index.js"

const expandedTargets = ["python", "csharp", "c", "cpp", "rust", "swift", "kotlin", "go"]
const csharpProgram = (body) => `#nullable enable

namespace Semantifold.Generated;

internal static class Program
{
    private static long choose(long left, long right)
    {
        ${body}
    }

    private static void Main()
    {
        System.Console.WriteLine(choose(1L, 2L));
    }
}
`
const rejectionCorpus = [
  {
    code: "PARSE_ERROR",
    filename: "parse-recovery.py",
    language: "python",
    name: "parse recovery",
    source: "def broken(left: int, right: int -> int:\n    return left\n"
  },
  {
    code: "MISSING_TYPE",
    filename: "missing-type.py",
    language: "python",
    name: "missing type",
    source: "def choose(left, right: int) -> int:\n    return left\n\nprint(choose(1, 2))\n"
  },
  {
    code: "NON_BOOLEAN_CONDITION",
    filename: "truthiness.py",
    language: "python",
    name: "truthiness",
    source: "def choose(left: int, right: int) -> int:\n    if left:\n        return left\n    else:\n        return right\n\nprint(choose(1, 2))\n"
  },
  {
    code: "MISMATCHED_EQUALITY_TYPES",
    filename: "coercion.py",
    language: "python",
    name: "numeric and Boolean coercion",
    source: "def same(left: int, right: bool) -> bool:\n    return left == right\n\nprint(same(1, True))\n"
  },
  {
    code: "UNSUPPORTED_SYNTAX",
    filename: "overflow.py",
    language: "python",
    name: "unsafe integer overflow",
    source: "def choose(left: int, right: int) -> int:\n    return left\n\nprint(choose(9007199254740992, 2))\n"
  },
  {
    code: "UNSUPPORTED_SYNTAX",
    filename: "dynamic.py",
    language: "python",
    name: "dynamic call",
    source: "def choose(left: int, right: int) -> int:\n    return int(left)\n\nprint(choose(1, 2))\n"
  },
  {
    code: "UNSUPPORTED_SYNTAX",
    filename: "reflection.cs",
    language: "csharp",
    name: "reflection",
    source: csharpProgram("return left.GetHashCode();")
  },
  {
    code: "UNSUPPORTED_SYNTAX",
    filename: "exception.cs",
    language: "csharp",
    name: "exception",
    source: csharpProgram("throw new System.Exception();")
  },
  {
    code: "UNSUPPORTED_SYNTAX",
    filename: "concurrency.go",
    language: "go",
    name: "concurrency",
    source: "package main\n\nimport \"fmt\"\n\nfunc choose(left int64, right int64) int64 { return left }\n\n" +
      "func main() { go fmt.Println(choose(1, 2)) }\n"
  }
]

describe("Task 025 expanded-language fail-loud acceptance", () => {
  it("uses one shared located frontend rejection corpus with stable language and code context", () => {
    for (const rejection of rejectionCorpus) {
      assert.throws(() => parse(rejection), (error) => {
        assert.ok(error instanceof SemantifoldDiagnostic, rejection.name)
        expect({code: error.code, filename: error.location?.filename, language: error.language, name: rejection.name})
          .toEqual({code: rejection.code, filename: rejection.filename, language: rejection.language, name: rejection.name})
        assert.ok(error.location.end.offset >= error.location.start.offset, rejection.name)
        return true
      })
    }
  })

  it("rejects every target's illegal name and malformed or Task 005 caller IR before returning artifacts", () => {
    const illegalNames = new Map([
      ["python", "print"], ["csharp", "Main"], ["c", "printf"], ["cpp", "WEOF"],
      ["rust", "main"], ["swift", "print"], ["kotlin", "main"], ["go", "main"]
    ])

    for (const language of expandedTargets) {
      const named = baseModule("illegal-name.ts")
      const name = /** @type {string} */ (illegalNames.get(language))

      named.functions[0].name = name
      named.entryPoint.body.statements[0].expression.callee = name
      expectCapabilityFailure(() => generateArtifactSet({language, module: named}), language, "illegal-name.ts")

      const malformed = baseModule("malformed-ir.ts")

      malformed.entryPoint.body.statements[0].kind = "WhileStatement"
      expectCapabilityFailure(() => generateArtifactSet({language, module: malformed}), language, "malformed-ir.ts")

      const laterArity = baseModule("task005-ir.ts")

      laterArity.functions[0].parameters.push({...laterArity.functions[0].parameters[0], name: "third"})
      expectCapabilityFailure(() => generateArtifactSet({language, module: laterArity}), language, "task005-ir.ts")
    }
  })

  it("rejects compile-time-known target overflow transactionally across every bounded native or managed backend", () => {
    const module = parse({
      filename: "known-overflow.ts",
      language: "typescript",
      source: "function choose(left: number, right: number): number { return left } " +
        "console.log(9007199254740991 * 2048)"
    })

    for (const language of expandedTargets.filter((candidate) => candidate != "python")) {
      expectCapabilityFailure(() => generateArtifactSet({language, module}), language, "known-overflow.ts")
    }
  })

  it("distinguishes a known registered ID without a requested role from an unknown language", () => {
    const module = baseModule("role.ts")

    for (const language of expandedTargets) {
      assert.throws(
        () => generateArtifactSet({language, module, role: "binary"}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_ROLE" &&
          error.language == language && error.location?.filename == "role.ts"
      )
    }
    assert.throws(
      () => generateArtifactSet({language: "task025-unknown", module}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_LANGUAGE" &&
        error.language == "task025-unknown"
    )
  })
})

/** @param {string} filename */
function baseModule(filename) {
  return parse({
    filename,
    language: "typescript",
    source: "function choose(left: number, right: number): number { return left + right } console.log(choose(1, 2))"
  })
}

/** @param {() => unknown} action @param {string} language @param {string} filename */
function expectCapabilityFailure(action, language, filename) {
  assert.throws(action, (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY" &&
    error.language == language && error.location?.filename == filename)
}
