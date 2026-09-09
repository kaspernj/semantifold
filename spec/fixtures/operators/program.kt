fun arithmetic(left: Long, right: Long): Long {
  if ((left < right) && !(left == right)) {
    return -left + right * 2
  } else {
    return left - right
  }
}

fun ordered(left: Long, right: Long): Boolean {
  if (((left <= right) || (left >= right)) && (left != right)) {
    return left > right
  } else {
    return left < right
  }
}

fun logic(left: Boolean, right: Boolean): Boolean {
  if (((!left || right) && (left != right))) {
    return left == right
  } else {
    return left || right
  }
}

fun combine(left: String, right: String): String {
  if ((left == right) || (left != right)) {
    return left + ":" + right
  } else {
    return left + right
  }
}

fun report(left: Long, right: Long): String {
  if (((arithmetic(left, right) == 17L) && ordered(right, left)) && !logic(false, true)) {
    return combine("typed", "operators")
  } else {
    return "bad"
  }
}

fun main() {
  println(report(3, 10))
}
