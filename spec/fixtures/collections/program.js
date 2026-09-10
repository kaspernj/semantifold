/**
 * @param {ReadonlyArray<number>} values
 * @returns {ReadonlyArray<number>}
 */
function passList(values) {
  return values
}
/**
 * @param {ReadonlyMap<string, number>} values
 * @returns {ReadonlyMap<string, number>}
 */
function passMap(values) {
  return values
}
/** @type {ReadonlyArray<number>} */ const numbers = [4, 4, 7]
/** @type {ReadonlyMap<string, number>} */ const values = new Map([["answer", 42]])
/** @type {ReadonlyArray<number>} */ const _emptyNumbers = []
/** @type {ReadonlyMap<string, number>} */ const _emptyValues = new Map([])
/** @type {ReadonlyArray<ReadonlyArray<number>>} */ const nested = [[1, 2], [3]]
console.log(numbers[0])
console.log(numbers[1])
console.log(numbers[2])
console.log(values.get("answer"))
console.log(numbers.length)
console.log(values.size)
console.log(nested[1][0])
console.log(passList(numbers).length)
console.log(passMap(values).size)
