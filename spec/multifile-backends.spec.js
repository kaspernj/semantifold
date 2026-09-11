// @ts-check

import {describe, expect, it} from "@velocious/testing"
import * as semantifold from "../index.js"

function typescriptProgram() {
  return semantifold.parseProgram({
    entryModule: "main",
    sources: [
      {
        filename: "src/main.ts",
        id: "main",
        language: "typescript",
        source: `import {User} from "./model.js"
import {label} from "./math_tools.js"
const user: User = new User("Ada")
console.log(label(user))
`
      },
      {
        filename: "src/math_tools.ts",
        id: "math_tools",
        language: "typescript",
        source: `import type {User} from "./model.js"
export function label(user: User): string { return user.name }
`
      },
      {
        filename: "src/model.ts",
        id: "model",
        language: "typescript",
        source: "export class User { constructor(readonly name: string) {} }\n"
      }
    ]
  })
}

describe("multi-file program backends", () => {
  it("preserves named import bindings and ESM export aliases", () => {
    const program = semantifold.parseProgram({
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: "import {display as show} from \"./library.js\"\nconsole.log(show())\n"
      }, {
        filename: "library.ts",
        id: "library",
        language: "typescript",
        source: "function label(): string { return \"Ada\" }\nexport {label as display}\n"
      }]
    })
    const javascript = semantifold.generateProgramArtifactSet({language: "javascript", program})
    const typescript = semantifold.generateProgramArtifactSet({language: "typescript", program})

    expect(program.modules[1].imports).toMatchObject([{
      declarationId: "library#function:0",
      importedName: "display",
      localName: "show"
    }])
    expect(String(javascript.artifacts.find(({path}) => path == "library.js")?.content)).toInclude("export {label as display}")
    expect(String(javascript.artifacts.find(({path}) => path == "main.js")?.content)).toInclude("import {display as show}")
    expect(String(javascript.artifacts.find(({path}) => path == "main.js")?.content)).toInclude("console.log(show())")
    expect(String(typescript.artifacts.find(({path}) => path == "main.ts")?.content)).toInclude("import {display as show}")
  })

  it("preserves an alias when its declaration is also exported directly", () => {
    const program = semantifold.parseProgram({
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: "import {display} from \"./library.js\"\nconsole.log(display())\n"
      }, {
        filename: "library.ts",
        id: "library",
        language: "typescript",
        source: `export function label(): string { return "Ada" }
export {label as display}
`
      }]
    })

    for (const language of ["javascript", "typescript"]) {
      const set = semantifold.generateProgramArtifactSet({
        language: /** @type {"javascript" | "typescript"} */ (language),
        program
      })
      const extension = language == "javascript" ? "js" : "ts"
      const library = String(set.artifacts.find(({path}) => path == `library.${extension}`)?.content)

      expect(library).toInclude("export function label")
      expect(library).toInclude("export {label as display}")
    }
  })

  it("uses a value binding when the same record also has a type-only import", () => {
    const program = semantifold.parseProgram({
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: `import type {User as UserType} from "./model.js"
import {User as UserValue} from "./model.js"
const user: UserType = new UserValue("Ada")
console.log(user.name)
`
      }, {
        filename: "model.ts",
        id: "model",
        language: "typescript",
        source: "export class User { constructor(readonly name: string) {} }\n"
      }]
    })
    const typescript = semantifold.generateProgramArtifactSet({language: "typescript", program})
    const javascript = semantifold.generateProgramArtifactSet({language: "javascript", program})
    const typescriptMain = String(typescript.artifacts.find(({path}) => path == "main.ts")?.content)
    const javascriptMain = String(javascript.artifacts.find(({path}) => path == "main.js")?.content)

    expect(typescriptMain).toInclude("import type {User as UserType}")
    expect(typescriptMain).toInclude("import {User as UserValue}")
    expect(typescriptMain).toInclude("const user: UserType = new UserValue(\"Ada\")")
    expect(javascriptMain).toInclude("User as UserValue")
    expect(javascriptMain).toInclude("const user = new UserValue(\"Ada\")")
  })

  it("emits PHP import aliases for local semantic bindings", () => {
    const program = semantifold.parseProgram({
      entryModule: "main",
      sources: [{
        filename: "main.ts",
        id: "main",
        language: "typescript",
        source: "import {display as show} from \"./library.js\"\nconsole.log(show())\n"
      }, {
        filename: "library.ts",
        id: "library",
        language: "typescript",
        source: "export function display(): string { return \"Ada\" }\n"
      }]
    })
    const php = semantifold.generateProgramArtifactSet({language: "php", program})
    const main = String(php.artifacts.find(({path}) => path == "main.php")?.content)

    expect(main).toInclude("use function Semantifold\\Generated\\Library\\display as show;")
    expect(main).toInclude("echo show(), PHP_EOL;")
  })

  it("plans mapped JavaScript and TypeScript ESM artifacts dependency-first", () => {
    const program = typescriptProgram()

    for (const language of ["javascript", "typescript"]) {
      const set = semantifold.generateProgramArtifactSet({language, program})
      const extension = language == "javascript" ? "js" : "ts"

      expect(set.artifacts.map(({path}) => path)).toEqual([
        "package.json",
        `model.${extension}`,
        `math_tools.${extension}`,
        `main.${extension}`
      ])
      expect(set.entry).toEqual(`main.${extension}`)
      expect(set.artifacts.map(({role}) => role)).toEqual(["manifest", "source", "source", "entry"])
      expect(String(set.artifacts[0].content)).toInclude("\"type\": \"module\"")
      expect(String(set.artifacts[1].content)).toInclude("export class User")
      expect(String(set.artifacts[2].content)).toInclude(
        `${language == "typescript" ? "import type" : "import"} {User} from "./model.js"`
      )
      expect(String(set.artifacts[2].content)).toInclude("export function label")
      expect(String(set.artifacts[3].content)).toInclude("import {label} from \"./math_tools.js\"")
      for (const artifact of set.artifacts) {
        expect(artifact.provenance.kind == "text" || artifact.role == "manifest").toBeTrue()
        if (artifact.provenance.kind == "text") {
          expect(artifact.provenance.mapping.generated.filename).toEqual(artifact.path)
          expect(artifact.provenance.mapping.generated.content).toEqual(artifact.content)
          expect(artifact.provenance.mapping.sources.map(({filename}) => filename)).toEqual([
            "src/main.ts", "src/math_tools.ts", "src/model.ts"
          ])
        }
      }
    }
  })

  it("emits canonical Ruby modules and PHP namespaces with explicit load edges", () => {
    const program = typescriptProgram()
    const ruby = semantifold.generateProgramArtifactSet({language: "ruby", program})
    const php = semantifold.generateProgramArtifactSet({language: "php", program})

    expect(ruby.artifacts.map(({path}) => path)).toEqual(["model.rb", "math_tools.rb", "main.rb"])
    expect(ruby.entry).toEqual("main.rb")
    expect(String(ruby.artifacts[0].content)).toInclude("module Model")
    expect(String(ruby.artifacts[1].content)).toInclude("require_relative \"model\"")
    expect(String(ruby.artifacts[1].content)).toInclude("module MathTools")
    expect(String(ruby.artifacts[1].content)).toInclude("module_function")
    expect(String(ruby.artifacts[1].content)).toInclude("Model::User")
    expect(String(ruby.artifacts[2].content)).toInclude("MathTools.label(user)")

    expect(php.artifacts.map(({path}) => path)).toEqual(["model.php", "math_tools.php", "main.php"])
    expect(php.entry).toEqual("main.php")
    expect(String(php.artifacts[0].content)).toInclude("namespace Semantifold\\Generated\\Model;")
    expect(String(php.artifacts[1].content)).toInclude("require_once __DIR__ . \"/model.php\";")
    expect(String(php.artifacts[1].content)).toInclude("use Semantifold\\Generated\\Model\\User;")
    expect(String(php.artifacts[2].content)).toInclude("use function Semantifold\\Generated\\MathTools\\label;")
  })

  it("emits Java package artifacts with one public top-level class per file", () => {
    const java = semantifold.generateProgramArtifactSet({language: "java", program: typescriptProgram()})

    expect(java.artifacts.map(({path}) => path)).toEqual([
      "semantifold/generated/model/User.java",
      "semantifold/generated/math_tools/MathTools.java",
      "semantifold/generated/main/Main.java"
    ])
    expect(java.entry).toEqual("semantifold/generated/main/Main.java")
    expect(String(java.artifacts[0].content)).toInclude("package semantifold.generated.model;")
    expect(String(java.artifacts[0].content)).toInclude("public final class User")
    expect(String(java.artifacts[0].content)).toInclude("public User(String name)")
    expect(String(java.artifacts[1].content)).toInclude("import semantifold.generated.model.User;")
    expect(String(java.artifacts[1].content)).toInclude("public final class MathTools")
    expect(String(java.artifacts[1].content)).toInclude("public static String label(User user)")
    expect(String(java.artifacts[2].content)).toInclude("import semantifold.generated.math_tools.MathTools;")
    expect(String(java.artifacts[2].content)).toInclude("MathTools.label(user)")
  })

  it("maps qualified Ruby and Java source references to target-local imports by declaration identity", () => {
    const rubyProgram = semantifold.parseProgram({
      entryModule: "main",
      sources: [{
        filename: "main.rb",
        id: "main",
        language: "ruby",
        source: `require_relative "library"
module Main
  puts Library.value()
end
`
      }, {
        filename: "library.rb",
        id: "library",
        language: "ruby",
        source: `module Library
  module_function

  # @return [Integer]
  def value
    return 1
  end
end
`
      }]
    })
    const javaProgram = semantifold.parseProgram({
      entryModule: "main",
      sources: [{
        filename: "app/main/Main.java",
        id: "main",
        language: "java",
        source: `package app.main;
import app.library.Library;
public final class Main {
  public static void main(String[] args) { System.out.println(Library.value()); }
}
`
      }, {
        filename: "app/library/Library.java",
        id: "library",
        language: "java",
        source: `package app.library;
public final class Library {
  public static int value() { return 1; }
}
`
      }]
    })
    const javascript = semantifold.generateProgramArtifactSet({language: "javascript", program: rubyProgram})
    const php = semantifold.generateProgramArtifactSet({language: "php", program: javaProgram})

    expect(String(javascript.artifacts.find(({path}) => path == "main.js")?.content)).toInclude("import {value} from \"./library.js\"")
    expect(String(javascript.artifacts.find(({path}) => path == "main.js")?.content)).toInclude("console.log(value())")
    expect(String(php.artifacts.find(({path}) => path == "main.php")?.content)).toInclude("use function Semantifold\\Generated\\Library\\value;")
    expect(String(php.artifacts.find(({path}) => path == "main.php")?.content)).toInclude("echo value(), PHP_EOL;")
  })
})
