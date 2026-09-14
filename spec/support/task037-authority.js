// @ts-check

export const task037Modules = Object.freeze({
  output: "semantifold.output",
  resource: "semantifold.resource",
  socketClient: "semantifold.socket-client",
  textStream: "semantifold.text-stream"
})

/**
 * Returns a fresh caller-owned Task 037 multi-module authority input.
 * @returns {import("../../src/semantic/types.js").CapabilityAuthorityInput} Authority input.
 */
export function task037AuthorityInput() {
  const byteStream = reference(task037Modules.resource, "ByteStream")
  const resourceClosed = reference(task037Modules.resource, "ResourceClosed")

  return {
    id: "semantifold.task037.blocking-tcp",
    modules: [
      moduleInput(task037Modules.socketClient, [{
        failures: [{name: "InvalidHost"}, {name: "InvalidPort"}, {name: "ConnectionFailure"}],
        name: "SocketClient",
        operations: [operation(
          "v1_connect",
          [parameter("host", "string"), parameter("port", "integer")],
          {kind: "OwnedResourceType", resource: byteStream},
          ["InvalidHost", "InvalidPort", "ConnectionFailure"],
          {kind: "acquire", resource: byteStream}
        )],
        resources: []
      }]),
      moduleInput(task037Modules.textStream, [{
        failures: [{name: "ReadFailure"}, {name: "DecodeFailure"}],
        name: "TextStream",
        operations: [operation(
          "v1_read_line",
          [parameter("resource", {kind: "OwnedResourceType", resource: byteStream})],
          {kind: "OptionalType", valueType: "string"},
          ["ReadFailure", "DecodeFailure", resourceClosed],
          {kind: "borrow", parameterIndex: 0, terminalFailure: resourceClosed}
        )],
        resources: []
      }]),
      moduleInput(task037Modules.output, [{
        failures: [{name: "WriteFailure"}],
        name: "Output",
        operations: [operation("v1_write_line", [parameter("text", "string")], "void", ["WriteFailure"], {kind: "none"})],
        resources: []
      }]),
      moduleInput(task037Modules.resource, [{
        failures: [{name: "CloseFailure"}, {name: "ResourceClosed"}],
        name: "Resource",
        operations: [operation(
          "v1_close",
          [parameter("resource", {kind: "OwnedResourceType", resource: "ByteStream"})],
          "void",
          ["CloseFailure", "ResourceClosed"],
          {kind: "close", parameterIndex: 0, terminalFailure: "ResourceClosed"}
        )],
        resources: [{name: "ByteStream"}]
      }])
    ],
    schema: "SemantifoldCapabilityAuthority",
    schemaVersion: 2
  }
}

function moduleInput(identity, capabilities) {
  return {capabilities, contractVersion: "1", identity}
}

function operation(name, parameters, returnType, failures, resourceFlow) {
  return {effects: ["host"], failures, name, parameters, resourceFlow, returnType}
}

function parameter(name, type) {
  return {name, type}
}

function reference(module, name) {
  return {module, name}
}
