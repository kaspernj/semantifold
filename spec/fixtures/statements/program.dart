String select(bool flag, String fallback) {
  String result = fallback;
  if (flag) {
    result = "yes";
    print("checking");
    if (fallback == "alt") {
      return fallback;
    } else if (fallback == "no") {
      return result;
    } else {
      return "other";
    }
  }
  return result;
}

void main() {
  String output = select(true, "no");
  print(output);
  if (output == "yes") {
    print("matched");
  }
  output = select(false, "fallback");
  print(output);
}
