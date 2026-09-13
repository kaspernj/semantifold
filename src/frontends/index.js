// @ts-check

import {languageRegistry} from "../language-registry.js"
import {normalizeCapabilityAuthority} from "../semantic/capabilities.js"
import {annotateParsedModule} from "../semantic/provenance.js"
import {validateParsedModule} from "../semantic/validate.js"
import {unsupportedCapability} from "../diagnostic.js"

/**
 * Parses supported source into a shared semantic module.
 * @param {object} input - Parse request.
 * @param {string} input.filename - Source filename used in diagnostics.
 * @param {import("../semantic/types.js").SemanticLanguage} input.language - Source language.
 * @param {string} input.source - Source text.
 * @param {Readonly<import("../semantic/types.js").CapabilityAuthority> | import("../semantic/types.js").CapabilityAuthorityInput} [input.capabilityAuthority] - Explicit compiler authority.
 * @returns {import("../semantic/types.js").SemanticModule} Semantic module.
 */
export function parseSource({capabilityAuthority, filename, language, source}) {
  const authority = normalizeCapabilityAuthority(capabilityAuthority)
  const frontend = /** @type {typeof import("./php.js").parsePhp} */ (
    languageRegistry.resolve(language, "frontend"))
  const module = frontend({capabilities: authority?.capabilities, filename, source})

  if (authority && !languageRegistry.record(language).features.effectfulCapabilitiesAndResources) {
    unsupportedCapability(language, "Task 034 effectful capabilities and owned resources", module.location)
  }
  if (authority) module.capabilities = /** @type {import("../semantic/types.js").EffectCapabilityDeclaration[]} */ (authority.capabilities)
  const validated = validateParsedModule(module, language)

  return annotateParsedModule(validated, {filename, language, source})
}
