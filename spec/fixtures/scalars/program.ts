function label(flag: boolean, fallback: string): string {
  if (flag) {
    return "yes"
  } else {
    return fallback
  }
}

console.log(label(true, "no"))
