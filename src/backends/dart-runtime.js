// @ts-check

export const dartRuntime = `final BigInt _semantifoldMaxSafeInteger = BigInt.from(9007199254740991);
final BigInt _semantifoldMinSafeInteger = BigInt.from(-9007199254740991);

int _semantifoldInteger(BigInt value) {
  if (value < _semantifoldMinSafeInteger || value > _semantifoldMaxSafeInteger) {
    throw RangeError('Semantifold safe integer overflow');
  }
  return value.toInt();
}

int _semantifoldIntegerAdd(int left, int right) {
  return _semantifoldInteger(BigInt.from(left) + BigInt.from(right));
}

int _semantifoldIntegerSubtract(int left, int right) {
  return _semantifoldInteger(BigInt.from(left) - BigInt.from(right));
}

int _semantifoldIntegerMultiply(int left, int right) {
  return _semantifoldInteger(BigInt.from(left) * BigInt.from(right));
}

int _semantifoldIntegerNegate(int value) {
  return _semantifoldInteger(-BigInt.from(value));
}
`
