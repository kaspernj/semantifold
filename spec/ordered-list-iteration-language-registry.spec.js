// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {languageCapabilities} from "../index.js"

const originalFive = ["php", "ruby", "javascript", "typescript", "java"]

describe("ordered list iteration language registry", () => {
  it("advertises ordered list iteration only for the original-five source and target cohort", () => {
    expect(languageCapabilities.filter(({features}) => features.orderedListIteration).map(({id}) => id)).toEqual(originalFive)
    for (const descriptor of languageCapabilities) {
      expect(typeof descriptor.features.orderedListIteration).toEqual("boolean")
      expect(Object.isFrozen(descriptor.features)).toBeTrue()
    }
  })
})
