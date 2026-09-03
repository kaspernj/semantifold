function select(flag: boolean, fallback: string): string {
  const preferred: string = "yes"
  let result: string = fallback
  if (flag) {
    result = preferred
    return result
  } else {
    return result
  }
}

let output: string = "no"
output = select(true, output)
console.log(output)
