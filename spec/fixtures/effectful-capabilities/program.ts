function consume(resource: ProbeResource): void {
  probeClose(resource, false)
}

const resource: ProbeResource = probeAcquire(false)
consume(resource)
console.log(probeTrace())
