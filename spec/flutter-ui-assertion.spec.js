// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {assertFlutterUiDump} from "../scripts/flutter-ui-assertion.js"

describe("Flutter emulator UI assertion", () => {
  it("requires one exact labelled Unicode output node and rejects partial or ambiguous dumps", () => {
    const output = "hé😀\nhé😀!\nhé😀!?"
    const exact = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0"><node text="hé😀&#10;hé😀!&#10;hé😀!?" content-desc="semantifold-output" /></hierarchy>`

    expect(assertFlutterUiDump(exact, output)).toEqual({label: "semantifold-output", output})
    assert.throws(() => assertFlutterUiDump(exact.replace("!?", "!"), output), /exact labelled Flutter output/u)
    assert.throws(() => assertFlutterUiDump(`${exact}${exact}`, output), /exact labelled Flutter output/u)
    assert.throws(() => assertFlutterUiDump(exact.replace("semantifold-output", "other"), output),
      /exact labelled Flutter output/u)
    const combined = `<hierarchy><node text="" content-desc="semantifold-output&#10;hé😀&#10;hé😀!&#10;hé😀!?" /></hierarchy>`

    expect(assertFlutterUiDump(combined, output)).toEqual({label: "semantifold-output", output})
    assert.throws(() => assertFlutterUiDump(`${combined}${exact}`, output), /exact labelled Flutter output/u)
  })
})
