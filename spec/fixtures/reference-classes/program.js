class Counter {
  /** @type {number} */
  #value

  /** @param {number} value */
  constructor(value) {
    this.#value = value
  }

  /**
   * @param {number} delta
   * @returns {void}
   */
  add(delta) {
    this.#value = this.#value + delta
  }

  /** @returns {number} */
  next() {
    this.#value = this.#value + 1
    return this.#value
  }

  /** @returns {number} */
  current() {
    return this.#value
  }

  /**
   * @param {number} first
   * @param {number} second
   * @returns {number}
   */
  combine(first, second) {
    return this.#value * 100 + first * 10 + second
  }
}

class Pair {
  /** @type {number} */
  #left
  /** @type {number} */
  #right

  /**
   * @param {number} left
   * @param {number} right
   */
  constructor(left, right) {
    this.#left = left
    this.#right = right
  }

  /** @returns {number} */
  code() {
    return this.#left * 100 + this.#right
  }
}

/**
 * @param {Counter} marker
 * @param {Counter} target
 * @returns {Counter}
 */
function choose(marker, target) {
  marker.add(10)
  return target
}

/** @type {Counter} */
const first = new Counter(1)
/** @type {Counter} */
const second = new Counter(5)
/** @type {Counter} */
const alias_value = first
alias_value.add(2)
console.log(first.current())
console.log(second.current())
/** @type {Counter} */
const marker = new Counter(0)
/** @type {Counter} */
const target = new Counter(1)
console.log(choose(marker, target).combine(marker.next(), marker.next()))
/** @type {Pair} */
const pair = new Pair(marker.next(), marker.next())
console.log(pair.code())
