// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {SemantifoldDiagnostic} from "../index.js"
import {createCapabilityAuthority} from "../src/semantic/capabilities.js"
import {listStdlibModules, protectedEntryName, resolveStdlibModule} from "../src/semantic/stdlib.js"
import {listStdlibProviders} from "../src/stdlib-providers.js"
import {negotiateStdlibProviders} from "../src/stdlib-negotiation.js"
import {task037AuthorityInput, task037Modules} from "./support/task037-authority.js"

const byteStream = {module: task037Modules.resource, name: "ByteStream"}
const resourceClosed = {module: task037Modules.resource, name: "ResourceClosed"}

describe("blocking TCP canonical stdlib contracts", () => {
  it("registers four exact immutable v1 contracts with qualified shared declarations", () => {
    expect(listStdlibModules().map(({identity}) => identity)).toEqual([
      "semantifold.task034.resource-probe",
      task037Modules.socketClient,
      task037Modules.textStream,
      task037Modules.output,
      task037Modules.resource
    ])

    const socket = resolveStdlibModule(task037Modules.socketClient, "1")
    const text = resolveStdlibModule(task037Modules.textStream, "1")
    const output = resolveStdlibModule(task037Modules.output, "1")
    const resource = resolveStdlibModule(task037Modules.resource, "1")

    expect(socket.dependencies).toEqual([{module: task037Modules.resource, range: {lower: [1, 0, 0], upper: [2, 0, 0]}}])
    expect(socket.operations).toEqual([{
      dependencies: [],
      effects: ["host"],
      evaluationOrder: "left-to-right",
      failures: ["InvalidHost", "InvalidPort", "ConnectionFailure"],
      name: "v1_connect",
      parameters: [{name: "host", type: "string"}, {name: "port", type: "integer"}],
      resourceFlow: {kind: "acquire", resource: byteStream},
      returnType: byteStream,
      semantics: semantics({ownership: "acquired"})
    }])
    expect(text.dependencies).toEqual([{module: task037Modules.resource, range: {lower: [1, 0, 0], upper: [2, 0, 0]}}])
    expect(text.operations[0]).toEqual({
      dependencies: [],
      effects: ["host"],
      evaluationOrder: "left-to-right",
      failures: ["ReadFailure", "DecodeFailure", resourceClosed],
      name: "v1_read_line",
      parameters: [{name: "resource", type: byteStream}],
      resourceFlow: {kind: "borrow", parameterIndex: 0, terminalFailure: resourceClosed},
      returnType: "optional:string",
      semantics: semantics({
        close: "use-after-close-fails",
        encoding: "utf-8",
        eof: "absent-value",
        newline: "retain-line-terminator",
        ownership: "borrowed"
      })
    })
    expect(output.operations[0]).toEqual({
      dependencies: [], effects: ["host"], evaluationOrder: "left-to-right", failures: ["WriteFailure"],
      name: "v1_write_line", parameters: [{name: "text", type: "string"}], resourceFlow: {kind: "none"},
      returnType: "void", semantics: semantics({encoding: "utf-8", newline: "append-lf-if-missing"})
    })
    expect(resource.resources).toEqual([{name: "ByteStream"}])
    expect(resource.failures).toEqual([{name: "CloseFailure"}, {name: "ResourceClosed"}])
    expect(resource.operations[0].resourceFlow).toEqual({kind: "close", parameterIndex: 0, terminalFailure: "ResourceClosed"})
    expect(Object.isFrozen(socket.dependencies[0].range.lower)).toBe(true)
  })

  it("normalizes the strict schema-v2 authority without weakening schema v1", () => {
    const authority = createCapabilityAuthority(task037AuthorityInput())

    expect(authority.schemaVersion).toEqual(2)
    expect(authority.modules.map(({identity}) => identity)).toEqual([
      task037Modules.socketClient, task037Modules.textStream, task037Modules.output, task037Modules.resource
    ])
    expect(authority.capabilities.map(({authorityId, name}) => ({authorityId, name}))).toEqual([
      {authorityId: task037Modules.socketClient, name: "SocketClient"},
      {authorityId: task037Modules.textStream, name: "TextStream"},
      {authorityId: task037Modules.output, name: "Output"},
      {authorityId: task037Modules.resource, name: "Resource"}
    ])
    const resourceId = authority.capabilities[3].resources[0].id
    const closedId = authority.capabilities[3].failures[1].id

    expect(authority.capabilities[0].operations[0].returnType).toEqual({kind: "OwnedResourceType", resourceId})
    expect(authority.capabilities[1].operations[0].failureIds[2]).toEqual(closedId)
    expect(authority.capabilities[1].operations[0].resourceFlow.terminalFailureId).toEqual(closedId)
    expect(Object.isFrozen(authority.modules)).toBe(true)

    const mixed = {...task037AuthorityInput(), capabilities: []}
    assert.throws(() => createCapabilityAuthority(mixed), invalidAuthority)
    const unqualified = task037AuthorityInput()
    unqualified.modules[1].capabilities[0].operations[0].parameters[0].type.resource = "ByteStream"
    assert.throws(() => createCapabilityAuthority(unqualified), invalidAuthority)
  })

  it("registers only PHP providers for the new contracts with exact runtime profiles", () => {
    const task037Providers = listStdlibProviders().filter(({provides}) => Object.values(task037Modules).includes(provides[0].module))

    expect(task037Providers.map(({target, provides}) => [target, provides[0].module])).toEqual([
      ["php", task037Modules.resource],
      ["php", task037Modules.socketClient],
      ["php", task037Modules.textStream],
      ["php", task037Modules.output]
    ])
    for (const provider of task037Providers) expect(provider.runtimeProfile).toEqual("php82-core-streams-v1")
    expect(task037Providers[1].dependencies).toEqual([{module: task037Modules.resource, range: "1"}])
    expect(task037Providers[2].dependencies).toEqual([{module: task037Modules.resource, range: "1"}])
  })

  it("negotiates the complete canonical and provider closure including a type-only carrier", () => {
    const full = negotiateStdlibProviders({
      requirements: [
        {module: task037Modules.socketClient, operations: ["v1_connect"]},
        {module: task037Modules.textStream, operations: ["v1_read_line"]},
        {module: task037Modules.output, operations: ["v1_write_line"]}
      ],
      target: "php"
    })

    expect(full.modules).toEqual([
      {identity: task037Modules.output, operations: ["v1_write_line"], version: "1.0.0"},
      {identity: task037Modules.resource, operations: [], version: "1.0.0"},
      {identity: task037Modules.socketClient, operations: ["v1_connect"], version: "1.0.0"},
      {identity: task037Modules.textStream, operations: ["v1_read_line"], version: "1.0.0"}
    ])
    expect(full.providers.map(({module, operations}) => ({module, operations}))).toEqual([
      {module: task037Modules.output, operations: ["v1_write_line"]},
      {module: task037Modules.resource, operations: []},
      {module: task037Modules.socketClient, operations: ["v1_connect"]},
      {module: task037Modules.textStream, operations: ["v1_read_line"]}
    ])
    assert.throws(
      () => negotiateStdlibProviders({requirements: [{module: task037Modules.output, operations: ["v1_write_line"]}], target: "ruby"}),
      (error) => error instanceof SemantifoldDiagnostic && error.code == "STDLIB_PROVIDER_MISSING"
    )
  })

  it("derives reversible module-qualified protected names without punctuation collisions", () => {
    const dash = protectedEntryName("php", "example.a-b", "v1_close")
    const dot = protectedEntryName("php", "example.a.b", "v1_close")

    expect(dash == dot).toBe(false)
    expect(protectedEntryName("php", task037Modules.resource, "v1_close"))
      .toEqual("__semantifold_provider_php_m40_73656d616e7469666f6c642e7265736f75726365_v1_close")
  })
})

function semantics(overrides = {}) {
  return {
    blocking: "synchronous",
    close: "not-applicable",
    encoding: "not-applicable",
    eof: "not-applicable",
    newline: "not-applicable",
    ownership: "not-applicable",
    timeout: "none",
    ...overrides
  }
}

function invalidAuthority(error) {
  return error instanceof SemantifoldDiagnostic && error.code == "INVALID_CAPABILITY_AUTHORITY"
}
