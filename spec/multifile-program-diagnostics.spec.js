// @ts-check

import assert from "node:assert/strict"
import {describe, it} from "@velocious/testing"
import {parseProgram, SemantifoldDiagnostic} from "../index.js"

describe("multi-file program diagnostics", () => {
  /**
   * @param {object} input - Program request.
   * @param {string} code - Expected diagnostic code.
   */
  function expectDiagnostic(input, code) {
    assert.throws(
      () => parseProgram(/** @type {Parameters<typeof parseProgram>[0]} */ (input)),
      (error) => error instanceof SemantifoldDiagnostic && error.code == code && error.location?.filename != ""
    )
  }

  /**
   * @param {Parameters<typeof parseProgram>[0]} input - Program request expected to fail.
   * @returns {SemantifoldDiagnostic} Captured diagnostic.
   */
  function captureDiagnostic(input) {
    try {
      parseProgram(input)
      assert.fail("Missing expected Semantifold diagnostic.")
    } catch (error) {
      if (!(error instanceof SemantifoldDiagnostic)) throw error

      return error
    }
  }

  it("distinguishes a known non-cohort source profile from an unknown language", () => {
    for (const [language, code] of [["python", "UNSUPPORTED_ROLE"], ["missing", "UNSUPPORTED_LANGUAGE"]]) {
      assert.throws(
        () => parseProgram({
          entryModule: "main",
          sources: [{
            filename: "main.txt",
            id: "main",
            language: /** @type {"python"} */ (language),
            source: "print(1)\n"
          }]
        }),
        (error) => error instanceof SemantifoldDiagnostic && error.code == code && error.language == language
      )
    }
  })

  it("rejects a selected entry module without executable statements", () => {
    assert.throws(
      () => parseProgram({
        entryModule: "library",
        sources: [{
          filename: "library.ts",
          id: "library",
          language: "typescript",
          source: "export function answer(): number { return 42 }\n"
        }]
      }),
      (error) => error instanceof SemantifoldDiagnostic &&
        error.code == "INVALID_ENTRY_MODULE" &&
        error.language == "typescript" &&
        error.location?.filename == "library.ts"
    )
  })

  it("rejects mixed source-language profiles before adapting any module", () => {
    assert.throws(
      () => parseProgram({
        entryModule: "main",
        sources: [
          {
            filename: "library.ts",
            id: "library",
            language: "typescript",
            source: "export function answer(): number { return 42 }\n"
          },
          {
            filename: "main.js",
            id: "main",
            language: "javascript",
            source: `/** @returns {number} */
function local() { return 1 }
console.log(local())
`
          }
        ]
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "MIXED_SOURCE_LANGUAGES"
    )
  })

  it("rejects CommonJS through the Babel program adapter before semantic resolution", () => {
    assert.throws(
      () => parseProgram({
        entryModule: "main",
        sources: [{
          filename: "main.js",
          id: "main",
          language: "javascript",
          source: `/** @returns {number} */
function answer() { return 42 }
const dependency = require("./dependency.js")
console.log(answer())
`
        }]
      }),
      (error) => error instanceof SemantifoldDiagnostic &&
        error.code == "UNSUPPORTED_SYNTAX" &&
        error.language == "javascript" &&
        error.location?.filename == "main.js" &&
        error.detail.includes("CommonJS")
    )
  })

  it("rejects duplicate PHP import aliases before adapting executable statements", () => {
    assert.throws(
      () => parseProgram({
        entryModule: "main",
        sources: [{
          filename: "main.php",
          id: "main",
          language: "php",
          source: `<?php
namespace App\\Main;
use function App\\One\\value as same;
use function App\\Two\\other as same;
require_once __DIR__ . "/one.php";
require_once __DIR__ . "/two.php";
echo same(), PHP_EOL;
`
        }, {
          filename: "one.php",
          id: "one",
          language: "php",
          source: `<?php
namespace App\\One;
function value(): int { return 1; }
`
        }, {
          filename: "two.php",
          id: "two",
          language: "php",
          source: `<?php
namespace App\\Two;
function other(): int { return 2; }
`
        }]
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "DUPLICATE_IMPORT_BINDING" &&
        error.language == "php" && error.location?.filename == "main.php"
    )
  })

  it("reports stable graph diagnostics for duplicate, missing, private, wrong-kind, cyclic, and unsafe modules", () => {
    const library = {
      filename: "library.ts",
      id: "library",
      language: "typescript",
      source: "function hidden(): number { return 1 }\nexport function shown(): number { return 2 }\n"
    }

    assert.throws(
      () => parseProgram({entryModule: "library", sources: [library, {...library, filename: "copy.ts"}]}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "DUPLICATE_MODULE"
    )
    assert.throws(
      () => parseProgram({entryModule: "missing", sources: [library]}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_ENTRY_MODULE"
    )
    expectDiagnostic({
      entryModule: "main",
      sources: [library, {
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: "import {hidden} from \"./library.js\"\nconsole.log(hidden())\n"
      }]
    }, "UNRESOLVED_IMPORT")
    expectDiagnostic({
      entryModule: "main",
      sources: [library, {
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: "import type {shown} from \"./library.js\"\nconsole.log(1)\n"
      }]
    }, "IMPORT_KIND_MISMATCH")
    expectDiagnostic({
      entryModule: "a",
      sources: [
        {
          filename: "a.ts",
          id: "a",
          language: "typescript",
          source: "import {b} from \"./b.js\"\nexport function a(): number { return b() }\nconsole.log(a())\n"
        },
        {
          filename: "b.ts",
          id: "b",
          language: "typescript",
          source: "import {a} from \"./a.js\"\nexport function b(): number { return a() }\n"
        }
      ]
    }, "IMPORT_CYCLE")
    expectDiagnostic({
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: "import {value} from \"../outside.js\"\nconsole.log(value())\n"
      }]
    }, "UNSAFE_MODULE_PATH")
  })

  it("rejects unsupported ESM import/export and execution profiles", () => {
    const dependency = {
      filename: "dependency.js",
      id: "dependency",
      language: "javascript",
      source: "/** @returns {number} */\nexport function value() { return 1 }\n"
    }
    const unsupportedSources = [
      "import value from \"./dependency.js\"\nconsole.log(value())\n",
      "import * as dependency from \"./dependency.js\"\nconsole.log(dependency.value())\n",
      "import \"./dependency.js\"\nconsole.log(1)\n",
      "import {value} from \"some-package\"\nconsole.log(value())\n",
      "export {value} from \"./dependency.js\"\nconsole.log(1)\n",
      "export default function value() { return 1 }\nconsole.log(value())\n",
      "console.log(import(\"./dependency.js\"))\n",
      "await Promise.resolve(1)\nconsole.log(1)\n"
    ]

    for (const source of unsupportedSources) {
      expectDiagnostic({
        entryModule: "main",
        sources: [dependency, {filename: "main.js", id: "main", language: "javascript", source}]
      }, "UNSUPPORTED_SYNTAX")
    }
  })

  it("rejects a TypeScript type-only import used as a runtime value", () => {
    expectDiagnostic({
      entryModule: "main",
      sources: [{
        filename: "model.ts",
        id: "model",
        language: "typescript",
        source: "export class User { constructor(readonly name: string) {} }\n"
      }, {
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: `import type {User} from "./model.js"
const user: User = new User("Ada")
console.log(user.name)
`
      }]
    }, "UNSUPPORTED_SYNTAX")
  })

  it("rejects TypeScript type-only exports instead of widening them to value exports", () => {
    expectDiagnostic({
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: `class User { constructor(readonly name: string) {} }
export type {User}
console.log(1)
`
      }]
    }, "UNSUPPORTED_SYNTAX")
  })

  it("rejects duplicate Java native identities deterministically before resolving an ambiguous import", () => {
    const one = {
      filename: "one/app/shared/Library.java",
      id: "one",
      language: /** @type {const} */ ("java"),
      source: "package app.shared;\npublic final class Library { public static int value() { return 1; } }\n"
    }
    const two = {
      filename: "two/app/shared/Library.java",
      id: "two",
      language: /** @type {const} */ ("java"),
      source: "package app.shared;\npublic final class Library { public static int value() { return 2; } }\n"
    }
    const main = {
      filename: "app/main/Main.java",
      id: "main",
      language: /** @type {const} */ ("java"),
      source: `package app.main;
import app.shared.Library;
public final class Main { public static void main(String[] args) { System.out.println(Library.value()); } }
`
    }
    const diagnostics = [[one, two, main], [two, one, main]].map((sources) => {
      const error = captureDiagnostic({entryModule: "main", sources})

      return {code: error.code, detail: error.detail, filename: error.location?.filename}
    })

    assert.deepEqual(diagnostics[0], diagnostics[1])
    assert.deepEqual(diagnostics[0], {
      code: "DUPLICATE_MODULE",
      detail: "Duplicate Java native module identity 'app.shared.Library' in 'one/app/shared/Library.java' and 'two/app/shared/Library.java'.",
      filename: "two/app/shared/Library.java"
    })
  })

  it("rejects Ruby module reopening deterministically before qualified resolution", () => {
    const one = {
      filename: "one.rb",
      id: "one",
      language: /** @type {const} */ ("ruby"),
      source: `module Shared
  module_function

  # @return [Integer]
  def one
    return 1
  end
end
`
    }
    const two = {
      filename: "two.rb",
      id: "two",
      language: /** @type {const} */ ("ruby"),
      source: `module Shared
  module_function

  # @return [Integer]
  def two
    return 2
  end
end
`
    }
    const main = {
      filename: "main.rb",
      id: "main",
      language: /** @type {const} */ ("ruby"),
      source: `require_relative "one"
require_relative "two"

module Main
  puts Shared.one + Shared.two
end
`
    }
    const diagnostics = [[one, two, main], [two, one, main]].map((sources) => {
      const error = captureDiagnostic({entryModule: "main", sources})

      return {code: error.code, detail: error.detail, filename: error.location?.filename}
    })

    assert.deepEqual(diagnostics[0], diagnostics[1])
    assert.deepEqual(diagnostics[0], {
      code: "DUPLICATE_MODULE",
      detail: "Duplicate Ruby native module identity 'Shared' in 'one.rb' and 'two.rb'.",
      filename: "two.rb"
    })
  })
})
