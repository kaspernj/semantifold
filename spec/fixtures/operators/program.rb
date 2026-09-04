# @param left [Integer]
# @param right [Integer]
# @return [Integer]
def arithmetic(left, right)
  if (left < right) && !(left == right)
    return -left + right * 2
  else
    return left - right
  end
end

# @param left [Integer]
# @param right [Integer]
# @return [bool]
def ordered(left, right)
  if (left <= right || left >= right) && left != right
    return left > right
  else
    return left < right
  end
end

# @param left [bool]
# @param right [bool]
# @return [bool]
def logic(left, right)
  if (!left || right) && left != right
    return left == right
  else
    return left || right
  end
end

# @param left [String]
# @param right [String]
# @return [String]
def combine(left, right)
  if left == right || left != right
    return left + ":" + right
  else
    return left + right
  end
end

# @param left [Integer]
# @param right [Integer]
# @return [String]
def report(left, right)
  if (arithmetic(left, right) == 17 && ordered(right, left)) && !logic(false, true)
    return combine("typed", "operators")
  else
    return "bad"
  end
end

puts report(3, 10)
