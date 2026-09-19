// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {
  createGeneratedArtifactSet,
  generateArtifactSet,
  GeneratedArtifactPublisher,
  parse,
  SemantifoldDiagnostic
} from "../index.js"
import {
  injectPublicationFailure,
  isCanonicalAbsolutePathForPath,
  observePublicationFilesystem
} from "../src/publication.js"

const synthetic = (reason = "publication fixture") => ({kind: "synthetic", reason, relatedOrigins: []})

/**
 * Creates a small already-validated artifact set.
 * @param {string} target - Backend target identity.
 * @param {{content: string, mediaType?: string, path: string, role?: import("../src/semantic/types.js").GeneratedArtifactRole}[]} artifacts - Ordered files.
 * @param {Readonly<Record<string, unknown>>} [metadata] - Optional target metadata.
 * @returns {import("../src/semantic/types.js").GeneratedArtifactSet} Validated set.
 */
function artifactSet(target, artifacts, metadata) {
  return createGeneratedArtifactSet({
    artifacts: artifacts.map(({content, mediaType = "text/plain", path: artifactPath, role = "support"}, index) => ({
      content,
      contentKind: /** @type {const} */ ("text"),
      mediaType,
      ownership: /** @type {const} */ ("generated"),
      path: artifactPath,
      provenance: synthetic(),
      role: index == 0 ? /** @type {const} */ ("entry") : role
    })),
    ...(metadata === undefined ? {} : {metadata}),
    target
  })
}

/**
 * Creates an isolated source and publication layout.
 * @returns {Promise<{publicationRoot: string, root: string, sourceRoot: string}>} Temporary paths.
 */
async function temporaryLayout() {
  const root = await mkdtemp(path.join(tmpdir(), "semantifold-task038-"))
  const sourceRoot = path.join(root, "sources")

  await mkdir(sourceRoot)

  return {publicationRoot: path.join(root, "published"), root, sourceRoot}
}

describe("transactional generated-artifact publication", () => {
  it("publishes complete multi-target source/build snapshots and omits stale files only by switching generations", async () => {
    const {publicationRoot, root, sourceRoot} = await temporaryLayout()
    const unownedOutside = path.join(root, "caller-owned.txt")
    const publisher = new GeneratedArtifactPublisher({
      projectId: "demo-project",
      projectRoot: root,
      publicationRoot,
      sourceRoots: [sourceRoot]
    })

    await writeFile(unownedOutside, "caller bytes\n")

    try {
      const first = await publisher.publish({
        generationId: "cycle-001",
        targets: [
          {
            artifactSet: artifactSet("java", [
              {content: "class Main {}\n", mediaType: "text/x-java-source", path: "Main.java"},
              {content: "stale\n", path: "stale.txt"}
            ], {release: 25}),
            buildProjection: "targets/java/build",
            id: "java-main",
            role: "text",
            sourceProjection: "targets/java/source",
            validators: [async ({buildPath, sourcePath, targetId}) => {
              expect(targetId).toEqual("java-main")
              expect(sourcePath).toEqual(path.join(firstGenerationPath(publicationRoot), "targets/java/source"))
              expect(buildPath).toEqual(path.join(firstGenerationPath(publicationRoot), "targets/java/build"))
              await writeFile(path.join(buildPath, "Main.class"), new Uint8Array([202, 254, 186, 190]))

              return [{mediaType: "application/java-vm", path: "Main.class", role: "compiler-output"}]
            }]
          },
          {
            artifactSet: artifactSet("javascript", [
              {content: "console.log('ready')\n", mediaType: "text/javascript", path: "app.js"}
            ]),
            buildProjection: "targets/javascript/build",
            id: "browser",
            role: "text",
            sourceProjection: "targets/javascript/source"
          }
        ]
      })
      const firstResolved = await publisher.resolveActive()

      expect(firstResolved.generationId).toEqual("cycle-001")
      expect(firstResolved.generationPath).toEqual(first.generationPath)
      expect(firstResolved.manifest.targets.map(({id, role}) => ({id, role}))).toEqual([
        {id: "java-main", role: "text"},
        {id: "browser", role: "text"}
      ])
      expect(firstResolved.targets.map(({id, role}) => ({id, role}))).toEqual([
        {id: "java-main", role: "text"},
        {id: "browser", role: "text"}
      ])
      expect(firstResolved.manifest.targets[0].artifacts.map(({path: artifactPath}) => artifactPath))
        .toEqual(["Main.java", "stale.txt"])
      expect(firstResolved.manifest.targets[0].artifacts[0].provenance).toEqual(synthetic())
      expect(firstResolved.manifest.targets[0].metadata).toEqual({release: 25})
      expect(firstResolved.manifest.targets[0].buildArtifacts).toEqual([{
        byteLength: 4,
        hash: {algorithm: "sha256", value: "65ab12a8ff3263fbc257e5ddf0aa563c64573d0bab1f1115b9b107834cfa6971"},
        mediaType: "application/java-vm",
        path: "Main.class",
        role: "compiler-output"
      }])
      expect(await readFile(path.join(firstResolved.targets[0].sourcePath, "Main.java"), "utf8"))
        .toEqual("class Main {}\n")
      assert.deepEqual(await readFile(path.join(firstResolved.targets[0].buildPath, "Main.class")),
        Buffer.from([202, 254, 186, 190]))

      await writeFile(path.join(publicationRoot, "caller-owned.txt"), "inside but unowned\n")
      const second = await publisher.publish({
        generationId: "cycle-002",
        targets: [{
          artifactSet: artifactSet("java", [{content: "class Main { int value = 2; }\n", mediaType: "text/x-java-source", path: "Main.java"}]),
          buildProjection: "targets/java/build",
          id: "java-main",
          role: "text",
          sourceProjection: "targets/java/source"
        }]
      })
      const secondResolved = await publisher.resolveActive()

      expect(secondResolved.generationId).toEqual("cycle-002")
      expect(secondResolved.generationPath).toEqual(second.generationPath)
      expect(await readFile(path.join(secondResolved.targets[0].sourcePath, "Main.java"), "utf8"))
        .toEqual("class Main { int value = 2; }\n")
      await assert.rejects(readFile(path.join(secondResolved.targets[0].sourcePath, "stale.txt")), {code: "ENOENT"})
      expect(await readFile(path.join(firstResolved.targets[0].sourcePath, "stale.txt"), "utf8")).toEqual("stale\n")
      expect(await readFile(path.join(publicationRoot, "caller-owned.txt"), "utf8")).toEqual("inside but unowned\n")
      expect(await readFile(unownedOutside, "utf8")).toEqual("caller bytes\n")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("keeps every pointer-once reader wholly within one old or new immutable generation", async () => {
    const {publicationRoot, root, sourceRoot} = await temporaryLayout()
    const publisher = new GeneratedArtifactPublisher({projectId: "reader-project", projectRoot: root, publicationRoot, sourceRoots: [sourceRoot]})

    try {
      await publisher.publish(publicationRequest("old", "old source\n", "old build\n"))
      /** @type {(() => void) | undefined} */
      let releaseValidator
      const validatorReached = new Promise(resolve => {
        releaseValidator = resolve
      })
      const update = publisher.publish(publicationRequest("new", "new source\n", "new build\n", async () => {
        await validatorReached
      }))
      const observed = []

      for (let index = 0; index < 30; index += 1) {
        const snapshot = await publisher.resolveActive()

        observed.push(await readPair(snapshot))
      }
      assert.ok(releaseValidator)
      releaseValidator()
      await update
      for (let index = 0; index < 30; index += 1) {
        const snapshot = await publisher.resolveActive()

        observed.push(await readPair(snapshot))
      }

      expect(observed.every(value => value == "old source\n|old build\n" || value == "new source\n|new build\n")).toBeTrue()
      expect(observed).toContain("old source\n|old build\n")
      expect(observed).toContain("new source\n|new build\n")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("writes deterministic manifests apart from the explicit generation identity", async () => {
    const {publicationRoot, root, sourceRoot} = await temporaryLayout()
    const publisher = new GeneratedArtifactPublisher({projectId: "stable-project", projectRoot: root, publicationRoot, sourceRoots: [sourceRoot]})

    try {
      const first = await publisher.publish(publicationRequest("repeat-a", "same source\n", "same build\n"))
      const second = await publisher.publish(publicationRequest("repeat-b", "same source\n", "same build\n"))
      const firstManifest = JSON.parse(await readFile(first.manifestPath, "utf8"))
      const secondManifest = JSON.parse(await readFile(second.manifestPath, "utf8"))

      firstManifest.generationId = "explicit-generation"
      secondManifest.generationId = "explicit-generation"
      expect(firstManifest).toEqual(secondManifest)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("persists rich mappings and revalidates their staged-byte references on pointer resolution", async () => {
    const {publicationRoot, root, sourceRoot} = await temporaryLayout()
    const publisher = new GeneratedArtifactPublisher({projectId: "mapping-project", projectRoot: root, publicationRoot, sourceRoots: [sourceRoot]})
    const module = parse({
      filename: "source.ts",
      language: "typescript",
      source: "function value(): number { return 7; } console.log(value());\n"
    })
    const mapped = generateArtifactSet({language: "javascript", module})

    try {
      const published = await publisher.publish({
        generationId: "mapped",
        targets: [{
          artifactSet: mapped,
          buildProjection: "javascript/build",
          id: "javascript-main",
          role: "text",
          sourceProjection: "javascript/source"
        }]
      })
      const resolved = await publisher.resolveActive()
      const provenance = resolved.manifest.targets[0].artifacts[0].provenance

      expect(provenance.kind).toEqual("text")
      if (provenance.kind != "text") throw new Error("Expected text provenance.")
      expect(provenance.mapping.generated.content).toEqual(await readFile(path.join(published.targets[0].sourcePath, mapped.entry), "utf8"))

      const manifest = JSON.parse(await readFile(published.manifestPath, "utf8"))

      manifest.targets[0].artifacts[0].provenance.mapping.generated.filename = "different.js"
      const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
      const pointerPath = path.join(publicationRoot, "active-generation.json")
      const pointer = JSON.parse(await readFile(pointerPath, "utf8"))

      pointer.manifestHash = createHash("sha256").update(manifestBytes).digest("hex")
      await writeFile(published.manifestPath, manifestBytes)
      await writeFile(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`)
      await assert.rejects(publisher.resolveActive(), diagnostic("MALFORMED_GENERATION_MANIFEST"))
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("rejects malformed identities, roots, projections, and portable collisions before staging", async () => {
    const {publicationRoot, root, sourceRoot} = await temporaryLayout()

    try {
      assert.throws(() => new GeneratedArtifactPublisher(/** @type {never} */ (null)), diagnostic("INVALID_PUBLICATION_REQUEST"))
      assert.throws(() => new GeneratedArtifactPublisher(/** @type {never} */ ({
        projectId: "demo",
        publicationRoot,
        sourceRoots: [sourceRoot]
      })), diagnostic("INVALID_PUBLICATION_ROOT"))
      assert.throws(() => new GeneratedArtifactPublisher({
        projectId: "Demo",
        projectRoot: root,
        publicationRoot,
        sourceRoots: [sourceRoot]
      }), diagnostic("INVALID_PUBLICATION_REQUEST"))
      assert.throws(() => new GeneratedArtifactPublisher({
        projectId: "demo",
        projectRoot: root,
        publicationRoot: path.join(sourceRoot, "published"),
        sourceRoots: [sourceRoot]
      }), diagnostic("PUBLICATION_SOURCE_OVERLAP"))
      assert.throws(() => new GeneratedArtifactPublisher({
        projectId: "demo",
        projectRoot: root,
        publicationRoot: path.join(path.dirname(root), "outside-publication"),
        sourceRoots: [sourceRoot]
      }), diagnostic("INVALID_PUBLICATION_ROOT"))
      assert.throws(() => new GeneratedArtifactPublisher({
        projectId: "demo",
        projectRoot: root,
        publicationRoot,
        sourceRoots: [path.join(path.dirname(root), "outside-source")]
      }), diagnostic("INVALID_PUBLICATION_ROOT"))
      for (const invalidRoot of ["relative/output", `${publicationRoot}${path.sep}`, `${root}${path.sep}part${path.sep}..${path.sep}published`]) {
        assert.throws(() => new GeneratedArtifactPublisher({
          projectId: "demo",
          projectRoot: root,
          publicationRoot: invalidRoot,
          sourceRoots: [sourceRoot]
        }), diagnostic("INVALID_PUBLICATION_ROOT"))
      }

      const publisher = new GeneratedArtifactPublisher({projectId: "demo", projectRoot: root, publicationRoot, sourceRoots: [sourceRoot]})
      const validTarget = {
        artifactSet: artifactSet("demo", [{content: "ok\n", path: "main.txt"}]),
        buildProjection: "target/build",
        id: "demo-target",
        role: "text",
        sourceProjection: "target/source"
      }
      const invalidRequests = [
        {code: "INVALID_PUBLICATION_REQUEST", request: {generationId: "../escape", targets: [validTarget]}},
        {code: "INVALID_PUBLICATION_REQUEST", request: {generationId: "empty", targets: []}},
        {
          code: "INVALID_PUBLICATION_REQUEST",
          request: {generationId: "missing-role", targets: [{...validTarget, role: undefined}]}
        },
        {
          code: "INVALID_PUBLICATION_REQUEST",
          request: {generationId: "invalid-role", targets: [{...validTarget, role: "compiler"}]}
        },
        {
          code: "PUBLICATION_PATH_COLLISION",
          request: {generationId: "duplicate", targets: [validTarget, validTarget]}
        },
        {
          code: "PUBLICATION_PROJECTION_OVERLAP",
          request: {
            generationId: "nested",
            targets: [{...validTarget, buildProjection: "target/source/build"}]
          }
        },
        {
          code: "INVALID_PUBLICATION_PROJECTION",
          request: {
            generationId: "separator-alias",
            targets: [{...validTarget, sourceProjection: "target\\source"}]
          }
        },
        {
          code: "INVALID_PUBLICATION_PROJECTION",
          request: {
            generationId: "reserved-manifest",
            targets: [{...validTarget, sourceProjection: "manifest.json/source"}]
          }
        },
        {
          code: "PUBLICATION_PATH_COLLISION",
          request: {
            generationId: "case-fold",
            targets: [{
              ...validTarget,
              artifactSet: artifactSet("demo", [
                {content: "first\n", path: "Main.txt"},
                {content: "second\n", path: "main.txt"}
              ])
            }]
          }
        }
      ]

      for (const {code, request} of invalidRequests) {
        await assert.rejects(publisher.publish(/** @type {import("../src/semantic/types.js").PublicationRequest} */ (request)), diagnostic(code))
      }
      await assert.rejects(readFile(publicationRoot), {code: "ENOENT"})
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("uses canonical native absolute-path rules without rejecting the host separator", () => {
    expect(isCanonicalAbsolutePathForPath("/workspace/project/output", path.posix)).toBeTrue()
    expect(isCanonicalAbsolutePathForPath("/workspace/project\\output", path.posix)).toBeFalse()
    expect(isCanonicalAbsolutePathForPath("C:\\workspace\\project\\output", path.win32)).toBeTrue()
    expect(isCanonicalAbsolutePathForPath("C:/workspace/project/output", path.win32)).toBeFalse()
    expect(isCanonicalAbsolutePathForPath("C:\\workspace\\project\\..\\output", path.win32)).toBeFalse()
  })

  it("snapshots request identities and projections exactly once before filesystem use", async () => {
    const {publicationRoot, root, sourceRoot} = await temporaryLayout()
    const publisher = new GeneratedArtifactPublisher({projectId: "snapshot-project", projectRoot: root, publicationRoot, sourceRoots: [sourceRoot]})
    let generationReads = 0
    let projectionReads = 0
    const target = {
      artifactSet: artifactSet("demo", [{content: "stable\n", path: "program.txt"}]),
      buildProjection: "target/build",
      id: "demo-target",
      role: "text"
    }

    Object.defineProperty(target, "sourceProjection", {
      enumerable: true,
      get() {
        projectionReads += 1
        return projectionReads == 1 ? "target/source" : "redirected/source"
      }
    })
    const request = {targets: [target]}

    Object.defineProperty(request, "generationId", {
      enumerable: true,
      get() {
        generationReads += 1
        return generationReads == 1 ? "snapshotted" : "alternate"
      }
    })

    try {
      const published = await publisher.publish(/** @type {import("../src/semantic/types.js").PublicationRequest} */ (request))

      expect(generationReads).toEqual(1)
      expect(projectionReads).toEqual(1)
      expect(published.generationId).toEqual("snapshotted")
      expect(published.targets[0].sourcePath).toEqual(path.join(publicationRoot, "generations/snapshotted/target/source"))
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("rejects symlink traversal and candidate tampering without changing the prior generation", async () => {
    const {publicationRoot, root, sourceRoot} = await temporaryLayout()
    const outside = path.join(root, "outside")
    const outsideMarker = path.join(outside, "marker.txt")

    await mkdir(outside)
    await writeFile(outsideMarker, "unowned\n")

    try {
      const linkedPublication = path.join(root, "linked-publication")
      const linkedPublisher = new GeneratedArtifactPublisher({
        projectId: "linked-project",
        projectRoot: root,
        publicationRoot: linkedPublication,
        sourceRoots: [sourceRoot]
      })

      await symlink(outside, linkedPublication)
      await assert.rejects(linkedPublisher.publish(publicationRequest("linked", "source\n", "build\n")),
        diagnostic("PUBLICATION_SYMLINK_TRAVERSAL"))
      expect(await readFile(outsideMarker, "utf8")).toEqual("unowned\n")

      const publisher = new GeneratedArtifactPublisher({projectId: "safe-project", projectRoot: root, publicationRoot, sourceRoots: [sourceRoot]})

      await publisher.publish(publicationRequest("good", "good source\n", "good build\n"))
      const previous = await publisher.resolveActive()
      const symlinkRequest = publicationRequest("symlink-candidate", "new source\n", "new build\n")

      symlinkRequest.targets[0].validators = [async ({buildPath}) => {
        await symlink(outside, path.join(buildPath, "escape"))

        return [{mediaType: "application/octet-stream", path: "escape/marker.txt", role: "compiler-output"}]
      }]
      await assert.rejects(publisher.publish(symlinkRequest), diagnostic("PUBLICATION_SYMLINK_TRAVERSAL"))

      const tamperedRequest = publicationRequest("tampered-candidate", "new source\n", "new build\n")

      tamperedRequest.targets[0].validators = [async ({sourcePath}) => {
        await writeFile(path.join(sourcePath, "program.txt"), "tampered\n")
      }]
      await assert.rejects(publisher.publish(tamperedRequest), diagnostic("PUBLICATION_STAGE_HASH_MISMATCH"))
      const stillActive = await publisher.resolveActive()

      expect(stillActive.generationId).toEqual(previous.generationId)
      expect(await readPair(stillActive)).toEqual("good source\n|good build\n")
      expect(await readFile(outsideMarker, "utf8")).toEqual("unowned\n")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("rejects undeclared files and directories anywhere in the immutable generation", async () => {
    const {publicationRoot, root, sourceRoot} = await temporaryLayout()
    const publisher = new GeneratedArtifactPublisher({
      projectId: "inventory-project",
      projectRoot: root,
      publicationRoot,
      sourceRoots: [sourceRoot]
    })
    const request = publicationRequest("undeclared-state", "source\n", "unused\n")

    request.targets[0].validators = [async ({buildPath}) => {
      await writeFile(path.join(buildPath, "..", "compiler.log"), "undeclared\n")
      await mkdir(path.join(buildPath, "..", "scratch"))

      return []
    }]

    try {
      await assert.rejects(publisher.publish(request), diagnostic("PUBLICATION_GENERATION_INVENTORY_MISMATCH"))
      await assert.rejects(publisher.resolveActive(), diagnostic("ACTIVE_GENERATION_MISSING"))
      await assert.rejects(lstat(path.join(publicationRoot, "generations", "undeclared-state")), {code: "ENOENT"})
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("rejects hard-linked staged files before publication can make them active", async () => {
    const {publicationRoot, root, sourceRoot} = await temporaryLayout()
    const publisher = new GeneratedArtifactPublisher({
      projectId: "hard-link-project",
      projectRoot: root,
      publicationRoot,
      sourceRoots: [sourceRoot]
    })
    const external = path.join(root, "external-hard-link.bin")
    const request = publicationRequest("hard-linked", "source\n", "unused\n")

    request.targets[0].validators = [async ({buildPath}) => {
      const staged = path.join(buildPath, "program.bin")

      await writeFile(staged, "original\n")
      await link(staged, external)

      return [{mediaType: "application/octet-stream", path: "program.bin", role: "compiler-output"}]
    }]

    try {
      await assert.rejects(publisher.publish(request), diagnostic("PUBLICATION_HARD_LINK"))
      await writeFile(external, "externally mutated\n")
      expect(await readFile(external, "utf8")).toEqual("externally mutated\n")
      await assert.rejects(publisher.resolveActive(), diagnostic("ACTIVE_GENERATION_MISSING"))
      await assert.rejects(lstat(path.join(publicationRoot, "generations", "hard-linked")), {code: "ENOENT"})
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("reconciles only journal-proven abandoned state and retains ambiguous or committed generations", async () => {
    const {publicationRoot, root, sourceRoot} = await temporaryLayout()
    const publisher = new GeneratedArtifactPublisher({projectId: "recovery-project", projectRoot: root, publicationRoot, sourceRoots: [sourceRoot]})
    const generations = path.join(publicationRoot, "generations")
    const journals = path.join(publicationRoot, ".semantifold-publication-journal")
    const abandoned = path.join(generations, "abandoned")
    const ambiguous = path.join(generations, "ambiguous")
    const temporaryPointer = path.join(publicationRoot, ".active-generation.abandoned.tmp")

    try {
      await mkdir(abandoned, {recursive: true})
      await mkdir(ambiguous)
      await mkdir(journals)
      await writeFile(path.join(abandoned, "partial.txt"), "partial\n")
      await writeFile(path.join(ambiguous, "caller.txt"), "ambiguous\n")
      await writeFile(temporaryPointer, "partial pointer\n")
      await writeFile(path.join(journals, "abandoned.json"), `${JSON.stringify({
        generationId: "abandoned",
        projectId: "recovery-project",
        schema: "SemantifoldPublicationJournal",
        tempPointer: ".active-generation.abandoned.tmp",
        version: 1
      })}\n`)

      await publisher.publish(publicationRequest("recovered", "source\n", "build\n"))

      await assert.rejects(lstat(abandoned), {code: "ENOENT"})
      await assert.rejects(lstat(temporaryPointer), {code: "ENOENT"})
      expect(await readdir(journals)).toEqual([])
      expect(await readFile(path.join(ambiguous, "caller.txt"), "utf8")).toEqual("ambiguous\n")
      expect(await readFile(path.join(generations, "recovered", "target/source/program.txt"), "utf8"))
        .toEqual("source\n")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("synchronizes journal-owned cleanup parents before discarding ownership proof", async () => {
    const {publicationRoot, root, sourceRoot} = await temporaryLayout()
    const publisher = new GeneratedArtifactPublisher({
      projectId: "durable-cleanup-project",
      projectRoot: root,
      publicationRoot,
      sourceRoots: [sourceRoot]
    })
    /** @type {string[]} */
    const operations = []

    observePublicationFilesystem(publisher, operation => operations.push(operation))

    try {
      const failedValidation = publicationRequest("interrupted-cleanup", "source\n", "build\n")

      failedValidation.targets[0].validators = [() => {
        throw new Error("candidate failure")
      }]
      injectPublicationFailure(publisher, "before-journal-remove", new Error("cleanup interruption"))
      await assert.rejects(publisher.publish(failedValidation), diagnostic("PUBLICATION_RECOVERY_FAILED"))
      expect(operations).toEqual(["remove-candidate", "sync-candidate-parent"])
      expect(await readdir(path.join(publicationRoot, ".semantifold-publication-journal")))
        .toEqual(["interrupted-cleanup.json"])

      operations.length = 0
      await publisher.publish(publicationRequest("after-interrupted-cleanup", "source\n", "build\n"))
      expect(operations.slice(0, 6)).toEqual([
        "remove-candidate",
        "sync-candidate-parent",
        "remove-temporary-pointer",
        "sync-temporary-pointer-parent",
        "remove-journal",
        "sync-journal-parent"
      ])

      operations.length = 0
      injectPublicationFailure(publisher, "before-pointer-replace", new Error("pointer interruption"))
      await assert.rejects(publisher.publish(publicationRequest("temporary-cleanup", "source\n", "build\n")),
        diagnostic("PUBLICATION_POINTER_FAILED"))
      expect(operations).toEqual([
        "remove-candidate",
        "sync-candidate-parent",
        "remove-temporary-pointer",
        "sync-temporary-pointer-parent",
        "remove-journal",
        "sync-journal-parent"
      ])

      const generations = path.join(publicationRoot, "generations")
      const journals = path.join(publicationRoot, ".semantifold-publication-journal")

      await mkdir(path.join(generations, "recovery-candidate"))
      await writeFile(path.join(publicationRoot, ".active-generation.recovery-candidate.tmp"), "temporary\n")
      await writeFile(path.join(journals, "recovery-candidate.json"), `${JSON.stringify({
        generationId: "recovery-candidate",
        projectId: "durable-cleanup-project",
        schema: "SemantifoldPublicationJournal",
        tempPointer: ".active-generation.recovery-candidate.tmp",
        version: 1
      })}\n`)
      operations.length = 0
      await publisher.publish(publicationRequest("after-reconciliation", "source\n", "build\n"))
      expect(operations.slice(0, 6)).toEqual([
        "remove-candidate",
        "sync-candidate-parent",
        "remove-temporary-pointer",
        "sync-temporary-pointer-parent",
        "remove-journal",
        "sync-journal-parent"
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("fails closed on malformed journals, active pointers, and committed manifests", async () => {
    const malformedJournalLayout = await temporaryLayout()
    const journalPublisher = new GeneratedArtifactPublisher({
      projectId: "journal-project",
      projectRoot: malformedJournalLayout.root,
      publicationRoot: malformedJournalLayout.publicationRoot,
      sourceRoots: [malformedJournalLayout.sourceRoot]
    })

    try {
      await mkdir(path.join(malformedJournalLayout.publicationRoot, ".semantifold-publication-journal"), {recursive: true})
      await writeFile(path.join(malformedJournalLayout.publicationRoot, ".semantifold-publication-journal", "broken.json"), "{}\n")
      await assert.rejects(journalPublisher.publish(publicationRequest("blocked", "source\n", "build\n")),
        diagnostic("PUBLICATION_RECOVERY_FAILED"))
      await assert.rejects(lstat(path.join(malformedJournalLayout.publicationRoot, "generations", "blocked")), {code: "ENOENT"})
    } finally {
      await rm(malformedJournalLayout.root, {force: true, recursive: true})
    }

    const malformedPointerLayout = await temporaryLayout()
    const pointerPublisher = new GeneratedArtifactPublisher({
      projectId: "pointer-project",
      projectRoot: malformedPointerLayout.root,
      publicationRoot: malformedPointerLayout.publicationRoot,
      sourceRoots: [malformedPointerLayout.sourceRoot]
    })

    try {
      await mkdir(malformedPointerLayout.publicationRoot)
      await writeFile(path.join(malformedPointerLayout.publicationRoot, "active-generation.json"), "not json\n")
      await assert.rejects(pointerPublisher.publish(publicationRequest("blocked", "source\n", "build\n")),
        diagnostic("MALFORMED_ACTIVE_GENERATION"))
      await assert.rejects(lstat(path.join(malformedPointerLayout.publicationRoot, "generations", "blocked")), {code: "ENOENT"})
    } finally {
      await rm(malformedPointerLayout.root, {force: true, recursive: true})
    }

    const malformedManifestLayout = await temporaryLayout()
    const manifestPublisher = new GeneratedArtifactPublisher({
      projectId: "manifest-project",
      projectRoot: malformedManifestLayout.root,
      publicationRoot: malformedManifestLayout.publicationRoot,
      sourceRoots: [malformedManifestLayout.sourceRoot]
    })

    try {
      const published = await manifestPublisher.publish(publicationRequest("committed", "source\n", "build\n"))

      await writeFile(published.manifestPath, "{}\n")
      await assert.rejects(manifestPublisher.resolveActive(), diagnostic("MALFORMED_GENERATION_MANIFEST"))
    } finally {
      await rm(malformedManifestLayout.root, {force: true, recursive: true})
    }
  })

  it("normalizes missing and unreadable committed projections without exposing host paths", async () => {
    const {publicationRoot, root, sourceRoot} = await temporaryLayout()
    const publisher = new GeneratedArtifactPublisher({
      projectId: "verification-project",
      projectRoot: root,
      publicationRoot,
      sourceRoots: [sourceRoot]
    })

    try {
      const published = await publisher.publish(publicationRequest("missing-projection", "source\n", "build\n"))

      await rm(published.targets[0].sourcePath, {recursive: true})
      await assert.rejects(publisher.resolveActive(), error =>
        error instanceof SemantifoldDiagnostic &&
        error.code == "PUBLICATION_GENERATION_VERIFICATION_FAILED" &&
        error.detail == "Immutable generation filesystem inventory could not be verified." &&
        error.cause instanceof Error && "code" in error.cause && error.cause.code == "ENOENT" &&
        !error.message.includes(root))
    } finally {
      await rm(root, {force: true, recursive: true})
    }

    if (process.platform != "win32") {
      const unreadableLayout = await temporaryLayout()
      const unreadablePublisher = new GeneratedArtifactPublisher({
        projectId: "unreadable-project",
        projectRoot: unreadableLayout.root,
        publicationRoot: unreadableLayout.publicationRoot,
        sourceRoots: [unreadableLayout.sourceRoot]
      })
      let unreadablePath

      try {
        const published = await unreadablePublisher.publish(publicationRequest("unreadable-projection", "source\n", "build\n"))

        unreadablePath = published.targets[0].sourcePath
        await chmod(unreadablePath, 0)
        await assert.rejects(unreadablePublisher.resolveActive(), error =>
          error instanceof SemantifoldDiagnostic &&
          error.code == "PUBLICATION_GENERATION_VERIFICATION_FAILED" &&
          error.detail == "Immutable generation filesystem inventory could not be verified." &&
          error.cause instanceof Error && "code" in error.cause && error.cause.code == "EACCES" &&
          !error.message.includes(unreadableLayout.root))
      } finally {
        if (unreadablePath) await chmod(unreadablePath, 0o700)
        await rm(unreadableLayout.root, {force: true, recursive: true})
      }
    }
  })

  it("keeps the truthful old-or-new authority across stage, validation, pointer, and cleanup failures", async () => {
    const {publicationRoot, root, sourceRoot} = await temporaryLayout()
    const publisher = new GeneratedArtifactPublisher({projectId: "failure-project", projectRoot: root, publicationRoot, sourceRoots: [sourceRoot]})

    try {
      const initial = await publisher.publish(publicationRequest("initial", "old source\n", "old build\n"))
      const tooLong = `${"a".repeat(300)}.txt`
      const writeFailure = {
        generationId: "write-failure",
        targets: [{
          artifactSet: artifactSet("demo", [{content: "unwritable\n", path: tooLong}]),
          buildProjection: "target/build",
          id: "demo-target",
          role: "text",
          sourceProjection: "target/source"
        }]
      }

      await assert.rejects(publisher.publish(writeFailure), diagnostic("PUBLICATION_STAGE_WRITE_FAILED"))
      expect((await publisher.resolveActive()).generationId).toEqual("initial")

      const validatorError = new Error("injected validator failure")
      const validationFailure = publicationRequest("validation-failure", "candidate source\n", "candidate build\n")

      validationFailure.targets[0].validators = [() => {
        throw validatorError
      }]
      await assert.rejects(publisher.publish(validationFailure), error =>
        error instanceof SemantifoldDiagnostic && error.code == "PUBLICATION_VALIDATION_FAILED" && error.cause === validatorError)
      expect((await publisher.resolveActive()).generationId).toEqual("initial")

      const stageError = new Error("injected completed-stage interruption")

      injectPublicationFailure(publisher, "after-stage", stageError)
      await assert.rejects(publisher.publish(publicationRequest("stage-failure", "candidate source\n", "candidate build\n")), error =>
        error instanceof SemantifoldDiagnostic && error.code == "PUBLICATION_STAGE_WRITE_FAILED" && error.cause === stageError)
      expect((await publisher.resolveActive()).generationId).toEqual("initial")

      const beforeReplaceError = new Error("injected before pointer replacement")

      injectPublicationFailure(publisher, "before-pointer-replace", beforeReplaceError)
      await assert.rejects(publisher.publish(publicationRequest("before-replace", "candidate source\n", "candidate build\n")), error =>
        error instanceof SemantifoldDiagnostic && error.code == "PUBLICATION_POINTER_FAILED" && error.cause === beforeReplaceError)
      expect((await publisher.resolveActive()).generationId).toEqual("initial")

      const afterReplaceError = new Error("injected after pointer replacement")

      injectPublicationFailure(publisher, "after-pointer-replace", afterReplaceError)
      await assert.rejects(publisher.publish(publicationRequest("after-replace", "new source\n", "new build\n")), error =>
        error instanceof SemantifoldDiagnostic && error.code == "PUBLICATION_POINTER_FAILED" && error.cause === afterReplaceError)
      const afterReplace = await publisher.resolveActive()

      expect(afterReplace.generationId).toEqual("after-replace")
      expect(await readPair(afterReplace)).toEqual("new source\n|new build\n")

      injectPublicationFailure(publisher, "before-cleanup", new Error("injected cleanup failure"))
      const cleanupPending = await publisher.publish(publicationRequest("cleanup-pending", "latest source\n", "latest build\n"))

      expect(cleanupPending.cleanupPending).toBeTrue()
      const pendingResolved = await publisher.resolveActive()

      expect(pendingResolved.generationId).toEqual("cleanup-pending")
      expect(pendingResolved.cleanupPending).toBeTrue()
      const cleanupJournalPath = path.join(publicationRoot, ".semantifold-publication-journal", "cleanup-pending.json")
      const cleanupJournal = await readFile(cleanupJournalPath)

      await writeFile(cleanupJournalPath, "{}\n")
      await assert.rejects(publisher.resolveActive(), diagnostic("PUBLICATION_RECOVERY_FAILED"))
      await writeFile(cleanupJournalPath, cleanupJournal)
      const recovered = await publisher.publish(publicationRequest("after-recovery", "final source\n", "final build\n"))

      expect(recovered.cleanupPending).toBeFalse()
      const recoveredResolved = await publisher.resolveActive()

      expect(recoveredResolved.generationId).toEqual("after-recovery")
      expect(recoveredResolved.cleanupPending).toBeFalse()
      expect(await readFile(path.join(cleanupPending.targets[0].sourcePath, "program.txt"), "utf8"))
        .toEqual("latest source\n")
      expect(await readFile(path.join(initial.targets[0].sourcePath, "program.txt"), "utf8")).toEqual("old source\n")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

/**
 * Returns the first fixture generation path.
 * @param {string} publicationRoot - Publication root.
 * @returns {string} Generation path.
 */
function firstGenerationPath(publicationRoot) {
  return path.join(publicationRoot, "generations", "cycle-001")
}

/**
 * Creates a single-target request whose validator emits one build file.
 * @param {string} generationId - Explicit generation identity.
 * @param {string} source - Generated source bytes.
 * @param {string} build - Validator output bytes.
 * @param {() => Promise<void>} [pause] - Optional validation barrier.
 * @returns {import("../src/semantic/types.js").PublicationRequest} Publication request.
 */
function publicationRequest(generationId, source, build, pause) {
  return {
    generationId,
    targets: [{
      artifactSet: artifactSet("demo", [{content: source, path: "program.txt"}]),
      buildProjection: "target/build",
      id: "demo-target",
      role: "text",
      sourceProjection: "target/source",
      validators: [async ({buildPath}) => {
        if (pause) await pause()
        await writeFile(path.join(buildPath, "program.bin"), build)

        return [{mediaType: "application/octet-stream", path: "program.bin", role: "compiler-output"}]
      }]
    }]
  }
}

/**
 * Reads source and build bytes through one already-resolved snapshot.
 * @param {import("../src/semantic/types.js").PublishedGeneration} snapshot - Pointer-once snapshot.
 * @returns {Promise<string>} Paired contents.
 */
async function readPair(snapshot) {
  const [{buildPath, sourcePath}] = snapshot.targets
  const [source, build] = await Promise.all([
    readFile(path.join(sourcePath, "program.txt"), "utf8"),
    readFile(path.join(buildPath, "program.bin"), "utf8")
  ])

  return `${source}|${build}`
}

/**
 * Matches one stable publication diagnostic code.
 * @param {string} code - Expected code.
 * @returns {(error: unknown) => boolean} Assertion predicate.
 */
function diagnostic(code) {
  return error => error instanceof SemantifoldDiagnostic && error.code == code
}
