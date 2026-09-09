func difference(_ left: Int64, _ right: Int64) -> Int64 {
  if left > right {
    return left - right
  } else {
    return right - left
  }
}

print(difference(4, 9))
