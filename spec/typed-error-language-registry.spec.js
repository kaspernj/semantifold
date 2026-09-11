// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {languageCapabilities} from "../index.js"

const originalFive = new Set(["php", "ruby", "javascript", "typescript", "java"])

describe("typed error language registry", () => {
  it("advertises typed errors only for the exact original-five cohort", () => {
    expect(languageCapabilities.map(({id, features}) => [id, features.typedErrors])).toEqual(
      languageCapabilities.map(({id}) => [id, originalFive.has(id)]))
  })
})
