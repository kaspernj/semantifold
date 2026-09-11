// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {parseProgram} from "../index.js"

describe("original-five multi-file frontends", () => {
  it("adapts canonical JavaScript ESM with JSDoc types", () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [
        {
          filename: "src/main.js",
          id: "main",
          language: "javascript",
          source: `import {User} from "./model.js"
import {label} from "./math.js"

/** @type {User} */ const user = new User("Ada")
console.log(label(user))
`
        },
        {
          filename: "src/math.js",
          id: "math_tools",
          language: "javascript",
          source: `import {User} from "./model.js"

/**
 * @param {User} user
 * @returns {string}
 */
export function label(user) {
  return user.name
}
`
        },
        {
          filename: "src/model.js",
          id: "model",
          language: "javascript",
          source: `export class User {
  /** @param {string} name */
  constructor(name) {
    /** @readonly */
    this.name = name
    Object.freeze(this)
  }
}
`
        }
      ]
    })

    expect(program.modules.map(({id}) => id)).toEqual(["model", "math_tools", "main"])
    expect(program.modules[2].entryPoint?.body.statements[1]).toMatchObject({
      expression: {resolution: {declarationId: "math_tools#function:0"}}
    })
  })

  it("adapts the canonical Ruby require-relative module profile", () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [
        {
          filename: "main.rb",
          id: "main",
          language: "ruby",
          source: `require_relative "model"
require_relative "math_tools"

module Main
  # @type [Model::User]
  # @semantifold-immutable
  user = Model::User.new("Ada")
  puts MathTools.label(user)
end
`
        },
        {
          filename: "math_tools.rb",
          id: "math_tools",
          language: "ruby",
          source: `require_relative "model"

module MathTools
  module_function

  # @param user [Model::User]
  # @return [String]
  def label(user)
    return user.name
  end
end
`
        },
        {
          filename: "model.rb",
          id: "model",
          language: "ruby",
          source: `module Model
  class User
    # @type [String]
    attr_reader :name

    # @param name [String]
    def initialize(name)
      @name = name
      freeze
    end
  end
end
`
        }
      ]
    })

    expect(program.modules.map(({id}) => id)).toEqual(["model", "math_tools", "main"])
    expect(program.modules[0].exports).toMatchObject([{exportedName: "User", symbolKind: "record"}])
    expect(program.modules[1].exports).toMatchObject([{exportedName: "label", symbolKind: "function"}])
    expect(program.modules[1].imports).toMatchObject([{
      declarationId: "model#record:0",
      importedName: "User",
      localName: "Model::User",
      moduleId: "model"
    }])
    expect(program.modules[2].entryPoint?.body.statements[1]).toMatchObject({
      expression: {callee: "MathTools.label", resolution: {declarationId: "math_tools#function:0"}}
    })
  })

  it("adapts canonical PHP namespaces, imports, and literal require-once edges", () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [
        {
          filename: "main.php",
          id: "main",
          language: "php",
          source: `<?php
declare(strict_types=1);
namespace App\\Main;

use App\\Model\\User;
use function App\\Math\\label;
require_once __DIR__ . "/model.php";
require_once __DIR__ . "/math.php";

$user = new User("Ada");
echo label($user), PHP_EOL;
`
        },
        {
          filename: "math.php",
          id: "math_tools",
          language: "php",
          source: `<?php
declare(strict_types=1);
namespace App\\Math;

use App\\Model\\User;
require_once __DIR__ . "/model.php";

function label(User $user): string {
    return $user->name;
}
`
        },
        {
          filename: "model.php",
          id: "model",
          language: "php",
          source: `<?php
declare(strict_types=1);
namespace App\\Model;

final readonly class User {
    public function __construct(public string $name) {}
}
`
        }
      ]
    })

    expect(program.modules.map(({id}) => id)).toEqual(["model", "math_tools", "main"])
    expect(program.modules[1].imports).toMatchObject([{
      declarationId: "model#record:0",
      importedName: "User",
      localName: "User",
      symbolKind: "record"
    }])
    expect(program.modules[2].imports.map(({declarationId}) => declarationId)).toEqual([
      "model#record:0",
      "math_tools#function:0"
    ])
  })

  it("adapts canonical Java packages, imports, and one-public-class files", () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [
        {
          filename: "src/app/main/Main.java",
          id: "main",
          language: "java",
          source: `package app.main;
import app.model.User;
import app.math.MathTools;

public final class Main {
  public static void main(String[] args) {
    final User user = new User("Ada");
    System.out.println(MathTools.label(user));
  }
}
`
        },
        {
          filename: "src/app/math/MathTools.java",
          id: "math_tools",
          language: "java",
          source: `package app.math;
import app.model.User;

public final class MathTools {
  public static String label(User user) {
    return user.name();
  }
}
`
        },
        {
          filename: "src/app/model/User.java",
          id: "model",
          language: "java",
          source: `package app.model;

public final class User {
  private final String name;

  public User(String name) {
    this.name = name;
  }

  public String name() {
    return this.name;
  }
}
`
        }
      ]
    })

    expect(program.modules.map(({id}) => id)).toEqual(["model", "math_tools", "main"])
    expect(program.modules[1].imports).toMatchObject([{
      declarationId: "model#record:0",
      localName: "User",
      symbolKind: "record"
    }])
    expect(program.modules[2].imports.map(({localName}) => localName)).toEqual(["User", "MathTools.label"])
    expect(program.modules[2].entryPoint?.body.statements[1]).toMatchObject({
      expression: {callee: "MathTools.label", resolution: {declarationId: "math_tools#function:0"}}
    })
  })
})
