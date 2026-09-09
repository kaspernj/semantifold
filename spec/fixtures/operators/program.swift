func semantifold_string_equal(_ left: String, _ right: String) -> Bool {
  return left.unicodeScalars.elementsEqual(right.unicodeScalars)
}

func semantifold_string_not_equal(_ left: String, _ right: String) -> Bool {
  return !left.unicodeScalars.elementsEqual(right.unicodeScalars)
}

func semantifold_keep_mutable<T>(_ value: inout T) {
}

func arithmetic(_ left: Int64, _ right: Int64) -> Int64 {
  if (left < right) && !(left == right) {
    return -left + right * 2
  } else {
    return left - right
  }
}

func ordered(_ left: Int64, _ right: Int64) -> Bool {
  if ((left <= right) || (left >= right)) && (left != right) {
    return left > right
  } else {
    return left < right
  }
}

func logic(_ left: Bool, _ right: Bool) -> Bool {
  if ((!left || right) && (left != right)) {
    return left == right
  } else {
    return left || right
  }
}

func combine(_ left: String, _ right: String) -> String {
  if semantifold_string_equal(left, right) || semantifold_string_not_equal(left, right) {
    return left + ":" + right
  } else {
    return left + right
  }
}

func report(_ left: Int64, _ right: Int64) -> String {
  if ((arithmetic(left, right) == 17) && ordered(right, left)) && !logic(false, true) {
    return combine("typed", "operators")
  } else {
    return "bad"
  }
}

print(report(3, 10))
