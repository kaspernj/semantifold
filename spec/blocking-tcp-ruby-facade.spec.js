// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {parseProgram, SemantifoldDiagnostic} from "../index.js"
import {inspectRubyModule} from "../src/frontends/ruby.js"
import {listStdlibFacades, resolveStdlibFacade} from "../src/stdlib-facades.js"

describe("blocking TCP Ruby compatibility facades", () => {
  it("registers exact executable socket and builtin output facade identities", () => {
    const socket = resolveStdlibFacade("ruby", "socket", "TCPSocket", "1")
    const output = resolveStdlibFacade("ruby", "ruby:Kernel", "puts", "1")

    expect(socket).toMatchObject({
      identity: "semantifold.task037.ruby.socket",
      nativeModules: [{identity: "socket", kind: "module", symbols: ["TCPSocket"]}],
      publicDeclarations: [{kind: "class", name: "TCPSocket"}],
      requirements: [
        {module: "semantifold.socket-client", operations: ["v1_connect"], range: "1"},
        {module: "semantifold.text-stream", operations: ["v1_read_line"], range: "1"},
        {module: "semantifold.resource", operations: ["v1_close"], range: "1"}
      ],
      runtimeProfile: "ruby-task037-socket-v1",
      source: {id: "semantifold.facade.ruby.socket"}
    })
    expect(output).toMatchObject({
      identity: "semantifold.task037.ruby.output",
      nativeModules: [{forms: ["unqualified-call", "receiver-call"], identity: "ruby:Kernel", kind: "builtin", symbols: ["puts"]}],
      publicDeclarations: [{
        effects: ["host"], failures: ["WriteFailure"], forms: ["unqualified-call", "receiver-call"],
        kind: "function", name: "puts", ownership: "not-applicable",
        parameters: [{name: "text", type: "string"}], returnType: "void"
      }],
      requirements: [{module: "semantifold.output", operations: ["v1_write_line"], range: "1"}],
      runtimeProfile: "ruby-task037-output-v1",
      source: {id: "semantifold.facade.ruby.output"}
    })
    expect(listStdlibFacades()).toHaveLength(17)
    expect(Object.isFrozen(socket.publicDeclarations[0])).toBe(true)
  })

  it("derives the exact socket profile and native call evidence from Prism nodes", () => {
    const header = inspectRubyModule({filename: "main.rb", source: `require "socket"
module Main
  puts "plain"
  Kernel.puts("qualified")
  socket = TCPSocket.new("127.0.0.1", 1234)
end
`})

    expect(header.imports).toMatchObject([{specifier: "socket", stdlibCandidate: true}])
    expect(header.nativeReferences?.map(({form, nativeModule, symbol}) => ({form, nativeModule, symbol}))).toEqual([
      {form: "unqualified-call", nativeModule: "ruby:Kernel", symbol: "puts"},
      {form: "receiver-call", nativeModule: "ruby:Kernel", symbol: "puts"},
      {form: "constructor-call", nativeModule: "socket", symbol: "TCPSocket"}
    ])
    for (const reference of header.nativeReferences ?? []) {
      expect(reference.location.filename).toEqual("main.rb")
      expect(reference.location.end.offset > reference.location.start.offset).toBe(true)
    }
  })

  it("compiles puts-only active profiles through canonical Output without selecting socket", () => {
    for (const call of ['puts "hello"', 'Kernel.puts("hello")']) {
      const program = parseProgram({
        entryModule: "main",
        sources: [{filename: "main.rb", id: "main", language: "ruby", source: `require "socket"
module Main
  ${call}
end
`}]
      })

      expect(program.modules.map(({id}) => id)).toEqual(["semantifold.facade.ruby.output", "main"])
      expect(program.stdlibContracts).toEqual([{contractVersion: "1", identity: "semantifold.output"}])
      expect(program.stdlibContract).toBe(undefined)
      expect(program.modules[0].capabilities?.flatMap(({operations}) => operations.map(({name}) => name))).toEqual(["v1_write_line"])
      expect(program.modules[1].capabilities).toBe(undefined)
      expect(program.modules[1].entryPoint?.body.statements[0]).toMatchObject({
        expression: {callee: call.startsWith("Kernel") ? "Kernel.puts" : "puts", kind: "CallExpression"},
        kind: "ExpressionStatement"
      })
      expect(program.modules.some(({id}) => id.includes("socket"))).toBe(false)
    }
  })

  it("retains legacy PrintStatement behavior outside the exact socket profile", () => {
    const program = parseProgram({
      entryModule: "main",
      sources: [{filename: "main.rb", id: "main", language: "ruby", source: `module Main
  puts "legacy"
end
`}]
    })

    expect(program.modules[0].entryPoint?.body.statements[0].kind).toEqual("PrintStatement")
    expect(program.stdlibFacades).toBe(undefined)
  })

  it("rejects dynamic socket requires and does not grant caller operation authority", () => {
    assert.throws(
      () => parseProgram({entryModule: "main", sources: [{filename: "dynamic.rb", id: "main", language: "ruby",
        source: `name = "socket"
require name
module Main
  puts "x"
end
`}]}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_FACADE_DYNAMIC_REFERENCE" &&
        error.location?.filename == "dynamic.rb"
    )
  })
})
