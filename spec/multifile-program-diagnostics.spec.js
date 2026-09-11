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
})
