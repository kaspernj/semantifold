// @ts-check

import assert from "node:assert/strict"
import {access, chmod, mkdir, mkdtemp, rm, symlink, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {
  canonicalToolchains,
  createGeneratedArtifactSet,
  discoverCanonicalToolchain,
  discoverToolchain,
  runAcceptanceStages,
  SemantifoldDiagnostic
} from "../index.js"

const synthetic = (reason = "acceptance fixture") => ({kind: "synthetic", reason, relatedOrigins: []})

describe("toolchain discovery and staged acceptance", () => {
  it("discovers configured and canonical exact executables with captured versions", async () => {
    await withTemporaryDirectory("semantifold-tools-", async (directory) => {
      const executable = await fakeExecutable(directory, "demo-tool", `#!/bin/sh
if [ "$1" = "--version" ]; then printf 'demo 1.2.3\\n'; exit 0; fi
printf '%s|%s|%s|%s\\n' "$1" "$LC_ALL" "$TZ" "$PWD"
`)
      const canonical = await discoverToolchain({
        canonicalCommand: "demo-tool",
        environment: {PATH: directory},
        id: "demo",
        supportedVersion: /^demo 1\.2\.3$/u,
        versionArguments: ["--version"]
      })
      const configured = await discoverToolchain({
        canonicalCommand: "absent-tool",
        environment: {PATH: ""},
        id: "configured-demo",
        override: executable,
        supportedVersion: /^demo 1/u,
        versionArguments: ["--version"]
      })

      expect(canonical.executable).toEqual(executable)
      expect(canonical.source).toEqual("canonical")
      expect(canonical.version).toEqual("demo 1.2.3")
      expect(configured.executable).toEqual(executable)
      expect(configured.source).toEqual("override")
      expect(Object.isFrozen(configured)).toBeTrue()
    })
  })

  it("uses the configured Node executable while the same canonical PATH remains ambiguous", async () => {
    await withTemporaryDirectory("semantifold-node-override-", async (root) => {
      const [firstDirectory, secondDirectory] = await Promise.all([
        mkdtemp(path.join(root, "first-")),
        mkdtemp(path.join(root, "second-"))
      ])
      const source = "#!/bin/sh\nprintf 'v24.18.1\\n'\n"
      const selected = await fakeExecutable(firstDirectory, "node", source)

      await fakeExecutable(secondDirectory, "node", source)
      const ambiguousPath = `${firstDirectory}${path.delimiter}${secondDirectory}`
      const configured = await discoverCanonicalToolchain("node", {
        environment: {PATH: ambiguousPath, SEMANTIFOLD_NODE: selected}
      })

      expect(configured.executable).toEqual(selected)
      expect(configured.source).toEqual("override")
      await expectDiagnostic(
        () => discoverCanonicalToolchain("node", {environment: {PATH: ambiguousPath}}),
        "TOOL_AMBIGUOUS"
      )
    })
  })

  it("detaches version arguments before asynchronous executable lookup", async () => {
    await withTemporaryDirectory("semantifold-version-arguments-", async (directory) => {
      const executable = await fakeExecutable(directory, "argument-tool", `#!/bin/sh
if [ "$1" = "--expected" ]; then printf 'argument-tool 1\n'; exit 0; fi
printf 'unexpected argument: %s\n' "$1" >&2
exit 11
`)
      const versionArguments = ["--expected"]
      const pendingDiscovery = discoverToolchain({
        canonicalCommand: "argument-tool",
        environment: {PATH: directory},
        id: "argument-tool",
        override: executable,
        versionArguments
      })

      versionArguments[0] = "--caller-mutated"
      const tool = await pendingDiscovery

      expect(tool.version).toEqual("argument-tool 1")
      expect(tool.versionArguments).toEqual(["--expected"])
      expect(Object.isFrozen(tool.versionArguments)).toBeTrue()
    })
  })

  it("detaches the supported version policy before asynchronous executable lookup", async () => {
    await withTemporaryDirectory("semantifold-version-policy-", async (directory) => {
      const executable = await fakeExecutable(directory, "policy-tool", "#!/bin/sh\nprintf 'unexpected 1\\n'\n")
      const policy = /^expected 1$/iu
      const pendingDiscovery = discoverToolchain({
        canonicalCommand: "policy-tool",
        environment: {PATH: directory},
        id: "policy-tool",
        override: executable,
        supportedVersion: policy,
        versionArguments: []
      })

      policy.test = () => true
      await expectDiagnostic(() => pendingDiscovery, "TOOL_UNSUPPORTED_VERSION")

      const flagsExecutable = await fakeExecutable(directory, "flags-tool", "#!/bin/sh\nprintf 'EXPECTED 1\\n'\n")
      const supported = await discoverToolchain({
        canonicalCommand: "flags-tool",
        id: "flags-tool",
        override: flagsExecutable,
        supportedVersion: /^expected 1$/iu,
        versionArguments: []
      })

      expect(supported.version).toEqual("EXPECTED 1")
    })
  })

  it("accepts only regular executable files without polluting canonical ambiguity", async () => {
    await withTemporaryDirectory("semantifold-regular-tools-", async (root) => {
      const directoryCandidateRoot = await mkdtemp(path.join(root, "directory-"))
      const directoryAliasRoot = await mkdtemp(path.join(root, "directory-alias-"))
      const executableRoot = await mkdtemp(path.join(root, "executable-"))
      const firstExecutableAliasRoot = await mkdtemp(path.join(root, "executable-alias-first-"))
      const secondExecutableAliasRoot = await mkdtemp(path.join(root, "executable-alias-second-"))
      const directoryCandidate = path.join(directoryCandidateRoot, "demo-tool")
      const directoryAlias = path.join(directoryAliasRoot, "demo-tool")

      await mkdir(directoryCandidate, {mode: 0o755})
      await symlink(directoryCandidate, directoryAlias)
      const executable = await fakeExecutable(executableRoot, "demo-tool", "#!/bin/sh\nprintf 'demo 1\\n'\n")
      const invalidPath = [directoryCandidateRoot, directoryAliasRoot].join(path.delimiter)
      const canonical = await discoverToolchain({
        canonicalCommand: "demo-tool",
        environment: {PATH: `${invalidPath}${path.delimiter}${executableRoot}`},
        id: "regular-canonical",
        versionArguments: []
      })

      expect(canonical.executable).toEqual(executable)
      await expectDiagnostic(() => discoverToolchain({
        canonicalCommand: "demo-tool",
        environment: {PATH: invalidPath},
        id: "invalid-canonical",
        versionArguments: []
      }), "TOOL_NOT_FOUND")
      for (const override of [directoryCandidate, directoryAlias]) {
        await expectDiagnostic(() => discoverToolchain({
          canonicalCommand: "demo-tool",
          id: "invalid-override",
          override,
          versionArguments: []
        }), "TOOL_NOT_FOUND")
      }

      await Promise.all([
        symlink(executable, path.join(firstExecutableAliasRoot, "demo-tool")),
        symlink(executable, path.join(secondExecutableAliasRoot, "demo-tool"))
      ])
      const aliased = await discoverToolchain({
        canonicalCommand: "demo-tool",
        environment: {PATH: `${firstExecutableAliasRoot}${path.delimiter}${secondExecutableAliasRoot}`},
        id: "aliased-canonical",
        versionArguments: []
      })

      expect(aliased.executable).toEqual(executable)
    })
  })

  it("distinguishes spontaneous version signals from configured timer kills", async () => {
    await withTemporaryDirectory("semantifold-version-signals-", async (directory) => {
      const signalExecutable = await fakeExecutable(directory, "signal-tool", "#!/bin/sh\nkill -TERM $$\n")
      const timeoutExecutable = await fakeExecutable(directory, "timeout-tool", "#!/bin/sh\nwhile :; do :; done\n")

      await assert.rejects(() => discoverToolchain({
        canonicalCommand: "signal-tool",
        id: "signal-version",
        override: signalExecutable,
        timeoutMs: 2_000,
        versionArguments: []
      }), (error) => error instanceof SemantifoldDiagnostic && error.code == "TOOL_VERSION_FAILURE" && error.signal == "SIGTERM")
      await assert.rejects(() => discoverToolchain({
        canonicalCommand: "timeout-tool",
        id: "timeout-version",
        override: timeoutExecutable,
        timeoutMs: 50,
        versionArguments: []
      }), (error) => error instanceof SemantifoldDiagnostic && error.code == "TOOL_VERSION_TIMEOUT" && error.signal == "SIGTERM")
    })
  })

  it("reports missing, ambiguous, unsupported-version, and version-command failures distinctly", async () => {
    await expectDiagnostic(
      // @ts-expect-error Deliberately malformed canonical discovery options.
      () => discoverCanonicalToolchain("php", null),
      "INVALID_TOOLCHAIN"
    )
    await expectDiagnostic(
      // @ts-expect-error Deliberately malformed public discovery request.
      () => discoverToolchain(undefined),
      "INVALID_TOOLCHAIN"
    )
    await expectDiagnostic(
      () => discoverToolchain({canonicalCommand: "missing", environment: {PATH: ""}, id: "missing", versionArguments: ["--version"]}),
      "TOOL_NOT_FOUND"
    )

    await withTemporaryDirectory("semantifold-ambiguous-", async (root) => {
      const first = path.join(root, "first")
      const second = path.join(root, "second")

      await Promise.all([mkdtemp(`${first}-`), mkdtemp(`${second}-`)]).then(async ([firstDirectory, secondDirectory]) => {
        await fakeExecutable(firstDirectory, "same-tool", "#!/bin/sh\nprintf 'same 1\\n'\n")
        await fakeExecutable(secondDirectory, "same-tool", "#!/bin/sh\nprintf 'same 1\\n'\n")
        await expectDiagnostic(() => discoverToolchain({
          canonicalCommand: "same-tool",
          environment: {PATH: `${firstDirectory}${path.delimiter}${secondDirectory}`},
          id: "ambiguous",
          versionArguments: []
        }), "TOOL_AMBIGUOUS")
      })
    })

    await withTemporaryDirectory("semantifold-version-", async (directory) => {
      const old = await fakeExecutable(directory, "old-tool", "#!/bin/sh\nprintf 'old 0.1\\n'\n")
      const broken = await fakeExecutable(directory, "broken-tool", "#!/bin/sh\nprintf 'broken\\n' >&2\nexit 7\n")

      await expectDiagnostic(() => discoverToolchain({
        canonicalCommand: "old-tool",
        environment: {PATH: directory},
        id: "old",
        supportedVersion: /^new/u,
        versionArguments: []
      }), "TOOL_UNSUPPORTED_VERSION")
      await expectDiagnostic(() => discoverToolchain({
        canonicalCommand: "unused",
        environment: {PATH: directory},
        id: "broken",
        override: broken,
        versionArguments: []
      }), "TOOL_VERSION_FAILURE")
      assert.ok(old)
    })
  })

  it("runs argument-array stages in an isolated deterministic environment and removes the project directory", async () => {
    await withTemporaryDirectory("semantifold-runner-tool-", async (directory) => {
      const executable = await fakeExecutable(directory, "stage-tool", `#!/bin/sh
if [ "$1" = "--version" ]; then printf 'stage 1\\n'; exit 0; fi
test -f program.txt || exit 8
test -z "$HOME" || exit 10
printf '%s|%s|%s|%s\\n' "$1" "$LC_ALL" "$TZ" "$PWD"
`)
      const tool = await discoverToolchain({
        canonicalCommand: "unused",
        environment: {PATH: directory},
        id: "stage",
        override: executable,
        versionArguments: ["--version"]
      })
      const artifacts = createGeneratedArtifactSet({
        artifacts: [{
          content: "input\n",
          contentKind: "text",
          mediaType: "text/plain",
          ownership: "generated",
          path: "program.txt",
          provenance: synthetic(),
          role: "entry"
        }],
        target: "demo"
      })
      const parseArguments = ["parse"]
      const result = await runAcceptanceStages({
        artifacts,
        stages: [
          {arguments: parseArguments, stage: "parse", tool},
          {arguments: ["generate"], stage: "generate", tool},
          {arguments: ["compile"], stage: "compile", tool},
          {arguments: ["link"], stage: "link", tool},
          {arguments: ["validate"], stage: "validate", tool},
          {arguments: ["instantiate"], stage: "instantiate", tool},
          {arguments: ["execute"], stage: "execute", tool}
        ],
        target: "demo",
        timeoutMs: 2_000
      })

      parseArguments[0] = "caller-mutated"
      expect(result.stages.map(({stage}) => stage)).toEqual([
        "parse", "generate", "compile", "link", "validate", "instantiate", "execute"
      ])
      expect(result.stages[0].arguments).toEqual(["parse"])
      expect(Object.isFrozen(result.stages[0].arguments)).toBeTrue()
      assert.throws(() => {
        /** @type {string[]} */ (result.stages[0].arguments)[0] = "result-mutated"
      }, TypeError)
      for (const stage of result.stages) {
        assert.match(stage.stdout, new RegExp(`^${stage.stage}\\|C\\.UTF-8\\|UTC\\|`, "u"))
        expect(stage.executable).toEqual(executable)
        expect(stage.version).toEqual("stage 1")
      }
      await assert.rejects(access(result.directory))
    })
  })

  it("detaches structural stage tools before asynchronous acceptance setup", async () => {
    await withTemporaryDirectory("semantifold-runner-tool-race-", async (directory) => {
      const expectedExecutable = await fakeExecutable(directory, "expected-tool", `#!/bin/sh
if [ "$1" = "--version" ]; then printf 'expected 1\n'; exit 0; fi
printf 'expected\n'
`)
      const mutatedExecutable = await fakeExecutable(directory, "mutated-tool", "#!/bin/sh\nprintf 'mutated\\n'\n")
      const discovered = await discoverToolchain({
        canonicalCommand: "expected-tool",
        id: "expected",
        override: expectedExecutable,
        versionArguments: ["--version"]
      })
      const mutableTool = {...discovered}
      const artifacts = createGeneratedArtifactSet({artifacts: [{
        content: "input\n",
        contentKind: "text",
        mediaType: "text/plain",
        ownership: "generated",
        path: "input.txt",
        provenance: synthetic(),
        role: "entry"
      }], target: "demo"})
      const pendingRun = runAcceptanceStages({
        artifacts,
        stages: [{arguments: [], stage: "execute", tool: mutableTool}],
        target: "demo"
      })

      mutableTool.executable = mutatedExecutable
      mutableTool.version = "caller-mutated"
      const result = await pendingRun

      expect(result.stages[0].stdout).toEqual("expected\n")
      expect(result.stages[0].executable).toEqual(expectedExecutable)
      expect(result.stages[0].version).toEqual("expected 1")
    })
  })

  it("reports post-launch output overflow with bounded stage evidence", async () => {
    await withTemporaryDirectory("semantifold-runner-output-limit-", async (directory) => {
      const outputChunk = "x".repeat(1024)
      const executable = await fakeExecutable(directory, "output-tool", `#!/bin/sh
if [ "$1" = "--version" ]; then printf 'output 1\n'; exit 0; fi
counter=0
while [ "$counter" -lt 16385 ]; do
  printf '%s' '${outputChunk}'
  counter=$((counter + 1))
done
`)
      const tool = await discoverToolchain({
        canonicalCommand: "output-tool",
        id: "output-tool",
        override: executable,
        versionArguments: ["--version"]
      })
      const artifacts = createGeneratedArtifactSet({artifacts: [{
        content: "input\n",
        contentKind: "text",
        mediaType: "text/plain",
        ownership: "generated",
        path: "input.txt",
        provenance: synthetic(),
        role: "entry"
      }], target: "demo"})
      /** @type {SemantifoldDiagnostic | undefined} */
      let failure

      try {
        await runAcceptanceStages({artifacts, stages: [{arguments: [], stage: "compile", tool}], target: "demo"})
      } catch (error) {
        assert.ok(error instanceof SemantifoldDiagnostic)
        failure = error
      }

      assert.ok(failure)
      expect(failure.code).toEqual("ACCEPTANCE_OUTPUT_LIMIT")
      expect(failure.stage).toEqual("compile")
      expect(failure.stdout).toEqual("")
      expect(failure.stderr).toEqual("")
      expect(failure.cause).toEqual(undefined)
      assert.ok(failure.detail.length < 512)
      assert.doesNotMatch(failure.detail, /xxx/u)
    })
  })

  it("normalizes invalid runner input, nonzero exits, launch failures, and timeouts by exact stage", async () => {
    await expectDiagnostic(
      // @ts-expect-error Deliberately malformed public runner request.
      () => runAcceptanceStages(undefined),
      "INVALID_ACCEPTANCE_RUNNER"
    )
    await withTemporaryDirectory("semantifold-runner-fail-", async (directory) => {
      const failingExecutable = await fakeExecutable(directory, "fail-tool", `#!/bin/sh
if [ "$1" = "--version" ]; then printf 'fail 1\\n'; exit 0; fi
printf 'bad output\\n' >&2
exit 9
`)
      const slowExecutable = await fakeExecutable(directory, "slow-tool", `#!/bin/sh
if [ "$1" = "--version" ]; then printf 'slow 1\\n'; exit 0; fi
while :; do :; done
`)
      const signalExecutable = await fakeExecutable(directory, "signal-tool", `#!/bin/sh
if [ "$1" = "--version" ]; then printf 'signal 1\\n'; exit 0; fi
kill -TERM $$
`)
      const failing = await discoverToolchain({canonicalCommand: "unused", id: "fail", override: failingExecutable, versionArguments: ["--version"]})
      const slow = await discoverToolchain({canonicalCommand: "unused", id: "slow", override: slowExecutable, versionArguments: ["--version"]})
      const signaled = await discoverToolchain({canonicalCommand: "unused", id: "signal", override: signalExecutable, versionArguments: ["--version"]})
      const empty = createGeneratedArtifactSet({artifacts: [{
        content: "input\n",
        contentKind: "text",
        mediaType: "text/plain",
        ownership: "generated",
        path: "input.txt",
        provenance: synthetic(),
        role: "entry"
      }], target: "demo"})

      await expectDiagnostic(
        () => runAcceptanceStages({artifacts: empty, stages: [{arguments: [], stage: "compile", tool: failing}], target: "demo"}),
        "ACCEPTANCE_NONZERO_EXIT",
        "compile"
      )
      await expectDiagnostic(
        () => runAcceptanceStages({
          artifacts: empty,
          stages: [{arguments: [], stage: "execute", tool: {...failing, executable: path.join(directory, "gone")}}],
          target: "demo"
        }),
        "ACCEPTANCE_LAUNCH_FAILURE",
        "execute"
      )
      await expectDiagnostic(
        () => runAcceptanceStages({artifacts: empty, stages: [{arguments: [], stage: "validate", tool: slow}], target: "demo", timeoutMs: 50}),
        "ACCEPTANCE_TIMEOUT",
        "validate"
      )
      await assert.rejects(
        () => runAcceptanceStages({artifacts: empty, stages: [{arguments: [], stage: "execute", tool: signaled}], target: "demo"}),
        (error) => error instanceof SemantifoldDiagnostic && error.code == "ACCEPTANCE_SIGNAL" && error.stage == "execute" &&
          error.signal == "SIGTERM"
      )
      await expectDiagnostic(
        () => runAcceptanceStages({
          artifacts: empty,
          // @ts-expect-error Deliberately malformed argument contract.
          stages: [{arguments: "unsafe", stage: "execute", tool: failing}],
          target: "demo"
        }),
        "INVALID_ACCEPTANCE_RUNNER"
      )
      await expectDiagnostic(
        () => runAcceptanceStages({artifacts: empty, stages: [{arguments: [], stage: "execute", tool: failing}], target: "other"}),
        "INVALID_ACCEPTANCE_RUNNER"
      )
      const unmaterializable = createGeneratedArtifactSet({artifacts: [{
        content: "input\n",
        contentKind: "text",
        mediaType: "text/plain",
        ownership: "generated",
        path: `${"x".repeat(300)}.txt`,
        provenance: synthetic(),
        role: "entry"
      }], target: "demo"})

      await expectDiagnostic(
        () => runAcceptanceStages({artifacts: unmaterializable, stages: [{arguments: [], stage: "execute", tool: failing}], target: "demo"}),
        "ACCEPTANCE_MATERIALIZATION_FAILURE"
      )
    })
  })

  it("executes small programs through every declared original-five real toolchain", async () => {
    const php = await discoverCanonicalToolchain("php")
    const ruby = await discoverCanonicalToolchain("ruby")
    const node = await discoverCanonicalToolchain("node")
    const tsc = await discoverCanonicalToolchain("tsc")
    const javac = await discoverCanonicalToolchain("javac")
    const java = await discoverCanonicalToolchain("java")

    expect(Object.keys(canonicalToolchains)).toEqual(["php", "ruby", "node", "tsc", "javac", "java"])
    await runProgram("php", "program.php", "<?php\necho \"ok\\n\";\n", [{arguments: ["program.php"], stage: "execute", tool: php}])
    await runProgram("ruby", "program.rb", "puts \"ok\"\n", [{arguments: ["program.rb"], stage: "execute", tool: ruby}])
    await runProgram("javascript", "program.js", "console.log(\"ok\")\n", [{arguments: ["program.js"], stage: "execute", tool: node}])
    await runProgram("typescript", "program.ts", "const value: string = \"ok\"\nconsole.log(value)\n", [
      {arguments: ["program.ts", "--target", "ES2024", "--module", "nodenext"], stage: "compile", tool: tsc},
      {arguments: ["program.js"], stage: "execute", tool: node}
    ])
    await runProgram("java", "Main.java", "public final class Main { public static void main(String[] args) { System.out.println(\"ok\"); } }\n", [
      {arguments: ["Main.java"], stage: "compile", tool: javac},
      {arguments: ["-cp", ".", "Main"], stage: "execute", tool: java}
    ])
  })
})

/** @param {string} target @param {string} filePath @param {string} content @param {any[]} stages */
async function runProgram(target, filePath, content, stages) {
  const artifacts = createGeneratedArtifactSet({artifacts: [{
    content,
    contentKind: "text",
    mediaType: "text/plain",
    ownership: "generated",
    path: filePath,
    provenance: synthetic(),
    role: "entry"
  }], target})
  const result = await runAcceptanceStages({artifacts, stages, target, timeoutMs: 20_000})

  expect(result.stages.at(-1).stdout).toEqual("ok\n")
}

/** @param {string} prefix @param {(directory: string) => Promise<void>} callback */
async function withTemporaryDirectory(prefix, callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix))

  try {
    await callback(directory)
  } finally {
    await rm(directory, {force: true, recursive: true})
  }
}

/** @param {string} directory @param {string} name @param {string} source */
async function fakeExecutable(directory, name, source) {
  const executable = path.join(directory, name)

  await writeFile(executable, source)
  await chmod(executable, 0o755)

  return executable
}

/** @param {() => Promise<unknown>} callback @param {string} code @param {string} [stage] */
async function expectDiagnostic(callback, code, stage) {
  await assert.rejects(callback, (error) => error instanceof SemantifoldDiagnostic && error.code == code &&
    (stage == undefined || error.stage == stage))
}
