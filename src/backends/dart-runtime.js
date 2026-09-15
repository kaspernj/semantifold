// @ts-check

export const dartRuntime = `final BigInt _semantifoldMaxSafeInteger = BigInt.from(9007199254740991);
final BigInt _semantifoldMinSafeInteger = BigInt.from(-9007199254740991);

int _semantifoldInteger(BigInt value) {
  final _ = _semantifoldIntegerAdd;
  final _ = _semantifoldIntegerSubtract;
  final _ = _semantifoldIntegerMultiply;
  final _ = _semantifoldIntegerNegate;
  final _ = _semantifoldBoolean;
  final _ = _semantifoldUse;
  if (value < _semantifoldMinSafeInteger ||
      value > _semantifoldMaxSafeInteger) {
    throw RangeError('Semantifold safe integer overflow');
  }
  return value.toInt();
}

bool _semantifoldBoolean(bool value) {
  return value;
}

void _semantifoldUse(Object _) {}

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
