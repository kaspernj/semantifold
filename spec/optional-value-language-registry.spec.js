// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {languageCapabilities} from "../index.js"

const originalFive = ["php", "ruby", "javascript", "typescript", "java"]

describe("optional value language registry", () => {
  it("advertises optional values only for the original-five source and target cohort", () => {
    expect(languageCapabilities.filter(({features}) => features.optionalValues).map(({id}) => id)).toEqual(originalFive)
    for (const descriptor of languageCapabilities) {
      expect(typeof descriptor.features.optionalValues).toEqual("boolean")
      expect(Object.isFrozen(descriptor.features)).toBeTrue()
    }
  })
})
