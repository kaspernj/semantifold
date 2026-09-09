fun select(flag: Boolean, fallback: String): String {
  val preferred: String = "yes"
  var result: String = fallback
  if (flag) {
    result = preferred
    return result
  } else {
    return result
  }
}

fun main() {
  var output: String = "no"
  output = select(true, output)
  println(output)
}
