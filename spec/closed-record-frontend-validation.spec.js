// @ts-check

import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import {describe, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

const fixture = async (name) => readFile(new URL(`fixtures/records/${name}`, import.meta.url), "utf8")

function rejects(language, filename, source, codes = ["UNSUPPORTED_SYNTAX"]) {
  assert.throws(
    () => parse({filename, language, source}),
    (error) => error instanceof SemantifoldDiagnostic && codes.includes(error.code) &&
      error.language == language && error.location?.filename == filename
  )
}

describe("closed record frontend validation", () => {
  it("rejects TypeScript class behavior, structural substitutes, mutation, and dynamic access", async () => {
    const source = await fixture("program.ts")

    rejects("typescript", "invalid.ts", source.replace("class Address {", "class Address extends Object {"))
    rejects("typescript", "invalid.ts", `interface Named { readonly name: string }\n${source}`)
    rejects("typescript", "invalid.ts", source.replace("class Address {", "@sealed\nclass Address {"))
    rejects("typescript", "invalid.ts", source.replace("  constructor(readonly city: string, readonly zip: number) {}",
      "  constructor(readonly city: string, readonly zip: number) {}\n  label(): string { return this.city }"))
    rejects("typescript", "invalid.ts", source.replace("readonly city: string", "public readonly city: string"))
    rejects("typescript", "invalid.ts", source.replace('new Address("Paris", 75000)', '{city: "Paris", zip: 75000}'))
    rejects("typescript", "invalid.ts", source.replace('new Address("Paris", 75000)', 'new Map([["city", "Paris"]])'))
    rejects("typescript", "invalid.ts", source.replace("console.log(address.city)", 'address.city = "Lyon"\nconsole.log(address.city)'))
    rejects("typescript", "invalid.ts", source.replace("console.log(address.city)", 'console.log(address["city"])'))
    rejects("typescript", "invalid.ts", source.replace("console.log(address.city)", 'console.log(Reflect.get(address, "city"))'))
  })

  it("rejects noncanonical PHP, Ruby, and JavaScript records at their parser nodes", async () => {
    const php = await fixture("program.php")
    const ruby = await fixture("program.rb")
    const javascript = await fixture("program.js")

    rejects("php", "invalid.php", php.replace("final readonly class Address", "readonly class Address"))
    rejects("php", "invalid.php", php.replace("final readonly class Address {", "final readonly class Address extends stdClass {"))
    rejects("php", "invalid.php", php.replace("final readonly class Address {", "trait Named {}\n\nfinal readonly class Address {"))
    rejects("php", "invalid.php", php.replace("    public function __construct(public string $city, public int $zip) {}",
      "    public function __construct(public string $city, public int $zip) {}\n    public function label(): string { return $this->city; }"))
    rejects("php", "invalid.php", php.replace("echo $address->city, PHP_EOL;", 'echo $address->{"city"}, PHP_EOL;'))

    rejects("ruby", "invalid.rb", ruby.replace("class Address", "class Address < Object"))
    rejects("ruby", "invalid.rb", ruby.replace("class Address\n", "class Address\n  include Comparable\n"))
    rejects("ruby", "invalid.rb", ruby.replace("  attr_reader :city", "  attr_accessor :city"))
    rejects("ruby", "invalid.rb", ruby.replace("    @zip = zip", "    @zip = zip\n    @hidden = city"))
    rejects("ruby", "invalid.rb", ruby.replace("puts address.city", "address.city = \"Lyon\"\nputs address.city"))
    rejects("ruby", "invalid.rb", ruby.replace("puts address.city", 'puts address.public_send(:city)'))

    rejects("javascript", "invalid.js", javascript.replace("class Address {", "class Address extends Object {"))
    rejects("javascript", "invalid.js", javascript.replace("class User {", "Object.assign(Address.prototype, {hidden: true})\n\nclass User {"))
    rejects("javascript", "invalid.js", javascript.replace("    Object.freeze(this)", "    this.hidden = city\n    Object.freeze(this)"))
    rejects("javascript", "invalid.js", javascript.replace("console.log(address.city)", 'console.log(address["city"])'))
    rejects("javascript", "invalid.js", javascript.replace("console.log(address.city)", 'console.log(Reflect.get(address, "city"))'))
  })

  it("rejects Java inheritance, extra behavior, reflection, and unsupported record syntax", async () => {
    const source = await fixture("Main.java")

    rejects("java", "Main.java", source.replace("final class Address {", "final class Address extends Object {"))
    rejects("java", "Main.java", source.replace("final class Address {", "final class Address implements java.io.Serializable {"))
    rejects("java", "Main.java", source.replace("  String city() {", "  String label() { return this.city; }\n\n  String city() {"))
    rejects("java", "Main.java", source.replace("System.out.println(address.city());",
      "System.out.println(address.getClass());"))
    rejects("java", "Main.java", `record Address(String city) {}\n\npublic final class Main {\n  public static void main(String[] args) {\n    System.out.println(1);\n  }\n}\n`)
  })
})
