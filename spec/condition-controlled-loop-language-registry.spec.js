// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {languageCapabilities} from "../index.js"

describe("condition-controlled loop language registry", () => {
  it("advertises the canonical capability only for the five-language adoption cohort", () => {
    expect(languageCapabilities.filter(({features}) => features.conditionControlledLoops).map(({id}) => id))
      .toEqual(["php", "ruby", "javascript", "typescript", "java"])
    for (const descriptor of languageCapabilities) expect(typeof descriptor.features.conditionControlledLoops).toEqual("boolean")
  })
})
