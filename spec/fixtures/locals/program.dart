String select(bool flag, String fallback) {
  final String preferred = "yes";
  String result = fallback;
  if (flag) {
    result = preferred;
    return result;
  } else {
    return result;
  }
}

void main() {
  String output = "no";
  output = select(true, output);
  print(output);
}
