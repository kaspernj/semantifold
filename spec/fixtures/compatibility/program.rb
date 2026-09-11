# @return [Integer]
def zero()
  return 0
end

# @param value [String]
# @return [String]
def identityText(value)
  return value
end

# @param first [Integer]
# @param second [Integer]
# @param third [Integer]
# @return [Integer]
def sumThree(first, second, third)
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

# @param value [String]
# @param present [bool]
# @return [String?]
def maybe(value, present)
  if present
    return value
  else
    return nil
  end
end

# @param value [String?]
# @return [String]
def optionalLabel(value)
  unless value.nil?
    return value
  else
    return "absent"
  end
end

# @param value [Integer]
# @param enabled [bool]
# @param prefix [String]
# @return [String]
def branchLabel(value, enabled, prefix)
  # @type [Integer]
  total = value + zero()
  total = total * 2
  # @type [Integer]
  # @semantifold-immutable
  threshold = 5
  # @type [String]
  label = prefix + "fallback"
  if enabled && total > threshold
    label = prefix + "ok"
    if total != threshold && (!enabled || enabled)
      label = label + "!"
    end
  else
    label = label + "!"
  end
  return label
end

# @param values [Array[Integer]]
# @return [Integer]
def orderedTotal(values)
  # @type [Integer]
  total = 0
  values.each do |item|
    if item < 5
      if item == 2
        next
      end
      total = total + item
    else
      if item == 5
        break
      end
    end
  end
  return total
end

# @type [String?]
# @semantifold-immutable
presentValue = maybe("present", true)
# @type [String?]
# @semantifold-immutable
absentValue = maybe("ignored", false)
# @type [Array[Integer]]
# @semantifold-immutable
values = [1, 2, 3, 5, 8]
# @type [Hash[String,Array[Integer]]]
# @semantifold-immutable
groups = {"main" => [7, 8], "spare" => [9]}
# @type [Array[Array[Integer]]]
# @semantifold-immutable
nested = [[1, 2], [3]]
announce(identityText("compat"))
noop()
puts branchLabel(sumThree(countdown(1), 1, 2), true, "branch-")
puts optionalLabel(presentValue)
puts optionalLabel(absentValue)
puts groups.fetch("main")[0]
puts groups.size
puts nested[1][0]
puts values.size
puts orderedTotal(values)
