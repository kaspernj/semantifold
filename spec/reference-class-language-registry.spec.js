// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {languageCapabilities} from "../index.js"

describe("reference class language registry", () => {
  it("advertises Task 033 only for the original-five source and text-target cohort", () => {
    const adopted = ["php", "ruby", "javascript", "typescript", "java"]

    for (const language of languageCapabilities) {
      expect(language.features.referenceClasses).toEqual(adopted.includes(language.id))
    }
  })
})
