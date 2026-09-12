// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {createCapabilityAuthority, parse, SemantifoldDiagnostic} from "../index.js"
import {task034AuthorityInput} from "./support/task034-authority.js"

const authority = createCapabilityAuthority(task034AuthorityInput())

function parseTypeScript(source) {
  return parse({capabilityAuthority: authority, filename: "lifetime.ts", language: "typescript", source})
}

function rejects(code, source) {
  assert.throws(() => parseTypeScript(source), (error) => error instanceof SemantifoldDiagnostic &&
    error.code == code && error.location?.filename == "lifetime.ts")
}

describe("owned resource lifetime validation", () => {
  it("rejects an owned resource that remains open on a reachable scope exit", () => {
    rejects("LEAKED_RESOURCE", `function run(): void {
  const resource: ProbeResource = probeAcquire(false)
}
run()`)
  })

  it("treats a close attempt as terminal on both success and declared close failure", () => {
    const module = parseTypeScript(`function run(): void {
  const resource: ProbeResource = probeAcquire(false)
  probeClose(resource, true)
}
run()`)

    expect(module.functions[0].body.statements[1].expression.resolution.resourceFlow.kind).toBe("close")
  })

  it("keeps a resource open on read failure and requires the exact catch path to close it", () => {
    rejects("LEAKED_RESOURCE", `function run(): void {
  const resource: ProbeResource = probeAcquire(false)
  const value: string | null = probeRead(resource, true)
}
run()`)
    rejects("LEAKED_RESOURCE", `function run(): void {
  const resource: ProbeResource = probeAcquire(false)
  const value: string | null = probeRead(resource, false)
  probeClose(resource, false)
}
run()`)

    const module = parseTypeScript(`function run(): string {
  const resource: ProbeResource = probeAcquire(false)
  try {
    const value: string | null = probeRead(resource, true)
    probeClose(resource, false)
    return "unexpected"
  } catch (error) {
    if (!(error instanceof ProbeReadFailure)) { throw error }
    probeClose(resource, false)
    return error.message
  }
}
console.log(run())`)

    expect(module.functions[0].body.statements[1].kind).toBe("TryStatement")
  })

  it("removes a capability failure caught inside an effectful callee from caller lifetime paths", () => {
    const module = parseTypeScript(`function safeEffect(): void {
  try {
    const value: number = probeEffect("safe", 1, true)
  } catch (error) {
    if (!(error instanceof ProbeOperationFailure)) { throw error }
    return
  }
}
function run(): void {
  const resource: ProbeResource = probeAcquire(false)
  safeEffect()
  probeClose(resource, false)
}
run()`)
    const call = module.functions[1].body.statements[1].expression

    expect(call.effectSiteId).toBe("effect:2")
    expect(call.effects).toEqual(["host"])
    expect(call.failureIds).toEqual([])
  })

  it("normalizes transfer into an owned parameter as an explicit move", () => {
    const module = parseTypeScript(`function consume(resource: ProbeResource): void {
  probeClose(resource, false)
}
function run(): void {
  const resource: ProbeResource = probeAcquire(false)
  consume(resource)
}
run()`)
    const call = module.functions[1].body.statements[1].expression

    expect(call.arguments[0].kind).toBe("OwnedMoveExpression")
    expect(call.arguments[0].type.resourceId).toBe("capability:0/resource:0")
  })

  it("rejects use after transfer and path-dependent close state", () => {
    rejects("USE_AFTER_MOVE", `function consume(resource: ProbeResource): void { probeClose(resource, false) }
function run(): void {
  const resource: ProbeResource = probeAcquire(false)
  consume(resource)
  const value: string | null = probeRead(resource, false)
}
run()`)
    rejects("RESOURCE_STATE_MISMATCH", `function run(closeNow: boolean): void {
  const resource: ProbeResource = probeAcquire(false)
  if (closeNow) { probeClose(resource, false) }
  probeClose(resource, false)
}
run(true)`)
  })

  it("moves ownership through a resource-owning constructor and borrows its receiver for deterministic close", () => {
    const module = parseTypeScript(`class Reader {
  private resource: ProbeResource
  constructor(resource: ProbeResource) { this.resource = resource }
  close(): void { probeClose(this.resource, false) }
}
function createReader(): Reader {
  const resource: ProbeResource = probeAcquire(false)
  return new Reader(resource)
}
function consumeReader(reader: Reader): void { reader.close() }
const reader: Reader = createReader()
consumeReader(reader)`)
    const declaration = module.classes[0]
    const construction = module.functions[0].body.statements[1].expression
    const receiverCall = module.functions[1].body.statements[0].expression
    const wrapperCall = module.entryPoint.body.statements[1].expression

    expect(declaration.ownership).toEqual({fieldId: "class:0:field:0", kind: "ownedResource", resourceId: "capability:0/resource:0"})
    expect(construction.reference.kind).toBe("OwnedReferenceType")
    expect(construction.arguments[0].kind).toBe("OwnedMoveExpression")
    expect(receiverCall.receiver.kind).toBe("OwnedBorrowExpression")
    expect(receiverCall.resolution.resourceFlow).toEqual({
      kind: "terminal", terminalFailureId: "capability:0/failure:4"
    })
    expect(wrapperCall.effectSiteId).toBe("effect:4")
    expect(wrapperCall.effects).toEqual(["host"])
  })

  it("allows an owned method to borrow its private resource while preserving receiver ownership", () => {
    const module = parseTypeScript(`class Reader {
  private resource: ProbeResource
  constructor(resource: ProbeResource) { this.resource = resource }
  read(): void { const value: string | null = probeRead(this.resource, false) }
  close(): void { probeClose(this.resource, false) }
}
function consume(reader: Reader): void {
  try {
    reader.read()
    reader.close()
  } catch (error) {
    if (!(error instanceof ProbeReadFailure)) { throw error }
    reader.close()
  }
}
const resource: ProbeResource = probeAcquire(false)
const reader: Reader = new Reader(resource)
consume(reader)`)
    const readCall = module.functions[0].body.statements[0].body.statements[0].expression

    expect(readCall.receiver.kind).toBe("OwnedBorrowExpression")
    expect(readCall.resolution.resourceFlow).toEqual({
      kind: "preserve", terminalFailureId: "capability:0/failure:4"
    })
  })

  it("moves an owned method parameter while preserving its borrowed receiver", () => {
    const module = parseTypeScript(`class Reader {
  private resource: ProbeResource
  constructor(resource: ProbeResource) { this.resource = resource }
  closeOther(other: ProbeResource): void { probeClose(other, false) }
  close(): void { probeClose(this.resource, false) }
}
function consume(reader: Reader, other: ProbeResource): void {
  try {
    reader.closeOther(other)
  } catch (error) {
    if (!(error instanceof ProbeCloseFailure)) { throw error }
    reader.close()
    return
  }
  reader.close()
}
function run(): void {
  const first: ProbeResource = probeAcquire(false)
  try {
    const second: ProbeResource = probeAcquire(false)
    const reader: Reader = new Reader(first)
    consume(reader, second)
    return
  } catch (error) {
    if (!(error instanceof ProbeAcquireFailure)) { throw error }
    probeClose(first, false)
    return
  }
}
run()`)
    const call = module.functions[0].body.statements[0].body.statements[0].expression

    expect(call.receiver.kind).toBe("OwnedBorrowExpression")
    expect(call.arguments[0].kind).toBe("OwnedMoveExpression")
    expect(call.resolution.resourceFlow).toEqual({kind: "preserve"})
    expect(call.failureIds).toEqual(["capability:0/failure:3"])
  })

  it("diagnoses post-close transfer, borrow escape, and optional absence/failure conflation distinctly", () => {
    rejects("USE_AFTER_CLOSE", `function consume(resource: ProbeResource): void { probeClose(resource, false) }
function run(): void {
  const resource: ProbeResource = probeAcquire(false)
  probeClose(resource, false)
  consume(resource)
}
run()`)
    rejects("BORROW_ESCAPE", `function run(): void {
  const resource: ProbeResource = probeAcquire(false)
  console.log(resource)
  probeClose(resource, false)
}
run()`)
    rejects("FAILURE_ABSENCE_CONFLATION", `function run(): void {
  const resource: ProbeResource = probeAcquire(false)
  const present: boolean = probeRead(resource, false)
  probeClose(resource, false)
}
run()`)
    rejects("RESOURCE_ALIAS", `function hold(resources: readonly ProbeResource[]): void {}
hold([])`)
    rejects("RESOURCE_ALIAS", `function closeBoth(first: ProbeResource, second: ProbeResource): void {
  try {
    probeClose(first, false)
  } catch (error) {
    if (!(error instanceof ProbeCloseFailure)) { throw error }
    probeClose(second, false)
    return
  }
  probeClose(second, false)
}
function run(): void {
  const resource: ProbeResource = probeAcquire(false)
  closeBoth(resource, resource)
}
run()`)
    rejects("INVALID_RESOURCE_TRANSFER", `function consume(resource: ProbeResource): void { probeClose(resource, false) }
class Reader {
  private resource: ProbeResource
  constructor(resource: ProbeResource) { this.resource = resource }
  transferField(): void { consume(this.resource) }
}`)
    rejects("UNSUPPORTED_STATEMENT", `function noop(): void {}
class Reader {
  private resource: ProbeResource
  constructor(resource: ProbeResource) { this.resource = resource }
  readTwice(): void {
    const first: string | null = probeRead(this.resource, false)
    const second: string | null = probeRead(this.resource, false)
  }
}`)
    rejects("UNSUPPORTED_STATEMENT", `function effectValue(): number { return probeEffect("method", 1, false) }
class Reader {
  private resource: ProbeResource
  constructor(resource: ProbeResource) { this.resource = resource }
  indirectEffect(): void { const value: number = effectValue() }
}`)
  })
})
