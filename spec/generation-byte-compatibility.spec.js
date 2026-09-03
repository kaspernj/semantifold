// @ts-check

import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {describe, it} from "@velocious/testing"
import {generate, generateArtifact, parse} from "../index.js"

const fixtures = [
  ["php", "program.php"],
  ["ruby", "program.rb"],
  ["javascript", "program.js"],
  ["typescript", "program.ts"],
  ["java", "Main.java"]
]
const expected = {
  base: {
    java: "d8587c082ef3f2d01522c6e18a270c757bfdb3c9a6787cec1b0b8729b135b44b",
    javascript: "921140c9d611632b5a4fbd20f03e5a5e6ec49fb1fc03558e8f188fd44bc8c2e6",
    php: "cdfe37aa18e77ee9a4b31d7a8610c2decf8cda00ada8245fe09bde6e2d69c2d3",
    ruby: "1fceb8522aaa652c6c419ac933266ad5da1fb34046236057e2f7f32e6e9d5121",
    typescript: "8ecc6baa77a09ee3a38a70e9a65620811c4934052a57d2b95b0517f516cfb9c3"
  },
  locals: {
    java: "969d439fc969b73effb689402590fee100a69c9636f8c4d65c8ccd928c688a88",
    javascript: "79d1f74cbce802e12bc2ba439f487c4317926885d49ee4ed9288565a5f861977",
    php: "a97616b71654b5557e4d1650974ea21df074bf1cc3b52f68f38971bea94b655e",
    ruby: "31fc4973d0676e1578b24106835c871cc8285b41375fac714c519102e82a2474",
    typescript: "4a508bbbb72b83052797da8cb4251d376d0facd2a067c6cbc82a631f09004880"
  }
}

describe("legacy generation byte compatibility", () => {
  it("preserves every pre-mapping output byte for base and local profiles", async () => {
    for (const [profile, directory] of [["base", ""], ["locals", "locals/"]]) {
      for (const [inputLanguage, filename] of fixtures) {
        const source = await readFile(new URL(`fixtures/${directory}${filename}`, import.meta.url), "utf8")
        const module = parse({filename, language: inputLanguage, source})

        for (const outputLanguage of Object.keys(expected[profile])) {
          const code = generate({language: outputLanguage, module})

          assert.equal(createHash("sha256").update(code).digest("hex"), expected[profile][outputLanguage])
          assert.equal(generateArtifact({language: outputLanguage, module}).code, code)
        }
      }
    }
  })
})
