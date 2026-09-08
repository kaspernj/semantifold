// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generate, parse, SemantifoldDiagnostic} from "../index.js"
import {cppRuntime} from "../src/backends/cpp-runtime.js"

const moduleFrom = () => parse({language: "typescript", filename: "source.ts", source:
  'function sum(left: number, right: number): number { return left + right; } console.log(sum(4, 9));'})
const read = source => parse({language: "cpp", filename: "program.cpp", source})
const generated = () => generate({language: "cpp", module: moduleFrom()})
const stringCaller = statement => cppRuntime +
  `\nstd::string join(std::string left, std::string right) { return left + right; }\nint main() { ${statement} return 0; }\n`
const caller = (body = "return left;", signature = "std::int64_t sum(std::int64_t left, std::int64_t right)") => {
  const code = generated()
  const end = "/* semantifold:runtime:cpp:v1 end */"
  const runtime = code.slice(code.indexOf("#include"), code.indexOf(end) + end.length)

  return runtime + `\n${signature} { ${body} }\nint main() { semantifold_print_integer(sum(std::int64_t(4), std::int64_t(9))); return 0; }\n`
}
const syntaxFailure = error => error instanceof SemantifoldDiagnostic && error.language == "cpp" &&
  ["UNSUPPORTED_SYNTAX", "PARSE_ERROR", "MISSING_TYPE", "TYPE_MISMATCH", "INVALID_OPERAND", "NON_BOOLEAN_CONDITION", "DUPLICATE_FUNCTION"].includes(error.code) && Boolean(error.location)

describe("C++ independent CST frontend", () => {
  it("rejects a raw carriage return at its ordinary string-content node", () => {
    const source = stringCaller('semantifold_print_string(std::string("a\rb", 3));')

    assert.throws(() => read(source), error => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" &&
      error.language == "cpp" && error.location?.filename == "program.cpp" &&
      source.slice(error.location.start.offset, error.location.end.offset) == "a\rb")
  })

  it("rejects raw LF and CRLF inside ordinary literals while preserving escaped line breaks", () => {
    for (const lineBreak of ["\n", "\r\n"]) {
      const source = stringCaller(`semantifold_print_string(std::string("a${lineBreak}b", ${2 + lineBreak.length}));`)

      assert.throws(() => read(source), syntaxFailure)
    }
    for (const ending of ["\n", "\r\n", "\r"]) {
      const ordinary = stringCaller('semantifold_print_string(std::string("a\\r\\nb\\000é😀", 11));')
      const source = ending == "\r" ? cppRuntime + ordinary.slice(cppRuntime.length).replaceAll("\n", ending) : ordinary.replaceAll("\n", ending)
      const module = read(source)

      expect(module.entryPoint.body.statements[0].expression.value).toEqual("a\r\nb\0é😀")
      expect(read(generate({language: "cpp", module})).entryPoint.body.statements[0].expression.value).toEqual("a\r\nb\0é😀")
    }
  })

  it("locates deeply nested CST failures before native stack errors can escape", () => {
    for (const depth of [600, 6000]) {
      const source = caller("return " + "(".repeat(depth) + "left" + ")".repeat(depth) + ";")

      assert.throws(() => read(source), error => error instanceof SemantifoldDiagnostic && error.language == "cpp" &&
        ["UNSUPPORTED_SYNTAX", "PARSE_ERROR"].includes(error.code) && error.location?.filename == "program.cpp")
    }
  })

  it("rejects untyped native int literals whose intermediate arithmetic has different bounds", () => {
    for (const expression of ["1", "2147483647 + 1", "sum(4, 9)", "semantifold_integer_add(1, right)"]) {
      const source = caller(`return ${expression};`)

      assert.throws(() => read(source), error => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" &&
        error.language == "cpp" && Boolean(error.location), expression)
    }
  })

  for (const [operator, resultType, operation] of [["+", "std::string", "StringConcat"], ["==", "bool", "StringEqual"], ["!=", "bool", "StringNotEqual"]]) {
    it("resolves by-value std::string operator " + operator + " without identity or conversion", () => {
      const source = caller().split("\nstd::int64_t sum")[0] +
        `\n${resultType} combine(std::string left, std::string right) { return left ${operator} right; }\nint main() { return 0; }\n`
      const module = read(source)

      expect(module.functions[0].body.statements[0].expression.operation).toEqual(operation)
      expect(read(generate({language: "cpp", module})).functions[0].body.statements[0].expression.operation).toEqual(operation)
    })
  }

  it("accepts exact caller functions, initialized by-value locals and nested fallthrough branches", () => {
    const source = caller("std::int64_t value = left; value = right; if (left < right) { if (left == right) { return left; } } else { return right; } return value;")
    const module = read(source)

    expect(module.functions[0].name).toEqual("sum")
    expect(module.functions[0].parameters.map(({type}) => type.name)).toEqual(["integer", "integer"])
    expect(module.functions[0].body.statements.map(({kind}) => kind)).toEqual(["LocalDeclaration", "AssignmentStatement", "IfStatement", "ReturnStatement"])
    expect(read(generate({language: "cpp", module})).functions[0].body.statements.length).toEqual(4)
  })

  it("rejects every unmodeled declaration, conversion, ownership and control construct", () => {
    const invalidBodies = [
      "auto value = left; return value;", "std::int64_t &value = left; return value;", "std::int64_t *value = &left; return *value;",
      "std::int64_t values[2] = {left, right}; return values[0];", "std::int64_t value{left}; return value;",
      "return static_cast<std::int64_t>(left);", "return (std::int64_t)left;", "return std::move(left);",
      "try { return left; } catch (...) { return right; }", "throw left;", "return sizeof(left);", "return typeid(left);",
      "auto fun = [left]() { return left; }; return fun();", "for (;;) { return left; }", "return left ? left : right;",
      "return (left, right);", "return left / right;", "return left << right;", "return true;", "if (left) { return right; } return left;",
      "using namespace std; return left;", "class Value {}; return left;", "enum Value { item }; return left;", "co_return left;"
    ]
    const invalidSignatures = [
      "auto sum(std::int64_t left, std::int64_t right)", "std::int64_t sum(std::int64_t left, std::int64_t right = 0)",
      "std::int64_t sum(std::int64_t left, std::int64_t right) noexcept", "std::int64_t sum(std::int64_t left, std::int64_t right) throw()",
      "template<class T> T sum(T left, T right)", "std::int64_t sum(const std::int64_t left, std::int64_t right)",
      "int64_t sum(int64_t left, int64_t right)", "int sum(int left, int right)", "std::int64_t sum(std::int64_t left, ...)"
    ]

    for (const body of invalidBodies) assert.throws(() => read(caller(body)), syntaxFailure, body)
    for (const signature of invalidSignatures) assert.throws(() => read(caller("return left;", signature)), syntaxFailure, signature)
    for (const extra of ["#define hidden 1\n", "namespace hidden {}\n", "using Integer = std::int64_t;\n", "struct Record {};\n",
      "std::int64_t sum(bool left, bool right) { return std::int64_t(0); }\n"]) {
      assert.throws(() => read(caller() + extra), syntaxFailure)
    }
  })

  it("rejects caller-authored nested helpers and semantic calls in all operand and argument positions", () => {
    for (const nested of ["sum(left, right)", "semantifold_integer_add(left, right)", "semantifold_integer_subtract(left, right)",
      "semantifold_integer_multiply(left, right)", "semantifold_integer_negate(left)"]) {
      for (const expression of [`${nested} + right`, `left + (${nested})`, `-${nested}`, `sum(${nested}, right)`,
        `sum(left, ${nested})`, `semantifold_integer_add(${nested}, right)`, `semantifold_integer_negate(${nested})`]) {
        const source = caller(`return ${expression};`)

        assert.throws(() => read(source), error => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" &&
          error.language == "cpp" && source.slice(error.location.start.offset, error.location.end.offset) == nested)
      }
    }
  })

  it("preserves parser recovery and rejects preprocessing-sensitive comments, split escapes and oversized input", () => {
    assert.throws(() => read(caller().replace("return left;", "return left + ;")), error => error instanceof SemantifoldDiagnostic && error.code == "PARSE_ERROR" && Boolean(error.location))
    const code = generated()

    for (const comment of ["// hidden\rsemantifold_print_integer(std::int64_t(99));\n", "/* hidden *\\\n/ code /* */\n"]) {
      const changed = code.replace("int main() {", "int main() {\n" + comment)

      assert.throws(() => read(changed), error => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX")
    }
    assert.throws(() => read(" ".repeat(32768)), error => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" && Boolean(error.location))
    assert.throws(() => read("\ud800"), error => error instanceof SemantifoldDiagnostic && error.code == "PARSE_ERROR" && Boolean(error.location))
    assert.throws(() => parse({language: "c", filename: "program.c", source: code}), error => error instanceof SemantifoldDiagnostic)
  })
})
