// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generateProgramArtifactSet, parseProgram} from "../index.js"
import {
  discoverTask037Toolchains,
  executeTask037Client,
  lintTask037PhpArtifacts,
  task037RefusedPort,
  withTask037TcpServer
} from "./support/task037-tcp-harness.js"
import {
  task037ExpectedBytes,
  task037OrderedProgram,
  task037RefusedProgram,
  task037ServerBytes,
  task037TcpProgram
} from "./support/task037-programs.js"

describe("blocking TCP Ruby-to-PHP stdlib runtime slice", () => {
  it("executes the same newline, Unicode, final-line, and EOF behavior through real Ruby and generated PHP", async () => {
    const tools = await discoverTask037Toolchains()
    const ruby = await withTask037TcpServer(task037ServerBytes, async (port) => executeTask037Client({
      entry: "program.rb", executable: tools.ruby.executable, source: task037TcpProgram(port)
    }))
    const php = await withTask037TcpServer(task037ServerBytes, async (port) => {
      const program = parseProgram({entryModule: "main", sources: [{
        filename: "main.rb", id: "main", language: "ruby", source: task037TcpProgram(port)
      }]})
      const semanticKinds = new Set()
      const pending = [program.modules.find(({id}) => id == "main")]

      while (pending.length > 0) {
        const value = pending.pop()

        if (!value || typeof value != "object") continue
        if (!Array.isArray(value) && typeof Reflect.get(value, "kind") == "string") semanticKinds.add(Reflect.get(value, "kind"))
        for (const [key, child] of Object.entries(value)) {
          if (!["location", "provenance", "sourceProvenance"].includes(key) && child && typeof child == "object") pending.push(child)
        }
      }
      expect(semanticKinds.has("WhileStatement")).toBe(true)
      expect([...semanticKinds].some((kind) => String(kind).toLowerCase().includes("tcp"))).toBe(false)
      const first = generateProgramArtifactSet({language: "php", program})
      const second = generateProgramArtifactSet({language: "php", program: parseProgram({entryModule: "main", sources: [{
        filename: "main.rb", id: "main", language: "ruby", source: task037TcpProgram(port)
      }]})})

      assert.deepEqual(second, first)
      await lintTask037PhpArtifacts(first, tools.php82.executable)
      return executeTask037Client({entry: first.entry, executable: tools.php82.executable, set: first})
    })

    expect({accepted: ruby.accepted, stderr: ruby.result.stderr, stdout: ruby.result.stdout}).toEqual({
      accepted: 1, stderr: "", stdout: task037ExpectedBytes
    })
    expect({accepted: php.accepted, stderr: php.result.stderr, stdout: php.result.stdout}).toEqual({
      accepted: 1, stderr: "", stdout: task037ExpectedBytes
    })
  })

  it("normalizes a genuine refused loopback connection without publishing a resource", async () => {
    const tools = await discoverTask037Toolchains()
    const port = await task037RefusedPort()
    const source = task037RefusedProgram(port)
    const set = generateProgramArtifactSet({language: "php", program: parseProgram({entryModule: "main", sources: [{
      filename: "main.rb", id: "main", language: "ruby", source
    }]})})
    const result = await executeTask037Client({entry: set.entry, executable: tools.php82.executable, set})

    expect(result).toEqual({stderr: "", stdout: "connection-failure\n"})
  })

  it("evaluates effectful host and port arguments once from left to right before connecting", async () => {
    const tools = await discoverTask037Toolchains()
    const execution = await withTask037TcpServer(task037ServerBytes, async (port) => {
      const source = task037OrderedProgram(port)
      const program = parseProgram({entryModule: "main", sources: [{filename: "main.rb", id: "main", language: "ruby", source}]})
      const set = generateProgramArtifactSet({language: "php", program})

      return executeTask037Client({entry: set.entry, executable: tools.php82.executable, set})
    })

    expect(execution).toEqual({
      accepted: 1,
      result: {stderr: "", stdout: `host\nport\n${task037ExpectedBytes}`}
    })
  })

  it("reports real invalid TCP bytes as DecodeFailure and emits no replacement output", async () => {
    const tools = await discoverTask037Toolchains()
    const execution = await withTask037TcpServer(Uint8Array.from([0xc3, 0x28]), async (port) => {
      const source = task037TcpProgram(port)
      const program = parseProgram({entryModule: "main", sources: [{filename: "main.rb", id: "main", language: "ruby", source}]})
      const set = generateProgramArtifactSet({language: "php", program})

      return executeTask037Client({entry: set.entry, executable: tools.php82.executable, set})
    })

    expect(execution).toEqual({accepted: 1, result: {stderr: "", stdout: ""}})
  })

  it("executes the exact Kernel.puts spelling through the same canonical Output provider", async () => {
    const tools = await discoverTask037Toolchains()
    const execution = await withTask037TcpServer(task037ServerBytes, async (port) => {
      const source = task037TcpProgram(port, true)
      const set = generateProgramArtifactSet({language: "php", program: parseProgram({entryModule: "main", sources: [{
        filename: "main.rb", id: "main", language: "ruby", source
      }]})})

      return executeTask037Client({entry: set.entry, executable: tools.php82.executable, set})
    })

    expect(execution).toEqual({accepted: 1, result: {stderr: "", stdout: task037ExpectedBytes}})
  })
})
