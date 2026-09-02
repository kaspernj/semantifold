# @param left [Integer]
# @param right [Integer]
# @return [Integer]
def difference(left, right)
  if left > right
    return left - right
  else
    return right - left
  end
end

puts difference(4, 9)
