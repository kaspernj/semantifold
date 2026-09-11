function zero(): number {
  return 0
}

function identityText(value: string): string {
  return value
}

function sumThree(first: number, second: number, third: number): number {
  return first + second + third
}

function countdown(value: number): number {
  if (value > 0) {
    return countdown(value - 1)
  }
  return value
}

function announce(value: string): void {
  console.log(value)
}

function noop(): void {
  return
}

function maybe(value: string, present: boolean): string | null {
  if (present) {
    return value
  } else {
    return null
  }
}

function optionalLabel(value: string | null): string {
  if (value !== null) {
    return value
  } else {
    return "absent"
  }
}

function branchLabel(value: number, enabled: boolean, prefix: string): string {
  let total: number = value + zero()
  total = total * 2
  const threshold: number = 5
  let label: string = prefix + "fallback"
  if (enabled && total > threshold) {
    label = prefix + "ok"
    if (total !== threshold && (!enabled || enabled)) {
      label = label + "!"
    }
  } else {
    label = label + "!"
  }
  return label
}

function orderedTotal(values: readonly number[]): number {
  let total: number = 0
  for (const item of values) {
    if (item < 5) {
      if (item === 2) {
        continue
      }
      total = total + item
    } else {
      if (item === 5) {
        break
      }
    }
  }
  return total
}

const presentValue: string | null = maybe("present", true)
const absentValue: string | null = maybe("ignored", false)
const values: readonly number[] = [1, 2, 3, 5, 8]
const groups: ReadonlyMap<string, ReadonlyArray<number>> = new Map([["main", [7, 8]], ["spare", [9]]])
const nested: ReadonlyArray<ReadonlyArray<number>> = [[1, 2], [3]]
announce(identityText("compat"))
noop()
console.log(branchLabel(sumThree(countdown(1), 1, 2), true, "branch-"))
console.log(optionalLabel(presentValue))
console.log(optionalLabel(absentValue))
console.log(groups.get("main")[0])
console.log(groups.size)
console.log(nested[1][0])
console.log(values.length)
console.log(orderedTotal(values))
