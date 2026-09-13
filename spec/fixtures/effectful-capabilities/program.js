/* global probeAcquire, probeClose, probeTrace */

/**
 * @param {ProbeResource} resource
 * @returns {void}
 */
function consume(resource) {
  probeClose(resource, false)
}

/** @type {ProbeResource} */
const resource = probeAcquire(false)
consume(resource)
console.log(probeTrace())
