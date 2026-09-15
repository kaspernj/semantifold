int arithmetic(int left, int right) {
  if ((left < right) && !(left == right)) {
    return -left + right * 2;
  } else {
    return left - right;
  }
}

bool ordered(int left, int right) {
  if (((left <= right) || (left >= right)) && (left != right)) {
    return left > right;
  } else {
    return left < right;
  }
}

bool logic(bool left, bool right) {
  if (((!left || right) && (left != right))) {
    return left == right;
  } else {
    return left || right;
  }
}

String combine(String left, String right) {
  if ((left == right) || (left != right)) {
    return left + ":" + right;
  } else {
    return left + right;
  }
}

String report(int left, int right) {
  if (((arithmetic(left, right) == 17) && ordered(right, left)) && !logic(false, true)) {
    return combine("typed", "operators");
  } else {
    return "bad";
  }
}

void main() {
  print(report(3, 10));
}
