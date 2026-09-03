# @param flag [bool]
# @param fallback [String]
# @return [String]
def select(flag, fallback)
  # @type [String]
  # @semantifold-immutable
  preferred = "yes"
  # @type [String]
  result = fallback
  if flag
    result = preferred
    return result
  else
    return result
  end
end

# @type [String]
output = "no"
output = select(true, output)
puts output
