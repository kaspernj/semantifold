// @ts-check

import assert from "node:assert/strict"
import {watch} from "node:fs"
import {access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {describe, expect, it} from "@velocious/testing"
import {createAcceptanceRunner} from "../src/acceptance.js"
import {
  canonicalToolchains,
  createGeneratedArtifactSet,
  discoverCanonicalToolchain,
  discoverToolchain,
  runAcceptanceStages,
  SemantifoldDiagnostic
} from "../index.js"

const synthetic = (reason = "acceptance fixture") => ({kind: "synthetic", reason, relatedOrigins: []})
const escapedProcessGroupFixture = fileURLToPath(new URL("fixtures/escape-process-group.js", import.meta.url))
const ignoreSigtermTreeFixture = fileURLToPath(new URL("fixtures/ignore-sigterm-tree.js", import.meta.url))

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

  it("reads each version argument once before validation and execution", async () => {
    await withTemporaryDirectory("semantifold-version-argument-accessor-", async (directory) => {
      const marker = path.join(directory, "executed-argument")
      const executable = await fakeExecutable(directory, "argument-accessor-tool", `#!/bin/sh
printf '%s\n' "$1" > "$2"
printf 'argument-accessor-tool 1\n'
`)
      const versionArguments = ["placeholder", marker]
      let reads = 0

      Object.defineProperty(versionArguments, "0", {
        enumerable: true,
        get() {
          reads += 1
          return reads == 1 ? "--validated" : "--unvalidated"
        }
      })

      const tool = await discoverToolchain({
        canonicalCommand: "argument-accessor-tool",
        id: "argument-accessor-tool",
        override: executable,
        versionArguments
      })

      expect(reads).toEqual(1)
      expect(await readFile(marker, "utf8")).toEqual("--validated\n")
      expect(tool.versionArguments).toEqual(["--validated", marker])
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

  it("defaults discovery configuration only when optional fields are undefined", async () => {
    await withTemporaryDirectory("semantifold-discovery-null-boundaries-", async (directory) => {
      const marker = path.join(directory, "launched")
      const executable = await fakeExecutable(directory, "null-tool", `#!/bin/sh
printf 'launched\n' > "$1"
printf 'null-tool 1\n'
`)
      const base = {
        canonicalCommand: "null-tool",
        environment: {PATH: directory},
        id: "null-tool",
        override: executable,
        supportedVersion: /^null-tool 1$/u,
        timeoutMs: 2_000,
        versionArguments: [marker]
      }
      /** @type {any[]} */
      const candidates = [
        {...base, environment: null},
        {...base, environment: {PATH: null}},
        {...base, override: null},
        {...base, supportedVersion: null},
        {...base, timeoutMs: null}
      ]
      /** @type {string[]} */
      const outcomes = []

      for (const candidate of candidates) {
        try {
          await discoverToolchain(candidate)
          outcomes.push("accepted")
        } catch (error) {
          outcomes.push(error instanceof SemantifoldDiagnostic ? error.code : "native")
        }
      }

      expect(outcomes).toEqual(candidates.map(() => "INVALID_TOOLCHAIN"))
      await assert.rejects(access(marker), (error) => error instanceof Error && "code" in error && error.code == "ENOENT")
      /** @type {any[]} */
      const canonicalOptions = [
        {environment: null},
        {environment: {PATH: "", SEMANTIFOLD_NODE: null}},
        {environment: {PATH: ""}, override: null}
      ]

      for (const options of canonicalOptions) {
        await expectDiagnostic(() => discoverCanonicalToolchain("node", options), "INVALID_TOOLCHAIN")
      }
    })
  })

  it("rejects timeout values above the supported Node timer range at every public runner boundary", async () => {
    await withTemporaryDirectory("semantifold-timeout-range-", async (directory) => {
      const executable = await fakeExecutable(directory, "timer-tool", "#!/bin/sh\nprintf 'v24.0.0\\n'\n")
      const artifacts = createGeneratedArtifactSet({
        artifacts: [{
          content: "input\n",
          contentKind: "text",
          mediaType: "text/plain",
          ownership: "generated",
          path: "input.txt",
          provenance: synthetic(),
          role: "entry"
        }],
        target: "demo"
      })
      const tool = Object.freeze({
        executable,
        id: "timer-tool",
        source: /** @type {const} */ ("override"),
        version: "timer-tool 1",
        versionArguments: Object.freeze([])
      })
      const unsupportedTimeoutMs = 2_147_483_648
      const operations = [
        () => discoverToolchain({
          canonicalCommand: "timer-tool",
          id: "timer-tool",
          override: executable,
          timeoutMs: unsupportedTimeoutMs,
          versionArguments: []
        }),
        () => discoverCanonicalToolchain("node", {override: executable, timeoutMs: unsupportedTimeoutMs}),
        () => runAcceptanceStages({
          artifacts,
          stages: [{arguments: [], stage: "execute", tool}],
          target: "demo",
          timeoutMs: unsupportedTimeoutMs
        })
      ]
      /** @type {string[]} */
      const outcomes = []

      for (const operation of operations) {
        try {
          await operation()
          outcomes.push("accepted")
        } catch (error) {
          outcomes.push(error instanceof SemantifoldDiagnostic ? error.code : "native")
        }
      }

      expect(outcomes).toEqual(["INVALID_TOOLCHAIN", "INVALID_TOOLCHAIN", "INVALID_ACCEPTANCE_RUNNER"])
      expect((await discoverToolchain({
        canonicalCommand: "timer-tool",
        id: "timer-tool",
        override: executable,
        timeoutMs: 2_147_483_647,
        versionArguments: []
      })).version).toEqual("v24.0.0")
    })
  })

  it("validates canonical toolchain IDs before lookup and diagnostic formatting", async () => {
    /** @type {any[]} */
    const malformedIds = [Symbol("node"), "", null, 1, {}, [], new String("node")]
    /** @type {{code: string, detail?: string, language?: string}[]} */
    const outcomes = []

    for (const id of malformedIds) {
      try {
        await discoverCanonicalToolchain(id, {override: path.join(os.tmpdir(), "missing-canonical-id-tool")})
        outcomes.push({code: "accepted"})
      } catch (error) {
        outcomes.push(error instanceof SemantifoldDiagnostic
          ? {code: error.code, detail: error.detail, language: error.language}
          : {code: error instanceof Error ? error.name : "non-error"})
      }
    }

    expect(outcomes).toEqual(malformedIds.map(() => ({
      code: "INVALID_TOOLCHAIN",
      detail: "Canonical toolchain ID must be a non-empty primitive string.",
      language: "toolchain"
    })))
    await assert.rejects(
      // @ts-expect-error Deliberately unknown canonical toolchain identity.
      () => discoverCanonicalToolchain("toString"),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "INVALID_TOOLCHAIN" &&
        error.language == "toString" && error.detail == "Unknown canonical toolchain 'toString'."
    )
  })

  it("requires detached plain data environment records for discovery and acceptance", async () => {
    await withTemporaryDirectory("semantifold-environment-records-", async (directory) => {
      const marker = path.join(directory, "invalid-environment-launched")
      const invalidExecutable = await fakeExecutable(directory, "invalid-environment-tool", `#!/bin/sh
printf 'launched\n' >> "${marker}"
printf 'environment-tool 1\n'
`)
      const validExecutable = await fakeExecutable(directory, "valid-environment-tool", `#!/bin/sh
printf 'environment-tool %s\n' "$EXPECTED"
`)
      const tool = Object.freeze({
        executable: invalidExecutable,
        id: "environment-tool",
        source: /** @type {const} */ ("override"),
        version: "environment-tool 1",
        versionArguments: Object.freeze([])
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
      const inherited = Object.assign(Object.create({SEMANTIFOLD_NODE: invalidExecutable}), {PATH: directory})
      const accessor = {}
      let accessorRead = false

      Object.defineProperty(accessor, "PATH", {
        enumerable: true,
        get() {
          accessorRead = true
          return directory
        }
      })
      class CustomEnvironment {
        PATH = directory
      }
      const nonEnumerable = {}

      Object.defineProperty(nonEnumerable, "PATH", {value: directory})
      /** @type {any[]} */
      const invalidEnvironments = [new Date(0), new Map([["PATH", directory]]), inherited, new CustomEnvironment(), accessor,
        nonEnumerable, {[Symbol("PATH")]: directory}, []]

      for (const environment of invalidEnvironments) {
        await expectDiagnostic(() => discoverToolchain({
          canonicalCommand: "environment-tool",
          environment,
          id: "environment-tool",
          override: invalidExecutable,
          versionArguments: []
        }), "INVALID_TOOLCHAIN")
        await expectDiagnostic(() => runAcceptanceStages({
          artifacts,
          environment,
          stages: [{arguments: [], stage: "execute", tool}],
          target: "demo"
        }), "INVALID_ACCEPTANCE_RUNNER")
      }
      await expectDiagnostic(() => discoverCanonicalToolchain("node", {environment: inherited}), "INVALID_TOOLCHAIN")
      expect(accessorRead).toBeFalse()
      await assert.rejects(access(marker), (error) => error instanceof Error && "code" in error && error.code == "ENOENT")

      const nullPrototypeEnvironment = Object.assign(Object.create(null), {EXPECTED: "owned", PATH: directory, UNUSED: undefined})
      const nullPrototypeTool = await discoverToolchain({
        canonicalCommand: "environment-tool",
        environment: nullPrototypeEnvironment,
        id: "null-prototype-environment",
        override: validExecutable,
        versionArguments: []
      })

      expect(nullPrototypeTool.version).toEqual("environment-tool owned")
      const nullPrototypeAcceptance = await runAcceptanceStages({
        artifacts,
        environment: nullPrototypeEnvironment,
        stages: [{arguments: [], stage: "execute", tool: Object.freeze({...tool, executable: validExecutable})}],
        target: "demo"
      })

      expect(nullPrototypeAcceptance.stages[0].stdout).toEqual("environment-tool owned\n")
      const discoveryEnvironment = {EXPECTED: "owned", PATH: directory}
      const pendingDiscovery = discoverToolchain({
        canonicalCommand: "environment-tool",
        environment: discoveryEnvironment,
        id: "detached-environment",
        override: validExecutable,
        versionArguments: []
      })

      discoveryEnvironment.EXPECTED = "caller-mutated"
      expect((await pendingDiscovery).version).toEqual("environment-tool owned")
      const acceptanceEnvironment = {EXPECTED: "owned", PATH: directory}
      const acceptanceTool = Object.freeze({...tool, executable: validExecutable})
      const pendingAcceptance = runAcceptanceStages({
        artifacts,
        environment: acceptanceEnvironment,
        stages: [{arguments: [], stage: "execute", tool: acceptanceTool}],
        target: "demo"
      })

      acceptanceEnvironment.EXPECTED = "caller-mutated"
      expect((await pendingAcceptance).stages[0].stdout).toEqual("environment-tool owned\n")
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

  it("closes a TERM-resistant version-probe process group and all inherited output pipes", async () => {
    await withTemporaryDirectory("semantifold-version-tree-timeout-", async (directory) => {
      const fixture = await processTreeFixture(directory, "version-tree")
      const startedAt = Date.now()

      try {
        await assert.rejects(() => discoverToolchain({
          canonicalCommand: "node",
          id: "version-tree",
          override: process.execPath,
          timeoutMs: 1_000,
          versionArguments: [ignoreSigtermTreeFixture, "parent", fixture.stateDirectory]
        }), (error) => error instanceof SemantifoldDiagnostic && error.code == "TOOL_VERSION_TIMEOUT" && error.signal == "SIGKILL")
        await assertForcedProcessTreeClosure(fixture, Date.now() - startedAt)
      } finally {
        await terminateProcessTreeIfAlive(fixture)
      }
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
          {arguments: ["restore"], stage: "restore", tool},
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
        "parse", "generate", "restore", "compile", "link", "validate", "instantiate", "execute"
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

  it("reads every consumed acceptance tool field once before validation and execution", async () => {
    await withTemporaryDirectory("semantifold-runner-tool-accessors-", async (directory) => {
      const unexpectedMarker = path.join(directory, "unexpected-executable")
      const expectedExecutable = await fakeExecutable(directory, "expected-accessor-tool", "#!/bin/sh\nprintf 'expected\\n'\n")
      const unexpectedExecutable = await fakeExecutable(directory, "unexpected-accessor-tool", `#!/bin/sh
printf 'unexpected\n' > "${unexpectedMarker}"
printf 'unexpected\n'
`)
      const reads = {executable: 0, id: 0, source: 0, version: 0}
      const tool = {}

      Object.defineProperties(tool, {
        executable: {
          enumerable: true,
          get() {
            reads.executable += 1
            return reads.executable <= 3 ? expectedExecutable : unexpectedExecutable
          }
        },
        id: {
          enumerable: true,
          get() {
            reads.id += 1
            return reads.id == 1 ? "expected-accessor-tool" : 7
          }
        },
        source: {
          enumerable: true,
          get() {
            reads.source += 1
            return reads.source == 1 ? "canonical" : "invalid"
          }
        },
        version: {
          enumerable: true,
          get() {
            reads.version += 1
            return reads.version <= 2 ? "expected-accessor-tool 1" : "unexpected-version"
          }
        }
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
      const result = await runAcceptanceStages({
        artifacts,
        stages: [{arguments: [], stage: "execute", tool: /** @type {any} */ (tool)}],
        target: "demo"
      })

      expect(result.stages[0].stdout).toEqual("expected\n")
      expect(result.stages[0].executable).toEqual(expectedExecutable)
      expect(result.stages[0].version).toEqual("expected-accessor-tool 1")
      expect(reads).toEqual({executable: 1, id: 1, source: 1, version: 1})
      await assert.rejects(access(unexpectedMarker),
        (error) => error instanceof Error && "code" in error && error.code == "ENOENT")
    })
  })

  it("reads each acceptance-stage argument once before validation and execution", async () => {
    await withTemporaryDirectory("semantifold-stage-argument-accessor-", async (directory) => {
      const marker = path.join(directory, "executed-argument")
      const executable = await fakeExecutable(directory, "stage-argument-accessor-tool", `#!/bin/sh
printf '%s\n' "$1" > "$2"
printf '%s\n' "$1"
`)
      const tool = Object.freeze({
        executable,
        id: "stage-argument-accessor-tool",
        source: /** @type {const} */ ("override"),
        version: "stage-argument-accessor-tool 1",
        versionArguments: Object.freeze([])
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
      const stageArguments = ["placeholder", marker]
      let reads = 0

      Object.defineProperty(stageArguments, "0", {
        enumerable: true,
        get() {
          reads += 1
          return reads == 1 ? "validated" : "unvalidated"
        }
      })

      const result = await runAcceptanceStages({
        artifacts,
        stages: [{arguments: stageArguments, stage: "execute", tool}],
        target: "demo"
      })

      expect(reads).toEqual(1)
      expect(await readFile(marker, "utf8")).toEqual("validated\n")
      expect(result.stages[0].arguments).toEqual(["validated", marker])
      expect(result.stages[0].stdout).toEqual("validated\n")
    })
  })

  it("reads each acceptance stage name once before validation and execution", async () => {
    await withTemporaryDirectory("semantifold-stage-name-accessor-", async (directory) => {
      const executable = await fakeExecutable(directory, "stage-name-accessor-tool", "#!/bin/sh\nprintf 'expected\\n'\n")
      const tool = Object.freeze({
        executable,
        id: "stage-name-accessor-tool",
        source: /** @type {const} */ ("override"),
        version: "stage-name-accessor-tool 1",
        versionArguments: Object.freeze([])
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
      const stage = {arguments: [], tool}
      let reads = 0

      Object.defineProperty(stage, "stage", {
        enumerable: true,
        get() {
          reads += 1
          return reads <= 5 ? "execute" : "bogus"
        }
      })

      const result = await runAcceptanceStages({
        artifacts,
        stages: [/** @type {any} */ (stage)],
        target: "demo"
      })

      expect(reads).toEqual(1)
      expect(result.stages[0].stage).toEqual("execute")
      expect(result.stages[0].stdout).toEqual("expected\n")
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
          stages: [{arguments: [], stage: "execute", tool: {...failing, executable: `${failing.executable}\0suffix`}}],
          target: "demo"
        }),
        "INVALID_ACCEPTANCE_RUNNER"
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

  it("closes a TERM-resistant acceptance process group and all inherited output pipes", async () => {
    await withTemporaryDirectory("semantifold-acceptance-tree-timeout-", async (directory) => {
      const fixture = await processTreeFixture(directory, "acceptance-tree")
      const tool = Object.freeze({
        executable: process.execPath,
        id: "acceptance-tree",
        source: /** @type {const} */ ("override"),
        version: process.version,
        versionArguments: Object.freeze([])
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
      const startedAt = Date.now()

      try {
        await assert.rejects(() => runAcceptanceStages({
          artifacts,
          stages: [{
            arguments: [ignoreSigtermTreeFixture, "parent", fixture.stateDirectory],
            stage: "execute",
            tool
          }],
          target: "demo",
          timeoutMs: 1_000
        }), (error) => error instanceof SemantifoldDiagnostic && error.code == "ACCEPTANCE_TIMEOUT" &&
          error.stage == "execute" && error.signal == "SIGKILL")
        await assertForcedProcessTreeClosure(fixture, Date.now() - startedAt)
      } finally {
        await terminateProcessTreeIfAlive(fixture)
      }
    })
  })

  it("settles after closing pipes retained by a TERM-resistant escaped descendant", async () => {
    expect(process.platform).toEqual("linux")
    await withTemporaryDirectory("semantifold-escaped-descendant-", async (directory) => {
      const artifacts = createGeneratedArtifactSet({artifacts: [{
        content: "input\n",
        contentKind: "text",
        mediaType: "text/plain",
        ownership: "generated",
        path: "input.txt",
        provenance: synthetic(),
        role: "entry"
      }], target: "demo"})
      const operations = [
        {
          code: "TOOL_VERSION_TIMEOUT",
          run: (stateDirectory) => discoverToolchain({
            canonicalCommand: "node",
            id: "escaped-version",
            override: process.execPath,
            timeoutMs: 500,
            versionArguments: [escapedProcessGroupFixture, "parent", stateDirectory]
          })
        },
        {
          code: "ACCEPTANCE_TIMEOUT",
          run: (stateDirectory) => runAcceptanceStages({
            artifacts,
            stages: [{
              arguments: [escapedProcessGroupFixture, "parent", stateDirectory],
              stage: "execute",
              tool: Object.freeze({
                executable: process.execPath,
                id: "escaped-acceptance",
                source: /** @type {const} */ ("override"),
                version: process.version,
                versionArguments: Object.freeze([])
              })
            }],
            target: "demo",
            timeoutMs: 500
          })
        }
      ]

      for (const [index, operation] of operations.entries()) {
        const stateDirectory = path.join(directory, `operation-${index}`)
        /** @type {SemantifoldDiagnostic | undefined} */
        let failure
        /** @type {Awaited<ReturnType<typeof escapedLifecycleObservation>> | undefined} */
        let observation
        /** @type {Awaited<ReturnType<typeof terminateEscapedFixture>> | undefined} */
        let cleanup
        const startedAt = Date.now()

        await mkdir(stateDirectory)
        try {
          try {
            await operation.run(stateDirectory)
          } catch (error) {
            if (error instanceof SemantifoldDiagnostic) failure = error
          }
          observation = await escapedLifecycleObservation(stateDirectory, Date.now() - startedAt)
        } finally {
          cleanup = await terminateEscapedFixture(stateDirectory)
        }

        assert.ok(failure)
        expect(failure.code).toEqual(operation.code)
        expect(failure.signal).toEqual("SIGTERM")
        assert.ok(observation)
        expect(observation).toEqual({
          apiSettledWithinBound: true,
          escapedHelperAliveAtSettlement: true,
          escapedHelperRetainedPipeUntilClosed: true,
          escapedIntoDistinctGroup: true,
          originalGroupGone: true,
          parentReceivedTerm: true,
          safetyExitAbsent: true
        })
        expect(cleanup).toEqual({helperReceivedTerm: true, noLiveHelperResidue: true})
      }
    })
  })

  it("defaults acceptance environment and timeout only when they are undefined", async () => {
    await withTemporaryDirectory("semantifold-acceptance-null-boundaries-", async (directory) => {
      const executable = await fakeExecutable(directory, "acceptance-null-tool", "#!/bin/sh\nprintf 'launched\\n' > \"$1\"\n")
      const tool = Object.freeze({
        executable,
        id: "acceptance-null-tool",
        source: /** @type {const} */ ("override"),
        version: "acceptance-null-tool 1",
        versionArguments: Object.freeze([])
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
      const markers = ["environment-null", "environment-entry-null", "timeout-null"].map((name) => path.join(directory, name))
      /** @type {any[]} */
      const configurations = [
        {environment: null},
        {environment: {PATH: null}},
        {timeoutMs: null}
      ]

      for (const [index, configuration] of configurations.entries()) {
        await expectDiagnostic(() => runAcceptanceStages({
          artifacts,
          stages: [{arguments: [markers[index]], stage: "execute", tool}],
          target: "demo",
          ...configuration
        }), "INVALID_ACCEPTANCE_RUNNER")
        await assert.rejects(access(markers[index]), (error) => error instanceof Error && "code" in error && error.code == "ENOENT")
      }
    })
  })

  it("rejects sparse discovery and acceptance arrays before asynchronous work", async () => {
    await withTemporaryDirectory("semantifold-sparse-runner-", async (directory) => {
      const executable = await fakeExecutable(directory, "sparse-tool", "#!/bin/sh\nprintf 'sparse 1\\n'\n")
      const tool = Object.freeze({
        executable,
        id: "sparse-tool",
        source: /** @type {const} */ ("override"),
        version: "sparse 1",
        versionArguments: Object.freeze([])
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
      const sparseVersionArguments = ["--version"]
      const sparseStages = [{arguments: [], stage: /** @type {const} */ ("execute"), tool}]
      const sparseArguments = ["argument"]

      Reflect.deleteProperty(sparseVersionArguments, "0")
      Reflect.deleteProperty(sparseStages, "0")
      Reflect.deleteProperty(sparseArguments, "0")
      const operations = [
        () => discoverToolchain({
          canonicalCommand: "sparse-tool",
          id: "sparse-tool",
          override: executable,
          versionArguments: sparseVersionArguments
        }),
        () => runAcceptanceStages({artifacts, stages: sparseStages, target: "demo"}),
        () => runAcceptanceStages({artifacts, stages: [{arguments: sparseArguments, stage: "execute", tool}], target: "demo"})
      ]
      const expectedCodes = ["INVALID_TOOLCHAIN", "INVALID_ACCEPTANCE_RUNNER", "INVALID_ACCEPTANCE_RUNNER"]
      /** @type {string[]} */
      const outcomes = []

      for (const operation of operations) {
        try {
          await operation()
          outcomes.push("accepted")
        } catch (error) {
          outcomes.push(error instanceof SemantifoldDiagnostic ? error.code : error instanceof Error ? error.name : "non-error")
        }
      }

      expect(outcomes).toEqual(expectedCodes)
    })
  })

  it("validates and executes stages without dispatching to a caller-owned map", async () => {
    await withTemporaryDirectory("semantifold-hostile-stage-map-", async (directory) => {
      const marker = path.join(directory, "executed")
      const executable = await fakeExecutable(directory, "hostile-stage-map-tool", `#!/bin/sh
printf 'executed\n' > "${marker}"
printf 'executed\n'
`)
      const tool = Object.freeze({
        executable,
        id: "hostile-stage-map-tool",
        source: /** @type {const} */ ("override"),
        version: "hostile-stage-map-tool 1",
        versionArguments: Object.freeze([])
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
      const stages = [{arguments: [], stage: /** @type {const} */ ("execute"), tool}]
      let hostileMapCalled = false

      Object.defineProperty(stages, "map", {
        value() {
          hostileMapCalled = true
          return []
        }
      })

      const result = await runAcceptanceStages({artifacts, stages, target: "demo"})

      expect(hostileMapCalled).toBeFalse()
      expect(await readFile(marker, "utf8")).toEqual("executed\n")
      expect(result.stages.length).toEqual(1)
      expect(result.stages[0].stdout).toEqual("executed\n")
    })
  })

  it("preserves a primary stage failure when isolated-directory cleanup also fails", async () => {
    await withTemporaryDirectory("semantifold-runner-cleanup-", async (directory) => {
      const failingExecutable = await fakeExecutable(directory, "cleanup-fail-tool", "#!/bin/sh\nprintf 'primary output\\n'\nprintf 'primary error\\n' >&2\nexit 23\n")
      const successfulExecutable = await fakeExecutable(directory, "cleanup-success-tool", "#!/bin/sh\nprintf 'success\\n'\n")
      const artifacts = createGeneratedArtifactSet({artifacts: [{
        content: "input\n",
        contentKind: "text",
        mediaType: "text/plain",
        ownership: "generated",
        path: "cleanup-review-fixture.txt",
        provenance: synthetic(),
        role: "entry"
      }], target: "demo"})
      /** @type {string[]} */
      const acceptanceDirectories = []
      /** @type {typeof rm} */
      const failingRemove = async (candidate, options) => {
        const ownsCleanupFixture = typeof candidate == "string" && path.basename(candidate).startsWith("semantifold-acceptance-") &&
          await access(path.join(candidate, "cleanup-review-fixture.txt")).then(() => true, () => false)

        if (ownsCleanupFixture) {
          acceptanceDirectories.push(candidate)
          throw new Error("deterministic cleanup failure")
        }

        await rm(candidate, options)
      }
      const runWithFailingCleanup = createAcceptanceRunner({removeDirectory: failingRemove})

      try {
        const failingTool = Object.freeze({
          executable: failingExecutable,
          id: "cleanup-fail",
          source: /** @type {const} */ ("override"),
          version: "cleanup 1",
          versionArguments: Object.freeze([])
        })
        const successfulTool = Object.freeze({
          executable: successfulExecutable,
          id: "cleanup-success",
          source: /** @type {const} */ ("override"),
          version: "cleanup 1",
          versionArguments: Object.freeze([])
        })

        await assert.rejects(
          () => runWithFailingCleanup({artifacts, stages: [{arguments: [], stage: "execute", tool: failingTool}], target: "demo"}),
          (error) => {
            assert.ok(error instanceof SemantifoldDiagnostic)
            expect(error.code).toEqual("ACCEPTANCE_NONZERO_EXIT")
            expect(error.stage).toEqual("execute")
            expect(error.exitCode).toEqual(23)
            expect(error.stdout).toEqual("primary output\n")
            expect(error.stderr).toEqual("primary error\n")
            assert.ok(error.cause instanceof AggregateError)
            expect(error.cause.message).toEqual("Acceptance failed and isolated-directory cleanup also failed.")
            expect(error.cause.errors.length).toEqual(2)
            assert.ok(error.cause.errors[0] instanceof Error)
            assert.ok(error.cause.errors[1] instanceof SemantifoldDiagnostic)
            expect(error.cause.errors[1].code).toEqual("ACCEPTANCE_CLEANUP_FAILURE")
            expect(error.cause.errors[1].cause).toEqual(undefined)
            assert.ok(error.cause.errors[1].detail.length < 256)

            return true
          }
        )
        await expectDiagnostic(
          () => runWithFailingCleanup({artifacts, stages: [{arguments: [], stage: "execute", tool: successfulTool}], target: "demo"}),
          "ACCEPTANCE_CLEANUP_FAILURE"
        )
      } finally {
        await Promise.all(acceptanceDirectories.map(async (acceptanceDirectory) => await rm(acceptanceDirectory, {force: true, recursive: true})))
      }
    })
  })

  it("executes small programs through every original-six and Go real toolchain", async () => {
    const php = await discoverCanonicalToolchain("php")
    const ruby = await discoverCanonicalToolchain("ruby")
    const node = await discoverCanonicalToolchain("node")
    const tsc = await discoverCanonicalToolchain("tsc")
    const javac = await discoverCanonicalToolchain("javac")
    const java = await discoverCanonicalToolchain("java")
    const python = await discoverCanonicalToolchain("python")

    expect(Object.keys(canonicalToolchains)).toEqual(["php", "ruby", "node", "tsc", "javac", "java", "python", "dotnet", "go"])
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
    await runProgram("python", "program.py", "print(\"ok\")\n", [
      {arguments: ["-m", "py_compile", "program.py"], stage: "compile", tool: python},
      {arguments: ["program.py"], stage: "execute", tool: python}
    ], {PATH: process.env.PATH, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1"})
    await withTemporaryDirectory("semantifold-go-toolchain-caches-", async (directory) => {
      const cacheDirectories = ["build", "modules", "gopath", "tmp", "home"]

      await Promise.all(cacheDirectories.map(async (name) => await mkdir(path.join(directory, name), {recursive: true})))
      const environment = {
        CGO_ENABLED: "0",
        GOARCH: "amd64",
        GOCACHE: path.join(directory, "build"),
        GOENV: "off",
        GOMODCACHE: path.join(directory, "modules"),
        GOOS: "linux",
        GOPATH: path.join(directory, "gopath"),
        GOPROXY: "off",
        GOSUMDB: "off",
        GOTOOLCHAIN: "local",
        GOTMPDIR: path.join(directory, "tmp"),
        GOVCS: "off",
        GOWORK: "off",
        HOME: path.join(directory, "home"),
        PATH: process.env.PATH
      }
      const go = await discoverCanonicalToolchain("go", {environment})
      const artifacts = createGeneratedArtifactSet({artifacts: [{
        content: "module example.com/semantifold/acceptance\n\ngo 1.26.0\n",
        contentKind: "text",
        mediaType: "text/plain",
        ownership: "generated",
        path: "go.mod",
        provenance: synthetic(),
        role: "manifest"
      }, {
        content: "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"ok\")\n}\n",
        contentKind: "text",
        mediaType: "text/x-go",
        ownership: "generated",
        path: "main.go",
        provenance: synthetic(),
        role: "entry"
      }], target: "go"})
      const result = await runAcceptanceStages({artifacts, environment, stages: [
        {arguments: ["build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags=-buildid=", "-o", "semantifold-go", "."], stage: "compile", tool: go},
        {arguments: ["vet", "-mod=readonly", "."], stage: "validate", tool: go},
        {arguments: ["run", "-mod=readonly", "-trimpath", "-buildvcs=false", "."], stage: "execute", tool: go}
      ], target: "go", timeoutMs: 20_000})

      expect(result.stages.at(-1).stdout).toEqual("ok\n")
    })
  })
})

/** @param {string} target @param {string} filePath @param {string} content @param {any[]} stages @param {Record<string, string | undefined>} [environment] */
async function runProgram(target, filePath, content, stages, environment) {
  const artifacts = createGeneratedArtifactSet({artifacts: [{
    content,
    contentKind: "text",
    mediaType: "text/plain",
    ownership: "generated",
    path: filePath,
    provenance: synthetic(),
    role: "entry"
  }], target})
  const result = await runAcceptanceStages({artifacts, environment, stages, target, timeoutMs: 20_000})

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

/**
 * Creates evidence storage for a parent/grandchild process-group fixture.
 * @param {string} directory - Test-owned temporary directory.
 * @param {string} name - Fixture directory name.
 * @returns {Promise<{stateDirectory: string}>} Fixture state.
 */
async function processTreeFixture(directory, name) {
  const stateDirectory = path.join(directory, name)

  await mkdir(stateDirectory)

  return {stateDirectory}
}

/**
 * Proves both TERM-resistant processes closed before either safety exit.
 * @param {{stateDirectory: string}} fixture - Process-tree evidence.
 * @param {number} elapsedMs - Complete API duration.
 * @returns {Promise<void>}
 */
async function assertForcedProcessTreeClosure(fixture, elapsedMs) {
  const parentPid = await recordedPid(fixture, "parent")
  const grandchildPid = await recordedPid(fixture, "grandchild")

  assert.ok(elapsedMs < 3_000, `Process-tree timeout took ${elapsedMs}ms.`)
  expect(await readFile(path.join(fixture.stateDirectory, "ready"), "utf8")).toEqual("parent and grandchild ready\n")
  expect(await readFile(path.join(fixture.stateDirectory, "parent.term"), "utf8")).toEqual("SIGTERM\n")
  expect(await readFile(path.join(fixture.stateDirectory, "grandchild.term"), "utf8")).toEqual("SIGTERM\n")
  for (const name of ["parent.safety", "grandchild.safety"]) {
    await assert.rejects(access(path.join(fixture.stateDirectory, name)),
      (error) => error instanceof Error && "code" in error && error.code == "ENOENT")
  }
  await assertProcessNotAlive(parentPid)
  await assertProcessNotAlive(grandchildPid)
}

/**
 * Guarantees fixture cleanup when the lifecycle or an assertion fails.
 * @param {{stateDirectory: string}} fixture - Process-tree evidence.
 * @returns {Promise<void>}
 */
async function terminateProcessTreeIfAlive(fixture) {
  const parentPid = await recordedPid(fixture, "parent", false)
  const grandchildPid = await recordedPid(fixture, "grandchild", false)

  if (grandchildPid != undefined) killIfAlive(grandchildPid)
  if (parentPid != undefined) killIfAlive(parentPid)
}

/**
 * Reads one fixture PID.
 * @param {{stateDirectory: string}} fixture - Process-tree evidence.
 * @param {"parent" | "grandchild"} name - Process name.
 * @param {boolean} [required] - Whether missing evidence fails.
 * @returns {Promise<number | undefined>} Recorded PID.
 */
async function recordedPid(fixture, name, required = true) {
  try {
    return Number.parseInt(await readFile(path.join(fixture.stateDirectory, `${name}.pid`), "utf8"), 10)
  } catch (error) {
    if (!required && error instanceof Error && "code" in error && error.code == "ENOENT") return undefined
    throw error
  }
}

/** @param {number} pid Process or negative process-group identity. @param {"SIGKILL" | "SIGTERM"} [signal] Signal to send. */
function killIfAlive(pid, signal = "SIGKILL") {
  try {
    process.kill(pid, signal)
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code == "ESRCH")) throw error
  }
}

/** @param {number} pid Exact recorded process identity. */
async function assertProcessNotAlive(pid) {
  try {
    process.kill(pid, 0)
  } catch (error) {
    assert.ok(error instanceof Error && "code" in error && error.code == "ESRCH")
    return
  }

  if (process.platform != "linux") assert.fail(`Process ${pid} remains signalable after process-group closure.`)
  const fields = (await readFile(`/proc/${pid}/stat`, "utf8")).split(" ")

  expect(fields[2]).toEqual("Z")
}

/**
 * Captures independently observable lifecycle states after API settlement.
 * @param {string} stateDirectory - Fixture evidence directory.
 * @param {number} elapsedMs - Invocation-to-settlement duration.
 * @returns {Promise<{
 *   apiSettledWithinBound: boolean,
 *   escapedHelperAliveAtSettlement: boolean,
 *   escapedHelperRetainedPipeUntilClosed: boolean,
 *   escapedIntoDistinctGroup: boolean,
 *   originalGroupGone: boolean,
 *   parentReceivedTerm: boolean,
 *   safetyExitAbsent: boolean
 * }>} Lifecycle evidence.
 */
async function escapedLifecycleObservation(stateDirectory, elapsedMs) {
  const parent = await processIdentity(stateDirectory, "parent")
  const helper = await processIdentity(stateDirectory, "helper")
  const pipeClosed = await evidenceAppears(path.join(stateDirectory, "pipe.closed"), 500)
  const helperState = (await linuxProcessIdentity(helper.pid))?.state

  return {
    apiSettledWithinBound: elapsedMs < 2_000,
    escapedHelperAliveAtSettlement: helperState != undefined && helperState != "Z",
    escapedHelperRetainedPipeUntilClosed: pipeClosed,
    escapedIntoDistinctGroup: helper.processGroupId != parent.processGroupId && helper.sessionId != parent.sessionId,
    originalGroupGone: !processGroupExists(parent.processGroupId),
    parentReceivedTerm: await evidenceAppears(path.join(stateDirectory, "parent.term"), 0),
    safetyExitAbsent: !await evidenceAppears(path.join(stateDirectory, "helper.safety"), 0)
  }
}

/**
 * Terminates the exact recorded escaped helper and proves no executable process remains.
 * @param {string} stateDirectory - Fixture evidence directory.
 * @returns {Promise<{helperReceivedTerm: boolean, noLiveHelperResidue: boolean}>} Cleanup evidence.
 */
async function terminateEscapedFixture(stateDirectory) {
  const helper = await processIdentity(stateDirectory, "helper", false)

  if (helper == undefined) return {helperReceivedTerm: false, noLiveHelperResidue: true}
  if (await signalRecordedProcess(helper, "SIGTERM")) {
    await evidenceAppears(path.join(stateDirectory, "helper.term"), 500)
    await signalRecordedProcess(helper, "SIGKILL")
  }
  const noLiveHelperResidue = await waitForNoLiveLinuxProcess(helper, 500)

  return {
    helperReceivedTerm: await evidenceAppears(path.join(stateDirectory, "helper.term"), 0),
    noLiveHelperResidue
  }
}

/**
 * Observes termination of one exact PID after cleanup has sent its final signal.
 * @param {{pid: number, startTime: string}} identity - Exact recorded helper identity.
 * @param {number} timeoutMs - Maximum cleanup observation duration.
 * @returns {Promise<boolean>} Whether no live process retains the recorded identity.
 */
async function waitForNoLiveLinuxProcess(identity, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let current = await linuxProcessIdentity(identity.pid)

  while (sameProcess(identity, current) && current.state != "Z" && Date.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve))
    current = await linuxProcessIdentity(identity.pid)
  }

  return !sameProcess(identity, current) || current.state == "Z"
}

/**
 * Reads one recorded Linux process identity.
 * @param {string} stateDirectory - Fixture evidence directory.
 * @param {"helper" | "parent"} name - Fixture process name.
 * @param {boolean} [required] - Whether absent evidence fails.
 * @returns {Promise<{pid: number, processGroupId: number, sessionId: number, startTime: string} | undefined>} Recorded identity.
 */
async function processIdentity(stateDirectory, name, required = true) {
  try {
    return JSON.parse(await readFile(path.join(stateDirectory, `${name}.identity`), "utf8"))
  } catch (error) {
    if (!required && error instanceof Error && "code" in error && error.code == "ENOENT") return undefined
    throw error
  }
}

/** @param {number} pid Exact Linux process identity. */
async function linuxProcessIdentity(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8")
    return {...linuxIdentityFromStat(stat), state: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0]}
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code == "ENOENT") return undefined
    throw error
  }
}

/** @param {string} stat Linux `/proc/PID/stat` content. */
function linuxIdentityFromStat(stat) {
  const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(" ")

  return {
    pid: Number.parseInt(stat, 10),
    processGroupId: Number(fields[2]),
    sessionId: Number(fields[3]),
    startTime: fields[19]
  }
}

/**
 * Signals a PID only while its Linux start-time identity still matches the fixture record.
 * @param {{pid: number, startTime: string}} identity - Recorded process identity.
 * @param {"SIGKILL" | "SIGTERM"} signal - Cleanup signal.
 * @returns {Promise<boolean>} Whether the exact live identity was signaled.
 */
async function signalRecordedProcess(identity, signal) {
  const current = await linuxProcessIdentity(identity.pid)

  if (!sameProcess(identity, current) || current.state == "Z") return false
  process.kill(identity.pid, signal)

  return true
}

/**
 * Checks a PID plus Linux start-time identity without relying on PID uniqueness.
 * @param {{startTime: string}} expected - Recorded identity.
 * @param {{startTime: string} | undefined} current - Current `/proc` identity.
 */
function sameProcess(expected, current) {
  return current != undefined && current.startTime == expected.startTime
}

/** @param {number} processGroupId Exact recorded process-group identity. */
function processGroupExists(processGroupId) {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code == "ESRCH") return false
    throw error
  }
}

/**
 * Waits for one exact evidence-file creation without polling.
 * @param {string} filename - Exact evidence path.
 * @param {number} timeoutMs - Bounded event wait; zero checks current state only.
 * @returns {Promise<boolean>} Whether evidence exists.
 */
async function evidenceAppears(filename, timeoutMs) {
  try {
    await access(filename)
    return true
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code == "ENOENT")) throw error
  }
  if (timeoutMs == 0) return false

  return await new Promise((resolve, reject) => {
    const basename = path.basename(filename)
    let settled = false
    const watcher = watch(path.dirname(filename), (_, changed) => {
      if (changed == basename) finish(true)
    })
    const timer = setTimeout(() => finish(false), timeoutMs)

    watcher.once("error", (error) => finish(false, error))

    /** @param {boolean} found @param {Error} [error] */
    function finish(found, error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      watcher.close()
      if (error) reject(error)
      else resolve(found)
    }

    void access(filename).then(() => finish(true), (error) => {
      if (!(error instanceof Error && "code" in error && error.code == "ENOENT")) finish(false, error)
    })
  })
}
