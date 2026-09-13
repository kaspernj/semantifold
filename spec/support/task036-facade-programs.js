// @ts-check

/**
 * Returns one caller-owned source program that references the neutral Task 036 qualification facade.
 * @param {import("../../src/semantic/types.js").SemanticLanguage} language - Original-five source language.
 * @param {string} [label] - Probe label.
 * @returns {{entryModule: string, sources: {filename: string, id: string, language: import("../../src/semantic/types.js").SemanticLanguage, source: string}[]}} Program input.
 */
export function task036FacadeProgram(language, label = language) {
  if (language == "javascript") return program(language, "main.js", `import {compatibilityProbe} from "semantifold:task036/probe"
console.log(compatibilityProbe("${label}"))
`)
  if (language == "typescript") return program(language, "main.ts", `import {compatibilityProbe} from "semantifold:task036/probe"
console.log(compatibilityProbe("${label}"))
`)
  if (language == "ruby") return program(language, "main.rb", `require "semantifold/task036/probe"
module Main
  puts SemantifoldTask036Probe.compatibility_probe("${label}")
end
`)
  if (language == "php") return program(language, "main.php", `<?php
declare(strict_types=1);
namespace App\\Main;

use function Semantifold\\Task036\\Probe\\compatibility_probe;

echo compatibility_probe("${label}"), PHP_EOL;
`)
  if (language == "java") return program(language, "src/app/main/Main.java", `package app.main;
import semantifold.task036.Probe;

public final class Main {
  public static void main(String[] args) {
    System.out.println(Probe.compatibilityProbe("${label}"));
  }
}
`)

  throw new Error(`No Task 036 facade fixture for '${language}'.`)
}

/**
 * Wraps one entry source in the public parse-program request.
 * @param {import("../../src/semantic/types.js").SemanticLanguage} language - Source language.
 * @param {string} filename - Source filename.
 * @param {string} source - Source text.
 * @returns {{entryModule: string, sources: {filename: string, id: string, language: import("../../src/semantic/types.js").SemanticLanguage, source: string}[]}} Program input.
 */
function program(language, filename, source) {
  return {entryModule: "main", sources: [{filename, id: "main", language, source}]}
}
