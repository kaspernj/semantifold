fun label(flag: Boolean, fallback: String): String {
  if (flag) {
    return "yes"
  } else {
    return fallback
  }
}

fun main() {
  println(label(true, "no"))
}
