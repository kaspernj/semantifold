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
const commands = [
  "dart pub get --offline --no-precompile",
  "dart format --output=none --set-exit-if-changed bin/program.dart",
  "dart analyze --fatal-infos --fatal-warnings",
  "dart run bin/program.dart",
  "dart compile exe bin/program.dart -o semantifold-dart",
  "./semantifold-dart"
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
      expect(result.immutabilityCommands).toEqual(commands)
      expect(result.commandResults.map(({label, status, stderr}) => ({label, status, stderr}))).toEqual(
        commands.map((label) => ({label, status: 0, stderr: ""})))
      expect(result.commandResults[0]?.stdout).toEqual("Resolving dependencies...\nDownloading packages...\nGot dependencies!\n")
      expect(result.commandResults[1]?.stdout.replace(/in [0-9]+\.[0-9]+ seconds\.\n$/u, "in <seconds>.\n"))
        .toEqual("Formatted 1 file (0 changed) in <seconds>.\n")
      expect(result.commandResults[2]?.stdout).toEqual("Analyzing verification...\nNo issues found!\n")
      expect(result.commandResults[3]?.stdout).toEqual(expected)
      expect(result.commandResults[4]?.stdout.replace(
        /^Generated: \/[^\n]*\/verification\/semantifold-dart\n$/u,
        "Generated: <absolute>/verification/semantifold-dart\n"
      )).toEqual("Generated: <absolute>/verification/semantifold-dart\n")
      expect(result.commandResults[5]?.stdout).toEqual(expected)
      expect(result.acceptance.stages.map(({stderr}) => stderr)).toEqual(["", "", "", ""])
      expect(result.acceptance.stages[0]?.stdout).toEqual("Resolving dependencies...\nDownloading packages...\nGot dependencies!\n")
      expect(result.acceptance.stages[1]?.stdout.replace(
        /^Generated: \/[^\n]*\/native\/semantifold-dart\n$/u,
        "Generated: <absolute>/native/semantifold-dart\n"
      )).toEqual("Generated: <absolute>/native/semantifold-dart\n")
      expect(result.acceptance.stages[2]?.stdout.replace(
        /^Analyzing semantifold-acceptance-[^\n]+\.\.\.\n/u,
        "Analyzing <isolated-project>...\n"
      )).toEqual("Analyzing <isolated-project>...\nNo issues found!\n")
      expect(result.acceptance.stages[3]?.stdout).toEqual(expected)
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

  it("formats, reparses, analyzes, and executes an over-width signature while preserving underscore identifiers", async () => {
    const source = `int formatterCanonicalFunctionWithLongName(int _value, int secondParameterValue, int thirdParameterValue, int fourthParameterValue, int fifthParameterValue, int sixthParameterValue) {
  final int _copy = _value;
  return _copy + secondParameterValue;
}

void main() {
  print(formatterCanonicalFunctionWithLongName(1, 2, 3, 4, 5, 6));
}
`
    const module = parse({filename: "wide.dart", language: "dart", source})
    const result = await executeDart(module)

    expect(result.acceptance.stages.at(-1)?.stdout).toEqual("3\n")
    expect(result.native).toEqual({stderr: "", stdout: "3\n"})
  })

  it("preserves an unread local initializer while remaining analyzer-clean on the VM and native runtime", async () => {
    const source = `int announce(int value) {
  print(value);
  return value;
}

void main() {
  final int unused = announce(7);
  print("done");
}
`
    const result = await executeDart(parse({filename: "unused.dart", language: "dart", source}))
    const expected = "7\ndone\n"

    expect(result.commandResults[2]).toEqual({
      label: "dart analyze --fatal-infos --fatal-warnings",
      status: 0,
      stderr: "",
      stdout: "Analyzing verification...\nNo issues found!\n"
    })
    expect(result.acceptance.stages.at(-1)?.stdout).toEqual(expected)
    expect(result.native).toEqual({stderr: "", stdout: expected})
  })
})
