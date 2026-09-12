// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"
import {semanticMeaning} from "./support/semantic-meaning.js"

const fixtures = [
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"]
]

function rejected(language, filename, source) {
  assert.throws(
    () => parse({filename, language, source}),
    (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" &&
      error.language == language && error.location?.filename == filename
  )
}

describe("type parameter frontends", () => {
  it("normalizes native and exactly documented original-five generic profiles to equivalent meaning", async () => {
    const meanings = []

    for (const [language, filename] of fixtures) {
      const source = await readFile(new URL(`fixtures/generics/${filename}`, import.meta.url), "utf8")
      const module = parse({filename, language, source})

      expect(module.records[0].typeParameters).toHaveLength(1)
      expect(module.functions.map(({typeParameters}) => typeParameters?.length)).toEqual([1, 1, 2, 1])
      meanings.push(semanticMeaning(module))
    }

    for (const meaning of meanings.slice(1)) expect(meaning).toEqual(meanings[0])
  })

  it("rejects bounds, defaults, variance, wildcards, casts, and unsupported generic operators at parser-owned locations", () => {
    rejected("typescript", "invalid.ts", "function value<T extends string>(item: T): T { return item }\nconsole.log(value(\"x\"))\n")
    rejected("typescript", "invalid.ts", "class Box<out T> { constructor(readonly value: T) {} }\nconsole.log(1)\n")
    rejected("typescript", "invalid.ts", "function value<T>(item: T): T { return item }\nconsole.log(value(\"x\" as string))\n")
    rejected("java", "Main.java", "public final class Main { private static <T extends String> T value(T item) { return item; } public static void main(String[] args) { System.out.println(value(\"x\")); } }\n")
    rejected("java", "Main.java", "final class Box<T> { private final T value; Box(T value) { this.value = value; } T value() { return this.value; } } public final class Main { private static String value(Box<?> box) { return \"x\"; } public static void main(String[] args) { System.out.println(1); } }\n")
    rejected("javascript", "invalid.js", "/** @template T extends string\n * @param {T} value\n * @returns {T}\n */\nfunction value(value) { return value }\nconsole.log(value(\"x\"))\n")
    rejected("php", "invalid.php", "<?php\n/** @template-covariant T\n * @param T $value\n * @return T\n */\nfunction value($value) { return $value; }\necho value(\"x\"), PHP_EOL;\n")
    rejected("ruby", "invalid.rb", "# @template T = String\n# @param value [T]\n# @return [T]\ndef value(value)\n  return value\nend\nputs value(\"x\")\n")
    rejected("typescript", "invalid.ts", "function keys<T>(value: T): keyof T { return value }\nconsole.log(keys(\"x\"))\n")
    rejected("typescript", "invalid.ts", "function field<T>(value: T): T[\"field\"] { return value }\nconsole.log(field(\"x\"))\n")
    rejected("typescript", "invalid.ts", "function reflect<T>(value: T): string { return typeof value }\nconsole.log(reflect(\"x\"))\n")
  })

  it("rejects missing dynamic-language template declarations and raw Java applications", () => {
    const missing = [
      ["javascript", "invalid.js", "/** @param {T} value\n * @returns {T}\n */\nfunction value(value) { return value }\nconsole.log(value(\"x\"))\n"],
      ["php", "invalid.php", "<?php\n/** @param T $value\n * @return T\n */\nfunction value($value) { return $value; }\necho value(\"x\"), PHP_EOL;\n"],
      ["ruby", "invalid.rb", "# @param value [T]\n# @return [T]\ndef value(value)\n  return value\nend\nputs value(\"x\")\n"]
    ]

    for (const [language, filename, source] of missing) {
      assert.throws(
        () => parse({filename, language, source}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "MISSING_TYPE" &&
          error.language == language && error.location?.filename == filename
      )
    }
    const rawJava = "final class Box<T> { private final T value; Box(T value) { this.value = value; } T value() { return this.value; } } public final class Main { private static String keep(String value) { return value; } public static void main(String[] args) { final Box box = new Box(\"x\"); System.out.println(keep(\"x\")); } }\n"

    assert.throws(
      () => parse({filename: "Main.java", language: "java", source: rawJava}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "RAW_GENERIC_APPLICATION" &&
        error.language == "java" && error.location?.filename == "Main.java"
    )
    const contextualRawJava = "final class Box<T> { private final T value; Box(T value) { this.value = value; } T value() { return this.value; } } public final class Main { private static String keep(String value) { return value; } public static void main(String[] args) { final Box<String> box = new Box(\"x\"); System.out.println(keep(box.value())); } }\n"

    assert.throws(
      () => parse({filename: "Main.java", language: "java", source: contextualRawJava}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "RAW_GENERIC_APPLICATION" &&
        error.language == "java" && error.location?.filename == "Main.java"
    )
  })

  it("substitutes closed generic record fields before converting constructor arguments in every original-five frontend", () => {
    const profiles = [
      ["php", "program.php", `<?php
declare(strict_types=1);
/** @template T */
final class Box {
    /** @param T $value */
    public function __construct(private $value) {}
    /** @return T */
    public function value() { return $this->value; }
}
function keep(string $value): string { return $value; }
/** @var Box<?string> $box
 * @semantifold-immutable
 */
$box = new Box(null);
echo keep("ok"), PHP_EOL;
`],
      ["ruby", "program.rb", `# @template T
class Box
  # @type [T]
  attr_reader :value
  # @param value [T]
  def initialize(value)
    @value = value
    freeze
  end
end
# @param value [String]
# @return [String]
def keep(value)
  return value
end
# @type [Box[String?]]
# @semantifold-immutable
box = Box.new(nil)
puts keep("ok")
`],
      ["javascript", "program.js", `/** @template T */
class Box {
  /** @param {T} value */
  constructor(value) {
    /** @readonly */ this.value = value
    Object.freeze(this)
  }
}
/**
 * @param {string} value
 * @returns {string}
 */
function keep(value) { return value }
/** @type {Box<string|null>} */ const box = new Box(null)
console.log(keep("ok"))
`],
      ["typescript", "program.ts", `class Box<T> { constructor(readonly value: T) {} }
function keep(value: string): string { return value }
const box: Box<string | null> = new Box<string | null>(null)
console.log(keep("ok"))
`],
      ["java", "Main.java", `final class Box<T> {
  private final T value;
  Box(T value) { this.value = value; }
  T value() { return this.value; }
}
public final class Main {
  private static String keep(String value) { return value; }
  public static void main(String[] args) {
    final Box<java.util.Optional<String>> box = new Box<java.util.Optional<String>>(java.util.Optional.empty());
    System.out.println(keep("ok"));
  }
}
`]
    ]
    const meanings = profiles.map(([language, filename, source]) => semanticMeaning(parse({filename, language, source})))

    for (const meaning of meanings.slice(1)) expect(meaning).toEqual(meanings[0])
  })

  it("parses emitted optional type-variable documentation directly and inside lists", () => {
    const javascript = parse({
      filename: "program.js",
      language: "javascript",
      source: `/**
 * @template T
 * @param {T|null} value
 * @param {ReadonlyArray<T|null>} values
 * @returns {T|null}
 */
function preserve(value, values) { return value }
console.log("ok")
`
    })
    const ruby = parse({
      filename: "program.rb",
      language: "ruby",
      source: `# @template T
# @param value [T?]
# @param values [Array[T?]]
# @return [T?]
def preserve(value, values)
  return value
end
puts "ok"
`
    })

    for (const module of [javascript, ruby]) {
      expect(module.functions[0].parameters[0].type.kind).toEqual("OptionalType")
      expect(module.functions[0].parameters[1].type).toMatchObject({
        elementType: {kind: "OptionalType", valueType: {kind: "TypeVariableReference"}},
        kind: "ListType"
      })
      expect(module.functions[0].returnType.kind).toEqual("OptionalType")
    }
  })

  it("admits PHP generic accessors only for their exact generic record receiver and spelling", () => {
    const declarations = `<?php
declare(strict_types=1);
/** @template T */
final class Box {
    /** @param T $value */
    public function __construct(private $value) {}
    /** @return T */
    public function value() { return $this->value; }
}
final readonly class Plain {
    public function __construct(public string $value) {}
}
function keep(string $value): string { return $value; }
/** @var Box<string> $box
 * @semantifold-immutable
 */
$box = new Box("boxed");
/** @var Plain $plain
 * @semantifold-immutable
 */
$plain = new Plain("plain");
`

    expect(parse({filename: "valid.php", language: "php", source: `${declarations}echo keep($box->value()), PHP_EOL;\n`})
      .entryPoint.body.statements.at(-1).kind).toEqual("PrintStatement")
    rejected("php", "wrong-receiver.php", `${declarations}echo keep($plain->value()), PHP_EOL;\n`)
    rejected("php", "wrong-spelling.php", `${declarations}echo keep($box->missing()), PHP_EOL;\n`)
    rejected("php", "property.php", `${declarations}echo keep($box->value), PHP_EOL;\n`)
  })

  it("admits only the PHP generic getter on a presence-proven optional record receiver", () => {
    const declarations = `<?php
declare(strict_types=1);
/** @template T */
final class Box {
    /** @param T $value */
    public function __construct(private $value) {}
    /** @return T */
    public function value() { return $this->value; }
}
function keep(string $value): string { return $value; }
/** @var ?Box<string> $box
 * @semantifold-immutable
 */
$box = new Box("present");
`
    const module = parse({
      filename: "valid.php",
      language: "php",
      source: `${declarations}if ($box !== null) { echo keep($box->value()), PHP_EOL; }\n`
    })
    const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (module.entryPoint.body.statements.at(-1))
    const print = /** @type {import("../src/semantic/types.js").PrintStatement} */ (branch.consequent.statements[0])
    const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (print.expression)
    const member = /** @type {import("../src/semantic/types.js").MemberRead} */ (call.arguments[0])

    expect(member).toMatchObject({field: "record:0:field:0", kind: "MemberRead", receiver: {kind: "OptionalUnwrap"}})
    rejected("php", "property.php", `${declarations}if ($box !== null) { echo keep($box->value), PHP_EOL; }\n`)
  })

  it("parses optional applied-record documentation directly and recursively with exact source ranges", () => {
    const profiles = [
      ["javascript", "program.js", `/** @template T */
class Box {
  /** @param {T} value */
  constructor(value) {
    /** @readonly */ this.value = value
    Object.freeze(this)
  }
}
/**
 * @template T
 * @param {Box<T>|null} value
 * @param {ReadonlyArray<Box<T>|null>} values
 * @param {ReadonlyMap<string,Box<T>|null>} by_name
 * @returns {Box<T>|null}
 */
function preserve(value, values, by_name) { return value }
console.log("ok")
`, "Box<T>|null"],
      ["ruby", "program.rb", `# @template T
class Box
  # @type [T]
  attr_reader :value
  # @param value [T]
  def initialize(value)
    @value = value
    freeze
  end
end
# @template T
# @param value [Box[T]?]
# @param values [Array[Box[T]?]]
# @param by_name [Hash[String,Box[T]?]]
# @return [Box[T]?]
def preserve(value, values, by_name)
  return value
end
puts "ok"
`, "Box[T]?"]
    ]
    const meanings = []

    for (const [language, filename, source, directSpelling] of profiles) {
      const module = parse({filename, language, source})
      const parameters = module.functions[0].parameters
      const direct = parameters[0].type
      const range = direct.sourceProvenance?.ranges.type

      expect(direct).toMatchObject({kind: "OptionalType", valueType: {kind: "RecordType"}})
      expect(parameters[1].type).toMatchObject({
        elementType: {kind: "OptionalType", valueType: {kind: "RecordType"}},
        kind: "ListType"
      })
      expect(parameters[2].type).toMatchObject({
        kind: "MapType",
        valueType: {kind: "OptionalType", valueType: {kind: "RecordType"}}
      })
      expect(range && source.slice(range.start.offset, range.end.offset)).toEqual(directSpelling)
      meanings.push(semanticMeaning(module))
    }

    expect(meanings[1]).toEqual(meanings[0])
  })

  it("preserves an optional binding as direct generic-call evidence", () => {
    const module = parse({
      filename: "optional-identity.ts",
      language: "typescript",
      source: `function identity<T>(value: T): T { return value }
const optional: string | null = "value"
const result: string | null = identity(optional)
if (result !== null) { console.log(result) }
`
    })
    const result = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (
      module.entryPoint.body.statements[1])
    const call = /** @type {import("../src/semantic/types.js").CallExpression} */ (result.initializer)

    expect(call.arguments[0].kind).toEqual("IdentifierExpression")
    expect(call.resolution.typeArguments).toEqual([{kind: "OptionalType", valueType: "string"}])
    expect(call.resolution.returnType).toEqual({kind: "OptionalType", valueType: "string"})
  })

  it("normalizes recursively evidence-free generic list arguments in every original-five frontend", () => {
    const profiles = [
      ["php", "program.php", `<?php
declare(strict_types=1);
/** @template T
 * @param list<?T> $values
 * @param T $fallback
 * @return T
 */
function pick(array $values, $fallback) { return $fallback; }
echo pick([null], "picked"), PHP_EOL;
`],
      ["ruby", "program.rb", `# @template T
# @param values [Array[T?]]
# @param fallback [T]
# @return [T]
def pick(values, fallback)
  return fallback
end
puts pick([nil], "picked")
`],
      ["javascript", "program.js", `/** @template T
 * @param {ReadonlyArray<T|null>} values
 * @param {T} fallback
 * @returns {T}
 */
function pick(values, fallback) { return fallback }
console.log(pick([null], "picked"))
`],
      ["typescript", "program.ts", `function pick<T>(values: ReadonlyArray<T | null>, fallback: T): T { return fallback }
console.log(pick([null], "picked"))
`],
      ["java", "Main.java", `public final class Main {
  private static <T> T pick(java.util.List<java.util.Optional<T>> values, T fallback) { return fallback; }
  public static void main(String[] args) {
    System.out.println(pick(java.util.List.of(java.util.Optional.empty()), "picked"));
  }
}
`]
    ]
    const meanings = profiles.map(([language, filename, source]) =>
      semanticMeaning(parse({filename, language, source})))

    for (const meaning of meanings.slice(1)) expect(meaning).toEqual(meanings[0])
  })

  it("classifies instantiated generic call results and explicit construction members in original-five syntax", () => {
    const profiles = [
      ["javascript", "program.js", `/** @template T */
class Box {
  /** @param {T} size */
  constructor(size) { /** @readonly */ this.size = size; Object.freeze(this) }
}
/** @template T
 * @param {T} value
 * @returns {T}
 */
function identity(value) { return value }
/** @type {Box<string>} */ const box = new Box("sized")
console.log(identity(box).size)
`],
      ["typescript", "program.ts", `class Box<T> { constructor(readonly size: T) {} }
function identity<T>(value: T): T { return value }
const box: Box<string> = new Box<string>("sized")
console.log(identity(box).size)
const direct: string | null = new Box<string | null>(null).size
if (direct !== null) { console.log(direct) }
`],
      ["ruby", "program.rb", `# @template T
class Box
  # @type [T]
  attr_reader :size
  # @param size [T]
  def initialize(size)
    @size = size
    freeze
  end
end
# @template T
# @param value [T]
# @return [T]
def identity(value)
  return value
end
# @type [Box[String]]
# @semantifold-immutable
box = Box.new("sized")
puts identity(box).size
`],
      ["php", "program.php", `<?php
declare(strict_types=1);
/** @template T */
final class Box {
    /** @param T $size */
    public function __construct(private $size) {}
    /** @return T */
    public function size() { return $this->size; }
}
/** @template T
 * @param T $value
 * @return T
 */
function identity($value) { return $value; }
/** @var Box<string> $box
 * @semantifold-immutable
 */
$box = new Box("sized");
echo identity($box)->size(), PHP_EOL;
`],
      ["java", "Main.java", `final class Box<T> {
  private final T size;
  Box(T size) { this.size = size; }
  T size() { return this.size; }
}
public final class Main {
  private static <T> T identity(T value) { return value; }
  public static void main(String[] args) {
    final Box<String> box = new Box<String>("sized");
    System.out.println(identity(box).size());
    final java.util.Optional<String> direct = new Box<java.util.Optional<String>>(java.util.Optional.empty()).size();
    if (direct.isPresent()) { System.out.println(direct.get()); }
  }
}
`]
    ]

    for (const [language, filename, source] of profiles) {
      const module = parse({filename, language, source})
      const print = /** @type {import("../src/semantic/types.js").PrintStatement} */ (
        module.entryPoint.body.statements[1])

      expect(print.expression).toMatchObject({
        field: "record:0:field:0",
        kind: "MemberRead",
        receiver: {kind: "CallExpression", resolution: {returnType: {arguments: ["string"], kind: "RecordType"}}}
      })
      if (language == "typescript" || language == "java") {
        const direct = /** @type {import("../src/semantic/types.js").LocalDeclaration} */ (
          module.entryPoint.body.statements[2])

        expect(direct.initializer.kind).toEqual("MemberRead")
      }
    }
  })
})
