func select(_ flag: Bool, _ fallback: String) -> String {
  let preferred: String = "yes"
  var result: String = fallback
  if flag {
    result = preferred
    return result
  } else {
    return result
  }
}

var output: String = "no"
output = select(true, output)
print(output)
