// @ts-check

import {readFile} from "node:fs/promises"
import {describe, expect, it} from "@velocious/testing"
import {parse} from "../index.js"
import {executeDart} from "./support/dart-toolchain.js"

const profiles = [
  ["", "5\n"],
  ["scalars/", "yes\n"],
  ["locals/", "yes\n"],
  ["operators/", "typed:operators\n"],
  ["statements/", "checking\nyes\nmatched\nfallback\n"],
  ["functions/", "ready\n6\n"]
]

describe("Dart VM and native execution", () => {
  for (const [directory, expected] of profiles) {
    it(`executes the ${directory || "base"} Dart fixture identically on the VM and native runtime`, async () => {
      const source = await readFile(new URL(`fixtures/${directory}program.dart`, import.meta.url), "utf8")
      const module = parse({filename: `${directory}program.dart`, language: "dart", source})
      const result = await executeDart(module)

      expect(result.acceptance.stages.map(({stage}) => stage)).toEqual(["restore", "compile", "validate", "execute"])
      expect(result.acceptance.stages.at(-1)?.stdout).toEqual(expected)
      expect(result.acceptance.stages.at(-1)?.stderr).toEqual("")
      expect(result.native).toEqual({stderr: "", stdout: expected})
      expect(result.sourceHashes.length).toEqual(3)
      if (directory == "") {
        expect(result.immutabilityCommands).toEqual([
          "dart pub get --offline --no-precompile",
          "dart format --output=none --set-exit-if-changed bin/program.dart",
          "dart analyze --fatal-infos --fatal-warnings",
          "dart run bin/program.dart",
          "dart compile exe bin/program.dart -o semantifold-dart",
          "./semantifold-dart"
        ])
      }
    })
  }

  it("preserves eager argument order, short-circuiting, Unicode, recursion, and the safe-integer boundary", async () => {
    const source = `int announceInt(int value) {
  print(value);
  return value;
}

bool forbidden() {
  print("not evaluated");
  return true;
}

int sum3(int first, int second, int third) {
  return first + second + third;
}

int countdown(int value) {
  if (value > 0) {
    return countdown(value - 1);
  }
  return value;
}

void main() {
  print("Dart 🚀");
  print(sum3(announceInt(1), announceInt(2), announceInt(3)));
  if (false && forbidden()) {
    print("bad");
  }
  if (true || forbidden()) {
    print(9007199254740991);
  }
  print(countdown(3));
}
`
    const result = await executeDart(parse({filename: "boundary.dart", language: "dart", source}))
    const expected = "Dart 🚀\n1\n2\n3\n6\n9007199254740991\n0\n"

    expect(result.acceptance.stages.at(-1)?.stdout).toEqual(expected)
    expect(result.native.stdout).toEqual(expected)
  })
})
