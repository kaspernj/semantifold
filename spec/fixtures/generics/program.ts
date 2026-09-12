class Batch<T> {
  constructor(readonly values: ReadonlyArray<T>) {}
}

class Box<T> {
  constructor(readonly value: T) {}
}

function identity<T>(value: T): T {
  return value
}

function passthrough<T>(batch: Batch<T>): Batch<T> {
  return batch
}

function choose<T, U>(left: T, _right: U): T {
  return left
}

function same<T>(left: T, _right: T): T {
  return left
}

const batch: Batch<string> = new Batch<string>(["first", "second"])
const box: Box<string> = new Box<string>("ready")
console.log(identity(box).value)
console.log(passthrough(batch).values.length)
console.log(choose("left", 1))
console.log(same(2, 3))
