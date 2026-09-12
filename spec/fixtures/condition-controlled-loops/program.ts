function probe(value: number, limit: number): boolean {
  console.log(value)
  return value < limit
}

function advance(start: number, limit: number): number {
  let value: number = start
  while (probe(value, limit)) {
    value = value + 1
  }
  return value
}

function nested(limit: number): number {
  let outer: number = 0
  let total: number = 0
  while (outer < limit) {
    outer = outer + 1
    let inner: number = 0
    while (inner < 4) {
      inner = inner + 1
      if (inner === 2) {
        continue
      }
      total = total + 1
      if (inner === 3) {
        break
      }
    }
  }
  return total
}

function returnFromLoop(value: number, flag: boolean): number {
  while (flag) {
    return value
  }
  return value + 1
}

console.log(advance(0, 0))
console.log(advance(0, 1))
console.log(advance(0, 3))
console.log(nested(3))
console.log(returnFromLoop(7, true))
console.log(returnFromLoop(7, false))
