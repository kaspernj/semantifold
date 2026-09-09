// @ts-check

import {discoverCanonicalToolchain, generateArtifactSet, runAcceptanceStages} from "../../index.js"

/**
 * Compiles and executes one generated Python artifact with the configured interpreter.
 * @param {import("../../src/semantic/types.js").SemanticModule} module - Semantic module.
 * @returns {Promise<import("../../src/semantic/types.js").AcceptanceResult>} Staged acceptance result.
 */
export async function executePython(module) {
  const python = await discoverCanonicalToolchain("python")

  return await runAcceptanceStages({
    artifacts: generateArtifactSet({language: "python", module}),
    environment: {PATH: process.env.PATH, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1"},
    stages: [
      {arguments: ["-m", "py_compile", "program.py"], stage: "compile", tool: python},
      {arguments: ["program.py"], stage: "execute", tool: python}
    ],
    target: "python",
    timeoutMs: 20_000
  })
}
