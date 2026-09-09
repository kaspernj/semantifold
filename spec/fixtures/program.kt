fun difference(left: Long, right: Long): Long {
  if (left > right) {
    return left - right
  } else {
    return right - left
  }
}

fun main() {
  println(difference(4, 9))
}
