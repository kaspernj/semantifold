# @param resource [ProbeResource]
# @return [void]
def consume(resource)
  probeClose(resource, false)
end

# @type [ProbeResource]
# @semantifold-immutable
resource = probeAcquire(false)
consume(resource)
puts probeTrace
