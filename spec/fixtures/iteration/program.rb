# @param values [Array[Integer]]
# @return [Array[Integer]]
def pass_list(values)
  return values
end

# @param values [Array[Integer]]
# @return [Integer]
def ordered_total(values)
  # @type [Integer]
  total = 0
  pass_list(values).each do |value|
    if value < 5
      if value == 2
        next
      end
      total = total + value
    else
      if value == 5
        break
      end
    end
  end
  return total
end

# @type [Array[Integer]]
# @semantifold-immutable
values = [1, 2, 3, 5, 8]
puts ordered_total(values)
