// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

const csharp = /** @type {any} */ ("csharp")

/** @param {string} source @param {string} code */
function expectDiagnostic(source, code) {
  assert.throws(
    () => parse({filename: "Program.cs", language: csharp, source}),
    (error) => Boolean(error instanceof SemantifoldDiagnostic && error.code == code && error.language == "csharp" && error.location),
    source
  )
}

/** @param {string} member @param {string} [main] */
function program(member, main = "System.Console.WriteLine(Value(1L, 2L));") {
  return `#nullable enable

namespace Semantifold.Generated;

internal static class Program
{
${member}

    private static void Main()
    {
        ${main}
    }
}
`
}

describe("C# frontend validation", () => {
  it("normalizes the canonical C# profile into the shared semantic module", async () => {
    const source = await readFile(new URL("fixtures/Program.cs", import.meta.url), "utf8")
    const module = parse({filename: "Program.cs", language: csharp, source})

    expect(module.kind).toEqual("Module")
    expect(module.functions.map(({name}) => name)).toEqual(["difference"])
    expect(module.entryPoint.body.statements.length).toEqual(1)
  })

  it("normalizes all five Tasks 001-004 profiles with rich parser-owned ranges", async () => {
    let sawOperatorRange = false

    for (const fixture of ["Program.cs", "scalars/Program.cs", "locals/Program.cs", "operators/Program.cs", "statements/Program.cs"]) {
      const source = await readFile(new URL(`fixtures/${fixture}`, import.meta.url), "utf8")
      const module = parse({filename: "Program.cs", language: csharp, source})

      expect(module.kind).toEqual("Module")
      expect(module.functions.length > 0).toBeTrue()
      expect(module.provenance.sources[0]).toEqual({content: source, filename: "Program.cs", id: "source:0", language: "csharp"})
      expect(module.provenance.nodes.some(({ranges}) => ranges.name)).toBeTrue()
      sawOperatorRange ||= module.provenance.nodes.some(({ranges}) => ranges.operator)
    }
    expect(sawOperatorRange).toBeTrue()
  })

  it("accepts only exact scalar aliases and reports inferred locals as missing types", () => {
    const aliases = program(`    private static System.Int64 Value(System.Int64 left, System.Int64 right)
    {
        System.Boolean flag = true;
        System.String text = "ok";
        if (flag == true)
        {
            System.Console.WriteLine(text);
        }
        return checked(left - right);
    }`)

    expect(parse({filename: "Program.cs", language: csharp, source: aliases}).functions[0].returnType.name).toEqual("integer")
    const ordinaryArgsBinding = program(`    private static long Value(long args, long right)
    {
        return checked(args - right);
    }`)

    expect(parse({filename: "Program.cs", language: csharp, source: ordinaryArgsBinding}).functions[0].parameters[0].name)
      .toEqual("args")
    expectDiagnostic(program(`    private static long Value(long left, long right)
    {
        var result = left;
        return result;
    }`), "MISSING_TYPE")
  })

  it("rejects nullable, dynamic, coercive, unchecked, and noncanonical constructs", () => {
    const unsupported = [
      program("    private static string? Value(long left, long right) { return null; }"),
      program("    private static Int64 Value(long left, long right) { return 1L; }"),
      program("    private static global::System.Int64 Value(long left, long right) { return 1L; }"),
      program("    private static object Value(long left, long right) { return left; }"),
      program("    private static dynamic Value(long left, long right) { return left; }"),
      program("    private static long Value(long left, long right) { return (long)left; }"),
      program("    private static long Value(long left, long right) { return 1; }"),
      program("    private static long Value(long left, long right) { return 1l; }"),
      program("    private static long Value(long left, long right) { return 0x1L; }"),
      program("    private static long Value(long left, long right) { return 9007199254740992L; }"),
      program("    private static long Value(long left, long right) { return unchecked(left - right); }"),
      program("    private static long Value(long left, long right) { checked { return left - right; } }"),
      program("    private static long Value(long left, long right) { return left - right; }"),
      program("    private static long Value(long left, long right) { return left + right; }"),
      program("    private static bool Value(string left, string right) { return object.ReferenceEquals(left, right); }", "System.Console.WriteLine(Value(\"a\", \"b\"));"),
      program("    private static string Value(string left, string right) { return $\"{left}{right}\"; }", "System.Console.WriteLine(Value(\"a\", \"b\"));"),
      program("    private static string Value(string left, string right) { return @\"text\"; }", "System.Console.WriteLine(Value(\"a\", \"b\"));"),
      program("    private static string Value(string left, string right) { return \"\"\"text\"\"\"; }", "System.Console.WriteLine(Value(\"a\", \"b\"));"),
      program("    private static long Value(long left, long right) { const long value = 1L; return value; }"),
      program("    private static long Value(ref long left, long right) { return checked(left - right); }"),
      program("    private static long Value(out long left, long right) { left = right; return left; }"),
      program("    private static long Value(in long left, long right) { return checked(left - right); }"),
      program("    private static long Value(scoped long left, long right) { return checked(left - right); }"),
      program("    private static long Value(params long[] left) { return left[0]; }", "System.Console.WriteLine(Value(1L, 2L));"),
      program("    private static long Value(long left, long right = 1L) { return checked(left - right); }"),
      program("    private static long Value<T>(long left, long right) { return checked(left - right); }"),
      program("    private static async long Value(long left, long right) { return checked(left - right); }"),
      program("    private static unsafe long Value(long left, long right) { return checked(left - right); }"),
      program("    private static long Value(long left, long right) { yield return left; }"),
      program("    private static long Value(long left, long right) { while (left < right) { return left; } return right; }"),
      program("    private static long Value(long left, long right) { try { return left; } catch { return right; } }"),
      program("    private static long Value(long left, long right) { return left is 1L ? left : right; }"),
      program("    private static long Value(long left, long right) { System.Func<long, long> f = x => x; return f(left); }"),
      program("    private static long Value(long left, long right) { return left!; }"),
      program("    private static long Value(long left, long right) { return Other.Value(left, right); }"),
      program("    private static long Value(long left, long right) { return Value(left: left, right: right); }")
    ]

    for (const source of unsupported) expectDiagnostic(source, "UNSUPPORTED_SYNTAX")

    const base = program("    private static long Value(long left, long right) { return checked(left - right); }")

    for (const source of [
      base.replace("#nullable enable\n", ""),
      base.replace("#nullable enable", "#nullable disable"),
      base.replace("#nullable enable", "#nullable enable   "),
      `using System;\n${base}`,
      `using Alias = System.Int64;\n${base}`,
      base.replace("internal static class Program", "public static class Program"),
      base.replace("internal static class Program", "[System.Obsolete]\ninternal static class Program"),
      base.replace("{\n    private static long Value", "{\n    private static long field;\n    private static long Value"),
      base.replace("private static void Main()", "public static void Main(string[] args)")
    ]) expectDiagnostic(source, "UNSUPPORTED_SYNTAX")

    expectDiagnostic(program("    private static long select(long left, long right) { return checked(left - right); }",
      "System.Console.WriteLine(select(1L, 2L));"), "UNSUPPORTED_SYNTAX")
    expectDiagnostic(program(`    private static long Value(long left, long right) { return checked(left - right); }

    private static long Value(long left, long right) { return checked(left + right); }`), "DUPLICATE_BINDING")
  })

  it("rejects recovery, lone surrogates, reserved names, and System capture at located diagnostics", () => {
    expectDiagnostic(program("    private static long Value(long left, long right) { return checked(left - ); }"), "PARSE_ERROR")
    expectDiagnostic(`// \uD800\n${program("    private static long Value(long left, long right) { return checked(left - right); }")}`, "PARSE_ERROR")
    expectDiagnostic(program("    private static long @Value(long left, long right) { return checked(left - right); }", "System.Console.WriteLine(@Value(1L, 2L));"), "UNSUPPORTED_SYNTAX")
    for (const name of ["allows", "extension"]) {
      expectDiagnostic(program(`    private static long ${name}(long left, long right) { return checked(left - right); }`,
        `System.Console.WriteLine(${name}(1L, 2L));`), "UNSUPPORTED_SYNTAX")
    }
    expectDiagnostic(program("    private static long Program(long left, long right) { return checked(left - right); }", "System.Console.WriteLine(Program(1L, 2L));"), "UNSUPPORTED_SYNTAX")
    expectDiagnostic(program("    private static long System(long left, long right) { return checked(left - right); }", "System.Console.WriteLine(System(1L, 2L));"), "UNSUPPORTED_SYNTAX")
    expectDiagnostic(program("    private static long Value(long System, long right) { return checked(System - right); }"), "UNSUPPORTED_SYNTAX")
  })
})
