# @return [Integer]
def zero()
  return 0
end

# @param value [String]
# @return [String]
def passText(value)
  return value
end

# @param first [Integer]
# @param second [Integer]
# @param third [Integer]
# @return [Integer]
def sum3(first, second, third)
  return first + second + third
end

# @param value [Integer]
# @return [Integer]
def countdown(value)
  if value > 0
    return countdown(value - 1)
  end
  return value
end

# @param value [String]
# @return [void]
def announce(value)
  puts value
end

# @return [void]
def noop()
  return
end

# @param first [Integer]
# @param second [Integer]
# @param third [Integer]
# @return [Integer]
def nested(first, second, third)
  return sum3(zero(), sum3(first, second, third), countdown(2))
end

announce(passText("ready"))
noop()
puts nested(1, 2, 3)
