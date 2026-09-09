func semantifold_string_equal(_ left: String, _ right: String) -> Bool {
  return left.unicodeScalars.elementsEqual(right.unicodeScalars)
}

func semantifold_string_not_equal(_ left: String, _ right: String) -> Bool {
  return !left.unicodeScalars.elementsEqual(right.unicodeScalars)
}

func semantifold_keep_mutable<T>(_ value: inout T) {
}

func select(_ flag: Bool, _ fallback: String) -> String {
  var result: String = fallback
  if flag {
    result = "yes"
    print("checking")
    if semantifold_string_equal(fallback, "alt") {
      return fallback
    } else if semantifold_string_equal(fallback, "no") {
      return result
    } else {
      return "other"
    }
  }
  return result
}

var output: String = select(true, "no")
print(output)
if semantifold_string_equal(output, "yes") {
  print("matched")
}
output = select(false, "fallback")
print(output)
