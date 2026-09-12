/**
 * @template T
 */
class Batch {
  /**
   * @param {ReadonlyArray<T>} values
   */
  constructor(values) {
    /** @readonly */
    this.values = values
    Object.freeze(this)
  }
}

/**
 * @template T
 */
class Box {
  /**
   * @param {T} value
   */
  constructor(value) {
    /** @readonly */
    this.value = value
    Object.freeze(this)
  }
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function identity(value) {
  return value
}

/**
 * @template T
 * @param {Batch<T>} batch
 * @returns {Batch<T>}
 */
function passthrough(batch) {
  return batch
}

/**
 * @template T
 * @template U
 * @param {T} left
 * @param {U} _right
 * @returns {T}
 */
function choose(left, _right) {
  return left
}

/**
 * @template T
 * @param {T} left
 * @param {T} _right
 * @returns {T}
 */
function same(left, _right) {
  return left
}

/** @type {Batch<string>} */ const batch = new Batch(["first", "second"])
/** @type {Box<string>} */ const box = new Box("ready")
console.log(identity(box).value)
console.log(passthrough(batch).values.length)
console.log(choose("left", 1))
console.log(same(2, 3))
