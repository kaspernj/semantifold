class Counter {
  private value: number

  constructor(value: number) {
    this.value = value
  }

  add(delta: number): void {
    this.value = this.value + delta
  }

  next(): number {
    this.value = this.value + 1
    return this.value
  }

  current(): number {
    return this.value
  }

  combine(first: number, second: number): number {
    return this.value * 100 + first * 10 + second
  }
}

class Pair {
  private left: number
  private right: number

  constructor(left: number, right: number) {
    this.left = left
    this.right = right
  }

  code(): number {
    return this.left * 100 + this.right
  }
}

function choose(marker: Counter, target: Counter): Counter {
  marker.add(10)
  return target
}

const first: Counter = new Counter(1)
const second: Counter = new Counter(5)
const alias_value: Counter = first
alias_value.add(2)
console.log(first.current())
console.log(second.current())
const marker: Counter = new Counter(0)
const target: Counter = new Counter(1)
console.log(choose(marker, target).combine(marker.next(), marker.next()))
const pair: Pair = new Pair(marker.next(), marker.next())
console.log(pair.code())
