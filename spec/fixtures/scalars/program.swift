func label(_ flag: Bool, _ fallback: String) -> String {
  if flag {
    return "yes"
  } else {
    return fallback
  }
}

print(label(true, "no"))
