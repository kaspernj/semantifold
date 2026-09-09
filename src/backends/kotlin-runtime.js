// @ts-check

/** Exact target-only checked arithmetic support for Semantifold safe integers. */
export const kotlinRuntime = `private const val SEMANTIFOLD_MAX_SAFE_INTEGER: Long = 9007199254740991L
private const val SEMANTIFOLD_MIN_SAFE_INTEGER: Long = -9007199254740991L

private fun semantifold_integer(value: Long): Long {
  if (value < SEMANTIFOLD_MIN_SAFE_INTEGER || value > SEMANTIFOLD_MAX_SAFE_INTEGER) {
    throw ArithmeticException("Semantifold safe integer overflow")
  }
  return value
}

private fun semantifold_integer_add(left: Long, right: Long): Long {
  return semantifold_integer(Math.addExact(left, right))
}

private fun semantifold_integer_subtract(left: Long, right: Long): Long {
  return semantifold_integer(Math.subtractExact(left, right))
}

private fun semantifold_integer_multiply(left: Long, right: Long): Long {
  return semantifold_integer(Math.multiplyExact(left, right))
}

private fun semantifold_integer_negate(value: Long): Long {
  return semantifold_integer(Math.negateExact(value))
}
`
