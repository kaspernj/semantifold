function passList(values: readonly number[]): readonly number[] {
  return values
}
function passMap(values: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  return values
}
const numbers: readonly number[] = [4, 4, 7]
const values: ReadonlyMap<string, number> = new Map([["answer", 42]])
const emptyNumbers: readonly number[] = []
const emptyValues: ReadonlyMap<string, number> = new Map([])
const nested: ReadonlyArray<ReadonlyArray<number>> = [[1, 2], [3]]
console.log(numbers[0])
console.log(numbers[1])
console.log(numbers[2])
console.log(values.get("answer"))
console.log(numbers.length)
console.log(values.size)
console.log(nested[1][0])
console.log(passList(numbers).length)
console.log(passMap(values).size)
