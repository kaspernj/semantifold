// @ts-check

/**
 * Returns a fresh caller-owned Task 034 conformance authority input.
 * @returns {import("../../src/semantic/types.js").CapabilityAuthorityInput} Authority input.
 */
export function task034AuthorityInput() {
  return {
    capabilities: [{
      failures: [
        {name: "ProbeOperationFailure"},
        {name: "ProbeAcquireFailure"},
        {name: "ProbeReadFailure"},
        {name: "ProbeCloseFailure"},
        {name: "ProbeResourceClosed"}
      ],
      name: "ResourceProbe",
      operations: [
        operation("probeEffect", [parameter("label", "string"), parameter("value", "integer"), parameter("fail", "boolean")],
          "integer", ["ProbeOperationFailure"], {kind: "none"}),
        operation("probeAcquire", [parameter("fail", "boolean")], {kind: "OwnedResourceType", resource: "ProbeResource"},
          ["ProbeAcquireFailure"], {kind: "acquire", resource: "ProbeResource"}),
        operation("probeRead", [parameter("resource", {kind: "OwnedResourceType", resource: "ProbeResource"}),
          parameter("fail", "boolean")], {kind: "OptionalType", valueType: "string"},
        ["ProbeReadFailure", "ProbeResourceClosed"], {kind: "borrow", parameterIndex: 0, terminalFailure: "ProbeResourceClosed"}),
        operation("probeClose", [parameter("resource", {kind: "OwnedResourceType", resource: "ProbeResource"}),
          parameter("fail", "boolean")], "void", ["ProbeCloseFailure", "ProbeResourceClosed"],
        {kind: "close", parameterIndex: 0, terminalFailure: "ProbeResourceClosed"}),
        operation("probeTrace", [], "string", [], {kind: "none"})
      ],
      resources: [{name: "ProbeResource"}]
    }],
    id: "semantifold.task034.resource-probe",
    schema: "SemantifoldCapabilityAuthority",
    schemaVersion: 1
  }
}

function operation(name, parameters, returnType, failures, resourceFlow) {
  return {effects: ["host"], failures, name, parameters, resourceFlow, returnType}
}

function parameter(name, type) {
  return {name, type}
}
