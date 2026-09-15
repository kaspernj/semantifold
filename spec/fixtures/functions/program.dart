int zero() {
  return 0;
}

String passText(String value) {
  return value;
}

int sum3(int first, int second, int third) {
  return first + second + third;
}

int countdown(int value) {
  if (value > 0) {
    return countdown(value - 1);
  }
  return value;
}

void announce(String value) {
  print(value);
}

void noop() {
  return;
}

int nested(int first, int second, int third) {
  return sum3(zero(), sum3(first, second, third), countdown(2));
}

void main() {
  announce(passText("ready"));
  noop();
  print(nested(1, 2, 3));
}
