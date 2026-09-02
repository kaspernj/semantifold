// @ts-check

import {unsupportedSyntax} from "../diagnostic.js"

/**
 * Enforces the coherent release-candidate semantic subset after adaptation.
 * @param {import("./types.js").SemanticModule} module - Adapted semantic module.
 * @param {import("./types.js").SemanticLanguage} language - Source language.
 * @returns {import("./types.js").SemanticModule} Validated module.
 */
export function validateParsedModule(module, language) {
  for (const functionDeclaration of module.functions) {
    if (functionDeclaration.parameters.length != 2) {
      unsupportedSyntax(language, "function parameter count other than two", functionDeclaration.location)
    }

    if (functionDeclaration.body.length != 1 || functionDeclaration.body[0].kind != "IfStatement") {
      unsupportedSyntax(language, "function body other than one if/else", functionDeclaration.location)
    }

    const branch = /** @type {import("./types.js").IfStatement} */ (functionDeclaration.body[0])

    if (branch.consequent.length != 1 || branch.alternate.length != 1) {
      unsupportedSyntax(language, "if/else branch without exactly one return", branch.location)
    }
  }

  if (module.entryPoint.body.length != 1) {
    unsupportedSyntax(language, "entry point without exactly one print", module.entryPoint.location)
  }

  return module
}
