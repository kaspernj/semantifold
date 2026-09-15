int difference(int left, int right) {
  if (left > right) {
    return left - right;
  } else {
    return right - left;
  }
}

void main() {
  print(difference(4, 9));
}
