// @ts-check

import path from "node:path"
import {SemantifoldDiagnostic} from "../diagnostic.js"
import {
  checkArtifacts,
  checkPlan,
  checkStage,
  checkTool,
  environmentPath,
  pathArgument
} from "./check-plan.js"
import {rustLockfile, rustManifest} from "./rust-runtime.js"

/**
 * Constructs Rust's locked offline Cargo build/check plan.
 * @param {import("../language-registry.js").TargetCheckPlanContext} context - Validated candidate context.
 * @returns {import("../semantic/types.js").TargetCheckPlan} Immutable Cargo plan.
 */
export function createRustCheckPlan(context) {
  const tool = checkTool(context, "cargo", "rust")
  const artifacts = checkArtifacts(context, artifact => artifact.path.endsWith(".rs") ||
    artifact.path == "Cargo.toml" || artifact.path == "Cargo.lock",
  "rust", "only staged Rust source and canonical Cargo manifest/lock artifacts")
  const manifest = context.artifacts.artifacts.filter(artifact => artifact.path == "Cargo.toml")
  const lock = context.artifacts.artifacts.filter(artifact => artifact.path == "Cargo.lock")
  const sources = artifacts.filter(artifact => artifact.endsWith(".rs"))

  if (manifest.length != 1 || manifest[0].contentKind != "text" || manifest[0].role != "manifest" ||
    manifest[0].content != rustManifest || lock.length != 1 || lock[0].contentKind != "text" ||
    lock[0].content != rustLockfile || artifacts.length != 3 || sources.length != 1 ||
    sources[0] != path.join(context.sourcePath, "src/main.rs")) {
    throw new SemantifoldDiagnostic({
      code: "INVALID_TARGET_CHECK_PLAN",
      language: "rust",
      message: "Rust developer checks require the exact dependency-free Cargo project/lock and staged '.rs' source."
    })
  }
  const cargoHome = path.join(context.buildPath, "cargo-home")
  const home = path.join(context.buildPath, "home")
  const temporary = path.join(context.buildPath, "tmp")
  const target = path.join(context.buildPath, "cargo-target")
  const environment = {
    CARGO_HOME: cargoHome,
    CARGO_INCREMENTAL: "0",
    CARGO_NET_OFFLINE: "true",
    CARGO_TERM_COLOR: "never",
    HOME: home,
    PATH: [path.dirname(tool.executable), "/usr/local/bin", "/usr/bin", "/bin"].filter((value, index, values) =>
      values.indexOf(value) == index).join(path.delimiter),
    TMPDIR: temporary
  }
  const environmentPaths = [environmentPath("CARGO_HOME", "build"), environmentPath("HOME", "build"),
    environmentPath("TMPDIR", "build")]
  /**
   * Constructs one Cargo stage over the complete generated project.
   * @param {import("../semantic/types.js").AcceptanceStage} name - Registry stage identity.
   * @param {string} command - Exact Cargo subcommand.
   * @returns {import("../semantic/types.js").TargetCheckStageRequest} Immutable stage.
   */
  const stage = (name, command) => checkStage({
    argv: [command, "--offline", "--locked", "--target-dir", target],
    cwd: context.sourcePath,
    environment,
    environmentPaths,
    inputs: artifacts,
    output: null,
    pathArguments: [pathArgument(4, "build")],
    stage: name,
    tool,
    transientPaths: [target]
  })

  return checkPlan(context, "rust", artifacts, [stage("compile", "build"), stage("validate", "check")])
}
