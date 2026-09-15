String label(bool flag, String fallback) {
  if (flag) {
    return "yes";
  } else {
    return fallback;
  }
}

void main() {
  print(label(true, "no"));
}
