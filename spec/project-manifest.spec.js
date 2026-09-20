// @ts-check

import assert from "node:assert/strict"
import {link, mkdir, mkdtemp, rm, symlink, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "@velocious/testing"
import {ProjectManifestLoader, SemantifoldProject} from "../index.js"
import {supportsProgramArtifactRole} from "../src/backends/program.js"

/**
 * Creates one real version-1 project manifest.
 * @param {Record<string, unknown>} [overrides] - Root manifest replacements.
 * @returns {Promise<{manifestPath: string, root: string}>} Temporary project paths.
 */
async function projectFixture(overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "semantifold-task039-manifest-"))
  const manifestPath = path.join(root, "semantifold.json")

  await mkdir(path.join(root, "src"))
  await writeFile(path.join(root, "src/main.js"), "console.log(\"ready\")\n")
  await writeFile(manifestPath, `${JSON.stringify({
    id: "demo-project",
    publicationRoot: ".semantifold",
    schema: "SemantifoldProject",
    sources: [{entry: true, id: "main", language: "javascript", path: "src/main.js"}],
    targets: [{id: "java-main", language: "java", role: "text", sourceProjection: "targets/java/source"}],
    version: 1,
    ...overrides
  }, null, 2)}\n`)

  return {manifestPath, root}
}

/** @param {string} code @returns {(error: unknown) => boolean} */
function diagnostic(code) {
  return error => error instanceof Error && "code" in error && error.code == code
}

describe("Semantifold project manifest", () => {
  it("loads one strict version-1 manifest as a deeply immutable normalized project", async () => {
    const {manifestPath, root} = await projectFixture()

    try {
      const project = await new ProjectManifestLoader().load(manifestPath)

      expect(project instanceof SemantifoldProject).toBeTrue()
      expect(project.id).toEqual("demo-project")
      expect(project.version).toEqual(1)
      expect(project.projectRoot).toEqual(root)
      expect(project.manifestPath).toEqual(manifestPath)
      expect(project.publicationRoot).toEqual(path.join(root, ".semantifold"))
      expect(project.entryModule).toEqual("main")
      expect(project.sources).toEqual([{
        absolutePath: path.join(root, "src/main.js"),
        entry: true,
        id: "main",
        language: "javascript",
        path: "src/main.js"
      }])
      expect(project.targets).toEqual([{
        buildProjection: "targets/java-main/build",
        id: "java-main",
        language: "java",
        role: "text",
        sourceProjection: "targets/java/source"
      }])
      for (const value of [project, project.sources, project.sources[0], project.targets, project.targets[0]]) {
        expect(Object.isFrozen(value)).toBeTrue()
      }
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("rejects unknown fields, versions, duplicate identities, and invalid entry declarations", async () => {
    const invalid = [
      {code: "INVALID_PROJECT_MANIFEST", overrides: {unknown: true}},
      {code: "INVALID_PROJECT_MANIFEST", overrides: {version: 2}},
      {
        code: "INVALID_PROJECT_MANIFEST",
        overrides: {sources: [
          {entry: true, id: "main", language: "javascript", path: "src/main.js"},
          {entry: false, id: "main", language: "javascript", path: "src/other.js"}
        ]}
      },
      {
        code: "INVALID_PROJECT_MANIFEST",
        overrides: {sources: [{entry: false, id: "main", language: "javascript", path: "src/main.js"}]}
      },
      {
        code: "INVALID_PROJECT_MANIFEST",
        overrides: {sources: [
          {entry: true, id: "main", language: "javascript", path: "src/main.js"},
          {entry: true, id: "other", language: "javascript", path: "src/other.js"}
        ]}
      },
      {
        code: "INVALID_PROJECT_MANIFEST",
        overrides: {targets: [
          {id: "same", language: "java", role: "text", sourceProjection: "targets/java/source"},
          {id: "same", language: "javascript", role: "text", sourceProjection: "targets/js/source"}
        ]}
      }
    ]

    for (const {code, overrides} of invalid) {
      const {manifestPath, root} = await projectFixture(overrides)

      try {
        await assert.rejects(new ProjectManifestLoader().load(manifestPath), diagnostic(code))
      } finally {
        await rm(root, {force: true, recursive: true})
      }
    }
  })

  it("rejects unregistered roles and registered languages outside the multi-file project profile", async () => {
    const invalid = [
      {
        code: "UNSUPPORTED_LANGUAGE",
        overrides: {sources: [{entry: true, id: "main", language: "unknown", path: "src/main.js"}]}
      },
      {
        code: "UNSUPPORTED_PROJECT_SOURCE",
        overrides: {sources: [{entry: true, id: "main", language: "python", path: "src/main.js"}]}
      },
      {
        code: "UNSUPPORTED_LANGUAGE",
        overrides: {targets: [{id: "unknown", language: "unknown", role: "text", sourceProjection: "targets/unknown/source"}]}
      },
      {
        code: "UNSUPPORTED_ROLE",
        overrides: {targets: [{id: "java-main", language: "java", role: "binary", sourceProjection: "targets/java/source"}]}
      },
      {
        code: "UNSUPPORTED_PROJECT_TARGET",
        overrides: {targets: [{id: "go-main", language: "go", role: "text", sourceProjection: "targets/go/source"}]}
      },
      {
        code: "UNSUPPORTED_PROJECT_TARGET",
        overrides: {targets: [{id: "wasm-main", language: "wasm", role: "binary", sourceProjection: "targets/wasm/source"}]}
      }
    ]

    for (const {code, overrides} of invalid) {
      const {manifestPath, root} = await projectFixture(overrides)

      try {
        await assert.rejects(new ProjectManifestLoader().load(manifestPath), diagnostic(code))
      } finally {
        await rm(root, {force: true, recursive: true})
      }
    }
  })

  it("rejects iOS application generation that version 1 cannot configure without removing backend capability", async () => {
    const {manifestPath, root} = await projectFixture({targets: [{
      id: "ios-main",
      language: "ios",
      role: "application",
      sourceProjection: "targets/ios/source"
    }]})

    try {
      expect(supportsProgramArtifactRole("ios", "application")).toBeTrue()
      await assert.rejects(new ProjectManifestLoader().load(manifestPath), error =>
        error instanceof Error && "code" in error && error.code == "UNSUPPORTED_PROJECT_TARGET" &&
          "language" in error && error.language == "ios")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it("rejects absolute, escaping, aliased, overlapping, independent, colliding, and nested paths", async () => {
    const invalid = [
      {code: "INVALID_PROJECT_PATH", overrides: {publicationRoot: "/tmp/output"}},
      {code: "INVALID_PROJECT_PATH", overrides: {publicationRoot: "out/../published"}},
      {
        code: "INVALID_PROJECT_PATH",
        overrides: {sources: [{entry: true, id: "main", language: "javascript", path: "./src/main.js"}]}
      },
      {
        code: "INVALID_PROJECT_PATH",
        overrides: {sources: [{entry: true, id: "main", language: "javascript", path: "../main.js"}]}
      },
      {
        code: "PROJECT_SOURCE_ALIAS",
        overrides: {sources: [
          {entry: true, id: "main", language: "javascript", path: "src/main.js"},
          {entry: false, id: "other", language: "javascript", path: "src/main.js"}
        ]}
      },
      {
        code: "PROJECT_SOURCE_ALIAS",
        overrides: {sources: [
          {entry: true, id: "main", language: "javascript", path: "src/Café file.js"},
          {entry: false, id: "other", language: "javascript", path: "src/café file.js"}
        ]}
      },
      {
        code: "PROJECT_SOURCE_PUBLICATION_OVERLAP",
        overrides: {
          publicationRoot: "src",
          sources: [{entry: true, id: "main", language: "javascript", path: "src/main.js"}]
        }
      },
      {
        code: "INVALID_PROJECT_MANIFEST",
        overrides: {targets: [{
          id: "java-main",
          language: "java",
          outputRoot: "other",
          role: "text",
          sourceProjection: "targets/java/source"
        }]}
      },
      {
        code: "PROJECT_PROJECTION_COLLISION",
        overrides: {targets: [{
          buildProjection: "targets/java/source/build",
          id: "java-main",
          language: "java",
          role: "text",
          sourceProjection: "targets/java/source"
        }]}
      },
      {
        code: "PROJECT_PROJECTION_COLLISION",
        overrides: {targets: [
          {id: "java-main", language: "java", role: "text", sourceProjection: "targets/shared"},
          {
            buildProjection: "targets/js/build",
            id: "js-main",
            language: "javascript",
            role: "text",
            sourceProjection: "targets/shared/child"
          }
        ]}
      },
      {
        code: "INVALID_PROJECT_PATH",
        overrides: {targets: [{id: "java-main", language: "java", role: "text", sourceProjection: "/targets/java/source"}]}
      },
      {
        code: "INVALID_PROJECT_PATH",
        overrides: {targets: [{id: "java-main", language: "java", role: "text", sourceProjection: "targets\\java\\source"}]}
      },
      {
        code: "INVALID_PROJECT_PATH",
        overrides: {targets: [{id: "java-main", language: "java", role: "text", sourceProjection: "manifest.json/source"}]}
      }
    ]

    for (const {code, overrides} of invalid) {
      const {manifestPath, root} = await projectFixture(overrides)

      try {
        await assert.rejects(new ProjectManifestLoader().load(manifestPath), diagnostic(code))
      } finally {
        await rm(root, {force: true, recursive: true})
      }
    }
  })

  it("rejects project-root and declared-source symlink traversal", async () => {
    const first = await projectFixture()
    const alias = `${first.root}-alias`

    try {
      await symlink(first.root, alias, "dir")
      await assert.rejects(new ProjectManifestLoader().load(path.join(alias, "semantifold.json")),
        diagnostic("PROJECT_SYMLINK_TRAVERSAL"))
    } finally {
      await rm(alias, {force: true})
      await rm(first.root, {force: true, recursive: true})
    }

    const second = await projectFixture()

    try {
      await rm(path.join(second.root, "src/main.js"))
      await writeFile(path.join(second.root, "outside.js"), "console.log(\"outside\")\n")
      await symlink(path.join(second.root, "outside.js"), path.join(second.root, "src/main.js"))
      await assert.rejects(new ProjectManifestLoader().load(second.manifestPath), diagnostic("PROJECT_SYMLINK_TRAVERSAL"))
    } finally {
      await rm(second.root, {force: true, recursive: true})
    }

    const third = await projectFixture()

    try {
      await mkdir(path.join(third.root, "owned"))
      await symlink(path.join(third.root, "owned"), path.join(third.root, ".semantifold"), "dir")
      await assert.rejects(new ProjectManifestLoader().load(third.manifestPath), diagnostic("PROJECT_SYMLINK_TRAVERSAL"))
    } finally {
      await rm(third.root, {force: true, recursive: true})
    }
  })

  it("rejects two declared paths that hard-link to the same source bytes", async () => {
    const {manifestPath, root} = await projectFixture({sources: [
      {entry: true, id: "main", language: "javascript", path: "src/main.js"},
      {entry: false, id: "alias", language: "javascript", path: "src/alias.js"}
    ]})

    try {
      await link(path.join(root, "src/main.js"), path.join(root, "src/alias.js"))
      await assert.rejects(new ProjectManifestLoader().load(manifestPath), diagnostic("PROJECT_SOURCE_ALIAS"))
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})
