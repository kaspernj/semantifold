function mark(label: string, value: number): number {
  console.log(label)
  return value
}

function flag(label: string, value: boolean): boolean {
  console.log(label)
  return value
}

function piece(label: string, value: string): string {
  console.log(label)
  return value
}

function compute(left: number, right: number): number {
  let result: number = mark("initial-left", left) + mark("initial-right", right)
  result = mark("assign-left", result) - mark("assign-right", right)
  if (flag("test", true)) {
    console.log(mark("print-left", left) * mark("print-right", right))
  }
  if (flag("and-left", false) && (flag("skipped-or-left", true) || flag("skipped-or-right", false))) {
    return right
  }
  return mark("return-left", result) + mark("return-right", right)
}

console.log(compute(mark("arg-left", 3), mark("arg-right", 4)))
console.log(flag("true-and-left", true) && flag("true-and-right", true))
console.log(flag("false-or-left", false) || flag("false-or-right", true))
console.log(flag("true-or-left", true) || flag("skipped-true-or-right", false))
console.log(piece("string-left", "é\u0000") + piece("string-right", "😀"))
