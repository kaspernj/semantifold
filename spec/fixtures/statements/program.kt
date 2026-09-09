fun select(flag: Boolean, fallback: String): String {
  var result: String = fallback
  if (flag) {
    result = "yes"
    println("checking")
    if (fallback == "alt") {
      return fallback
    } else if (fallback == "no") {
      return result
    } else {
      return "other"
    }
  }
  return result
}

fun main() {
  var output: String = select(true, "no")
  println(output)
  if (output == "yes") {
    println("matched")
  }
  output = select(false, "fallback")
  println(output)
}
