// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {parse, SemantifoldDiagnostic} from "../index.js"

const sources = [
  ["ruby", "program.rb", `# @param limit [Integer]
# @return [Integer]
def run(limit)
  # @type [Integer]
  outer = 0
  while outer < limit
    outer = outer + 1
    # @type [Integer]
    inner = 0
    while inner < limit
      inner = inner + 1
      if inner == 1
        next
      end
      break
    end
    break
  end
  return outer
end
`],
  ["javascript", "program.js", `/**
 * @param {number} limit
 * @returns {number}
 */
function run(limit) {
  /** @type {number} */
  let outer = 0
  while (outer < limit) {
    outer = outer + 1
    /** @type {number} */
    let inner = 0
    while (inner < limit) {
      inner = inner + 1
      if (inner === 1) { continue }
      break
    }
    break
  }
  return outer
}
`],
  ["typescript", "program.ts", `function run(limit: number): number {
  let outer: number = 0
  while (outer < limit) {
    outer = outer + 1
    let inner: number = 0
    while (inner < limit) {
      inner = inner + 1
      if (inner === 1) { continue }
      break
    }
    break
  }
  return outer
}
`],
  ["php", "program.php", `<?php
declare(strict_types=1);
function run(int $limit): int {
    /** @var int $outer */
    $outer = 0;
    while ($outer < $limit) {
        $outer = $outer + 1;
        /** @var int $inner */
        $inner = 0;
        while ($inner < $limit) {
            $inner = $inner + 1;
            if ($inner === 1) { continue; }
            break;
        }
        break;
    }
    return $outer;
}
`],
  ["java", "Main.java", `public final class Main {
  private static int run(int limit) {
    int outer = 0;
    while (outer < limit) {
      outer = outer + 1;
      int inner = 0;
      while (inner < limit) {
        inner = inner + 1;
        if (inner == 1) { continue; }
        break;
      }
      break;
    }
    return outer;
  }
  public static void main(String[] args) {}
}
`]
]

function loopParts(module) {
  const outer = /** @type {import("../src/semantic/types.js").WhileStatement} */ (module.functions[0].body.statements[1])
  const inner = /** @type {import("../src/semantic/types.js").WhileStatement} */ (outer.body.statements[2])
  const branch = /** @type {import("../src/semantic/types.js").IfStatement} */ (inner.body.statements[1])

  return {
    branch,
    inner,
    innerBreak: /** @type {import("../src/semantic/types.js").BreakStatement} */ (inner.body.statements[2]),
    innerContinue: /** @type {import("../src/semantic/types.js").ContinueStatement} */ (branch.consequent.statements[0]),
    outer,
    outerBreak: /** @type {import("../src/semantic/types.js").BreakStatement} */ (outer.body.statements[3])
  }
}

describe("condition-controlled loop frontends", () => {
  it("normalizes all five ordinary pre-condition loops and resolves nearest-loop control identities", () => {
    for (const [language, filename, source] of sources) {
      const module = parse({filename, language, source})
      const {inner, innerBreak, innerContinue, outer, outerBreak} = loopParts(module)

      expect(outer).toMatchObject({id: "loop:0", kind: "WhileStatement"})
      expect(inner).toMatchObject({id: "loop:1", kind: "WhileStatement"})
      expect(outer.condition.kind).toEqual("BinaryExpression")
      expect(outer.body.kind).toEqual("Block")
      expect(innerContinue.targetLoopId).toEqual(inner.id)
      expect(innerBreak.targetLoopId).toEqual(inner.id)
      expect(outerBreak.targetLoopId).toEqual(outer.id)
    }
  })

  it("rejects alternate loop forms, non-block bodies, labels, and valued or multi-level exits", () => {
    const rejected = [
      ["javascript", "program.js", "/**\n * @param {boolean} flag\n * @returns {void}\n */\nfunction run(flag) { do { break } while (flag) }\n"],
      ["typescript", "program.ts", "function run(flag: boolean): void { while (flag) break }\n"],
      ["php", "program.php", "<?php\ndeclare(strict_types=1);\nfunction run(bool $flag): void { while ($flag): break; endwhile; }\n"],
      ["ruby", "program.rb", "# @param flag [bool]\n# @return [void]\ndef run(flag)\n  break while flag\nend\n"],
      ["java", "Main.java", "public final class Main { private static void run(boolean flag) { do { break; } while (flag); } public static void main(String[] args) {} }"],
      ["javascript", "program.js", "/**\n * @param {boolean} flag\n * @returns {void}\n */\nfunction run(flag) { outer: while (flag) { break outer } }\n"],
      ["php", "program.php", "<?php\ndeclare(strict_types=1);\nfunction run(bool $flag): void { while ($flag) { break 2; } }\n"],
      ["ruby", "program.rb", "# @param flag [bool]\n# @return [void]\ndef run(flag)\n  while flag\n    break 1\n  end\nend\n"],
      ["java", "Main.java", "public final class Main { private static void run(boolean flag) { outer: while (flag) { break outer; } } public static void main(String[] args) {} }"]
    ]

    for (const [language, filename, source] of rejected) {
      assert.throws(
        () => parse({filename, language, source}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_SYNTAX" &&
          error.language == language && error.location?.filename == filename
      )
    }
  })
})
