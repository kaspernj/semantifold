function passList(values: readonly number[]): readonly number[] {
  return values
}
function orderedTotal(values: readonly number[]): number {
  let total: number = 0
  for (const value of passList(values)) {
    if (value < 5) {
      if (value === 2) {
        continue
      }
      total = total + value
    } else {
      if (value === 5) {
        break
      }
    }
  }
  return total
}
const values: readonly number[] = [1, 2, 3, 5, 8]
console.log(orderedTotal(values))
