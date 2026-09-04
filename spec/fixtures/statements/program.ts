function select(flag: boolean, fallback: string): string {
  let result: string = fallback
  if (flag) {
    result = "yes"
    console.log("checking")
    if (fallback === "alt") {
      return fallback
    } else if (fallback === "no") {
      return result
    } else {
      return "other"
    }
  }
  return result
}

let output: string = select(true, "no")
console.log(output)
if (output === "yes") {
  console.log("matched")
}
output = select(false, "fallback")
console.log(output)
