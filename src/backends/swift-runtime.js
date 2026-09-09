// @ts-check

/** Exact target-only support for Unicode-scalar string equality. */
export const swiftRuntime = `func semantifold_string_equal(_ left: String, _ right: String) -> Bool {
  return left.unicodeScalars.elementsEqual(right.unicodeScalars)
}

func semantifold_string_not_equal(_ left: String, _ right: String) -> Bool {
  return !left.unicodeScalars.elementsEqual(right.unicodeScalars)
}

func semantifold_keep_mutable<T>(_ value: inout T) {
}
`
