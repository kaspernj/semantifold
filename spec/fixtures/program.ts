function difference(left: number, right: number): number {
  if (left > right) {
    return left - right
  } else {
    return right - left
  }
}

console.log(difference(4, 9))
