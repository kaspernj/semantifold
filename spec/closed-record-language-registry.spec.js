// @ts-check

import {describe, expect, it} from "@velocious/testing"
import {languageCapabilities} from "../index.js"

describe("closed record language registry capability", () => {
  it("advertises Task 009 only for the original-five cohort", () => {
    expect(languageCapabilities.filter(({features}) => features.closedRecords).map(({id}) => id)).toEqual([
      "php", "ruby", "javascript", "typescript", "java"
    ])
    expect(languageCapabilities.filter(({features}) => !features.closedRecords).map(({id}) => id)).toEqual([
      "kotlin", "python", "csharp", "go", "c", "cpp", "rust", "swift", "wasm"
    ])
  })
})
