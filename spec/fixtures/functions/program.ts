function zero(): number {
  return 0
}

function passText(value: string): string {
  return value
}

function sum3(first: number, second: number, third: number): number {
  return first + second + third
}

function countdown(value: number): number {
  if (value > 0) return countdown(value - 1)
  return value
}

function announce(value: string): void {
  console.log(value)
}

function noop(): void {
  return
}

function nested(first: number, second: number, third: number): number {
  return sum3(zero(), sum3(first, second, third), countdown(2))
}

announce(passText("ready"))
noop()
console.log(nested(1, 2, 3))
