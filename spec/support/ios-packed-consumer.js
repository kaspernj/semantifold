// @ts-check

export const iosPackedConsumerSource = `
import assert from "node:assert/strict"
import {
  generateProgramArtifactSet,
  parseProgram
} from "semantifold"

const sources = [
  {
    filename: "main.rb",
    id: "main",
    language: "ruby",
    source: 'require_relative "math_tools"\\nmodule Main\\n  puts MathTools.decorate("packed", "!")\\nend\\n'
  },
  {
    filename: "math_tools.rb",
    id: "math_tools",
    language: "ruby",
    source: 'module MathTools\\n  module_function\\n  # @param value [String]\\n  # @param suffix [String]\\n' +
      '  # @return [String]\\n  def decorate(value, suffix)\\n    return value + suffix\\n  end\\nend\\n'
  }
]
const configuration = {
  bundleIdentifier: "com.example.semantifold",
  deploymentTarget: "18.0",
  displayName: "Semantifold",
  moduleName: "SemantifoldApp",
  organizationPrefix: "com.example",
  productName: "SemantifoldApp"
}
const program = parseProgram({entryModule: "main", sources})
const first = generateProgramArtifactSet({configuration, language: "ios", program, role: "application"})
const second = generateProgramArtifactSet({configuration, language: "ios", program, role: "application"})

assert.deepEqual(first, second)
assert.equal(first.target, "ios")
const manifest = JSON.parse(first.artifacts.find(({path: artifactPath}) => artifactPath == "semantifold-project.json").content)
assert.equal(manifest.target, "ios")
assert.deepEqual(manifest.provenance.semanticSources.map(({language}) => language), ["ruby", "ruby"])
assert.deepEqual(manifest.semanticProgram.modules.map(({id}) => id), ["math_tools", "main"])
assert.equal(manifest.semanticProgram.entry.generatedFunctionIdentity, "SemantifoldModuleMain.semantifoldEntry")
process.stdout.write(JSON.stringify({
  artifactCount: first.artifacts.length,
  entryModule: manifest.semanticProgram.entry.moduleId,
  manifestTarget: manifest.target,
  target: first.target
}))
`

export const iosTypeConsumerSource = `
import {generateProgramArtifactSet, parseProgram} from "semantifold"

const program = parseProgram({
  entryModule: "main",
  sources: [{
    filename: "main.rb",
    id: "main",
    language: "ruby",
    source: "module Main\\n  puts 1\\nend\\n"
  }]
})
const artifactSet = generateProgramArtifactSet({
  configuration: {
    bundleIdentifier: "com.example.semantifold",
    deploymentTarget: "18.0",
    displayName: "Semantifold",
    moduleName: "SemantifoldApp",
    organizationPrefix: "com.example",
    productName: "SemantifoldApp"
  },
  language: "ios",
  program,
  role: "application"
})

void artifactSet
`

/**
 * Removes inherited npm credentials/configuration and applies the explicit public-registry proof environment.
 * @param {string} cacheDirectory - Fresh npm cache.
 * @param {string} userConfig - Empty user configuration.
 * @param {string} globalConfig - Empty global configuration.
 * @param {Record<string, string | undefined>} inheritedEnvironment - Synthetic hostile environment.
 * @returns {Record<string, string | undefined>} Sanitized npm environment.
 */
export function registryEnvironment(cacheDirectory, userConfig, globalConfig, inheritedEnvironment) {
  const environment = Object.fromEntries(Object.entries(inheritedEnvironment).filter(([name]) =>
    !/^(?:npm_config_|NODE_AUTH_TOKEN$|NPM_TOKEN$|NODE_PATH$)/iu.test(name)))

  return {
    ...environment,
    npm_config_audit: "false",
    npm_config_cache: cacheDirectory,
    npm_config_fund: "false",
    npm_config_globalconfig: globalConfig,
    npm_config_registry: "https://registry.npmjs.org/",
    npm_config_userconfig: userConfig
  }
}

/**
 * Builds a synthetic inherited npm environment to prove case-insensitive credential removal.
 * @param {string} alternateConfig - Alternate npm configuration path.
 * @returns {Record<string, string | undefined>} Hostile inherited environment.
 */
export function alternateNpmEnvironment(alternateConfig) {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^(?:npm_config_|NODE_AUTH_TOKEN$|NPM_TOKEN$|NODE_PATH$)/iu.test(name)))

  return {
    ...environment,
    NPM_CONFIG_GLOBALCONFIG: alternateConfig,
    NPM_CONFIG_INSTALL_LINKS: "false",
    NPM_CONFIG_REGISTRY: "https://environment.invalid/",
    NPM_CONFIG_USERCONFIG: `${alternateConfig}.user`,
    "NpM_CoNfIg_//registry.npmjs.org/:_authToken": "synthetic-token",
    "NpM_CoNfIg_@types:registry": "https://environment-scoped.invalid/",
    NoDe_AuTh_ToKeN: "synthetic-node-token",
    NoDe_PaTh: "/synthetic/unused/modules",
    NpM_CoNfIg__password: "c3ludGhldGlj",
    NpM_CoNfIg_proxy: "http://synthetic-user:synthetic-password@proxy.invalid/",
    NpM_CoNfIg_username: "synthetic-user",
    NpM_ToKeN: "synthetic-npm-token"
  }
}
