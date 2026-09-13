// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {
  createCapabilityAuthority, generate, generateProgramArtifactSet, parse, parseProgram, SemantifoldDiagnostic
} from "../index.js"
import {task034AuthorityInput} from "./support/task034-authority.js"

const probeIdentity = "semantifold.task034.resource-probe"

const usedSource = `const resource: ProbeResource = probeAcquire(false)
try {
  const line: string | null = probeRead(resource, false)
  probeClose(resource, false)
} catch (error) {
  if (!(error instanceof ProbeReadFailure)) { throw error }
  probeClose(resource, false)
}
`

describe("stdlib provider linking artifacts", () => {
  it("links the used probe operations through a support provider artifact with truthful metadata", () => {
    const program = parseProgram({
      capabilityAuthority: createCapabilityAuthority(task034AuthorityInput()),
      entryModule: "main",
      sources: [{filename: "main.ts", id: "main", language: "typescript", source: usedSource}]
    })
    const set = generateProgramArtifactSet({language: "typescript", program})
    const providerPath = "providers/typescript/semantifold/task034/resource-probe.ts"

    expect(set.target).toEqual("typescript")
    expect(set.entry).toEqual("main.ts")
    const provider = set.artifacts.find(({path}) => path == providerPath)

    expect(provider.contentKind).toEqual("text")
    expect(provider.mediaType).toEqual("text/typescript")
    expect(provider.ownership).toEqual("generated")
    expect(provider.role).toEqual("support")
    expect(provider.provenance).toMatchObject({
      kind: "synthetic",
      reason: `semantifold-stdlib-provider:semantifold.provider.typescript.${probeIdentity}`
    })
    const entry = set.artifacts.find(({path}) => path == "main.ts")

    expect(entry.content).toContain('__semantifold_provider_typescript_probeAcquire(false)')
    expect(entry.content).toContain('__semantifold_provider_typescript_probeRead(resource, false)')
    expect(entry.content).toContain('__semantifold_provider_typescript_probeClose(resource, false)')
    expect(entry.content).toContain('} from "./providers/typescript/semantifold/task034/resource-probe.js"')
    expect(entry.content).not.toContain("__semantifold_provider_typescript_probeEffect")
    expect(entry.content).not.toContain("__semantifold_provider_typescript_probeTrace")
    expect(provider.content).toContain("function __semantifold_provider_typescript_probeAcquire")
    expect(provider.content).toContain("class ProbeResource")
    expect(provider.content).toContain("class ProbeResourceClosed")
    expect(provider.content).not.toContain("__semantifold_provider_typescript_probeEffect")
    expect(provider.content).not.toContain("__semantifold_provider_typescript_probeTrace")
    expect(provider.content).not.toContain("ProbeOperationFailure")

    expect(set.metadata).toEqual({
      modules: [{identity: probeIdentity, operations: ["probeAcquire", "probeRead", "probeClose"], version: "1.0.0"}],
      providers: [{
        artifact: {mediaType: "text/typescript", path: providerPath},
        dependencies: [],
        identity: `semantifold.provider.typescript.${probeIdentity}`,
        module: probeIdentity,
        nativeEntries: {
          probeAcquire: "__semantifold_provider_typescript_probeAcquire",
          probeClose: "__semantifold_provider_typescript_probeClose",
          probeRead: "__semantifold_provider_typescript_probeRead"
        },
        operations: ["probeAcquire", "probeRead", "probeClose"],
        target: "typescript",
        version: "1.0.0"
      }],
      schema: "SemantifoldStdlibLink",
      version: 1
    })
  })

  it("omits the provider artifact and metadata when no probe operation is used", () => {
    const plain = parseProgram({
      entryModule: "main",
      sources: [{filename: "main.ts", id: "main", language: "typescript", source: "console.log('plain')\n"}]
    })
    const plainSet = generateProgramArtifactSet({language: "typescript", program: plain})

    expect(plainSet.artifacts.some(({path}) => path.startsWith("providers/"))).toBe(false)
    expect(plainSet.metadata).toBe(undefined)

    const idle = parseProgram({
      capabilityAuthority: createCapabilityAuthority(task034AuthorityInput()),
      entryModule: "main",
      sources: [{filename: "main.ts", id: "main", language: "typescript", source: "console.log('idle')\n"}]
    })
    const idleSet = generateProgramArtifactSet({language: "typescript", program: idle})

    expect(idle.stdlibContract).toEqual({identity: probeIdentity})
    expect(idleSet.artifacts.some(({path}) => path.startsWith("providers/"))).toBe(false)
    expect(idleSet.metadata).toBe(undefined)
  })

  it("fails deterministically when a module identity collides with a provider path", () => {
    assert.throws(
      () => generateProgramArtifactSet({
        language: "php",
        program: parseProgram({
          capabilityAuthority: createCapabilityAuthority(task034AuthorityInput()),
          entryModule: "providers.php.semantifold.task034.resource-probe",
          sources: [{
            filename: "resource-probe.php",
            id: "providers.php.semantifold.task034.resource-probe",
            language: "php",
            source: "<?php\nnamespace App\\Probe;\necho probeTrace(), PHP_EOL;\n"
          }]
        })
      }),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_NAME_COLLISION"
    )
  })

  it("keeps linked generation byte-stable across repeated parses and generations", () => {
    const build = () => generateProgramArtifactSet({
      language: "php",
      program: parseProgram({
        capabilityAuthority: createCapabilityAuthority(task034AuthorityInput()),
        entryModule: "main",
        sources: [{filename: "main.php", id: "main", language: "php", source: usedPhpSource}]
      })
    })

    assert.deepEqual(build(), build())
  })

  it("fails before emission on capability and contract descriptor mismatches", () => {
    const plain = parseProgram({
      entryModule: "main",
      sources: [{filename: "main.php", id: "main", language: "php", source: "<?php\nnamespace App\\Main;\necho 'plain', PHP_EOL;\n"}]
    })

    plain.modules[0].capabilities = createCapabilityAuthority(task034AuthorityInput()).capabilities
    assert.throws(
      () => generateProgramArtifactSet({language: "php", program: plain}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "UNSUPPORTED_CAPABILITY"
    )

    const linked = parseProgram({
      capabilityAuthority: createCapabilityAuthority(task034AuthorityInput()),
      entryModule: "main",
      sources: [{filename: "main.php", id: "main", language: "php", source: usedPhpSource}]
    })

    linked.stdlibContract.identity = "semantifold.task034.forged"
    assert.throws(
      () => generateProgramArtifactSet({language: "php", program: linked}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_LINK_FAILURE"
    )
  })

  it("keeps provider support byte-identical to the single-module support carrier", () => {
    const phpSource = `<?php
function run(): void {
    $first = probeAcquire(false);
    try {
        /** @var ?string $line */
        $line = probeRead($first, false);
        probeClose($first, false);
    } catch (ProbeReadFailure $error) {
        probeClose($first, false);
    }
    echo probeEffect("parity", 1, false), PHP_EOL;
    echo probeTrace(), PHP_EOL;
}
run();
`
    const phpProgramSource = phpSource.replace(/^<\?php\n/u, `<?php
namespace App\\Parity;
`)
    const cases = [
      {extension: "php", filename: "parity.php", language: "php", programSource: phpProgramSource, source: phpSource},
      {extension: "ts", filename: "parity.ts", language: "typescript", programSource: allOpsSource, source: allOpsSource}
    ]

    for (const {language, filename, extension, source, programSource} of cases) {
      const authority = createCapabilityAuthority(task034AuthorityInput())
      const singleCode = generate({language, module: parse({capabilityAuthority: authority, filename, language, source})})
      const start = "/* semantifold-task034-support */"
      const end = "/* semantifold-task034-support-end */"
      const blob = singleCode.slice(singleCode.indexOf(start), singleCode.indexOf(end) + end.length)

      const program = parseProgram({
        capabilityAuthority: authority,
        entryModule: "main",
        sources: [{filename: `main.${extension}`, id: "main", language, source: programSource}]
      })
      const provider = generateProgramArtifactSet({language, program}).artifacts
        .find(({path}) => path == `providers/${language}/semantifold/task034/resource-probe.${extension}`)

      assert.ok(typeof provider.content == "string" && provider.content.includes(blob),
        `${language} provider must carry the exact support carrier`)
    }
  })
})

const allOpsSource = `function run(): void {
  const first: ProbeResource = probeAcquire(false)
  try {
    const line: string | null = probeRead(first, false)
    probeClose(first, false)
  } catch (error) {
    if (!(error instanceof ProbeReadFailure)) { throw error }
    probeClose(first, false)
  }
  console.log(probeEffect("parity", 1, false))
  console.log(probeTrace())
}
run()
`

const usedPhpSource = `<?php
namespace App\\Main;
$first = probeAcquire(false);
try {
    /** @var ?string $line */
    $line = probeRead($first, false);
    probeClose($first, false);
} catch (ProbeReadFailure $error) {
    probeClose($first, false);
}
`
