// @ts-check

import assert from "node:assert/strict"
import {describe, it} from "@velocious/testing"
import {parseProgram, SemantifoldDiagnostic} from "../index.js"

describe("multi-file source profile diagnostics", () => {
  /** @param {Parameters<typeof parseProgram>[0]} input - Invalid program. @param {string} filename - Responsible source. */
  function rejects(input, filename) {
    assert.throws(
      () => parseProgram(input),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" &&
        error.location?.filename == filename
    )
  }

  it("rejects Ruby load-path, dynamic require, mixin, and reopening profiles", () => {
    const invalid = [
      `require "model"
module Main
  puts 1
end
`,
      `path = "model"
require_relative path
module Main
  puts 1
end
`,
      `module Main
  include Enumerable
  puts 1
end
`,
      `module Main
  puts 1
end
module Main
end
`
    ]

    for (const source of invalid) rejects({entryModule: "main", sources: [{filename: "main.rb", id: "main", language: "ruby", source}]}, "main.rb")
  })

  it("rejects PHP include-path, dynamic/grouped use, autoload, and namespace-block profiles", () => {
    const invalid = [
      `<?php
namespace App\\Main;
require "model.php";
echo 1, PHP_EOL;
`,
      `<?php
namespace App\\Main;
$path = "model.php";
require_once $path;
echo 1, PHP_EOL;
`,
      `<?php
namespace App\\Main;
use App\\Model\\{User};
echo 1, PHP_EOL;
`,
      `<?php
namespace App\\Main;
spl_autoload_register(function ($name) {});
echo 1, PHP_EOL;
`,
      `<?php
namespace App\\First;
echo 1, PHP_EOL;
namespace App\\Second;
`
    ]

    for (const source of invalid) rejects({entryModule: "main", sources: [{filename: "main.php", id: "main", language: "php", source}]}, "main.php")
  })

  it("rejects TypeScript namespaces, ambient modules, export assignment, and path aliases", () => {
    const invalid = [
      "namespace Internal { export const value = 1 }\nconsole.log(1)\n",
      "declare module \"ambient\" {}\nconsole.log(1)\n",
      "function value(): number { return 1 }\nexport = value\nconsole.log(value())\n",
      "import {value} from \"@app/value\"\nconsole.log(value())\n"
    ]

    for (const source of invalid) rejects({entryModule: "main", sources: [{filename: "main.ts", id: "main", language: "typescript", source}]}, "main.ts")
  })

  it("rejects Java JPMS, static/wildcard imports, and multi-public-class layouts", () => {
    rejects({entryModule: "main", sources: [{filename: "module-info.java", id: "main", language: "java", source: "module app.main {}\n"}]}, "module-info.java")
    for (const declaration of ["import static app.math.MathTools.label;", "import app.model.*;"]) {
      rejects({entryModule: "main", sources: [{
        filename: "app/main/Main.java",
        id: "main",
        language: "java",
        source: `package app.main;
${declaration}
public final class Main { public static void main(String[] args) { System.out.println(1); } }
`
      }]}, "app/main/Main.java")
    }
    rejects({entryModule: "main", sources: [{
      filename: "app/main/Main.java",
      id: "main",
      language: "java",
      source: `package app.main;
public final class Main { public static void main(String[] args) { System.out.println(1); } }
public final class Other {}
`
    }]}, "app/main/Main.java")
  })
})
