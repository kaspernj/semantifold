# @param values [Array[Integer]]
# @return [Array[Integer]]
def pass_list(values)
  return values
end

# @param values [Hash[String,Integer]]
# @return [Hash[String,Integer]]
def pass_map(values)
  return values
end

# @type [Array[Integer]]
# @semantifold-immutable
numbers = [4, 4, 7]
# @type [Hash[String,Integer]]
# @semantifold-immutable
values = {"answer" => 42}
# @type [Array[Integer]]
# @semantifold-immutable
empty_numbers = []
# @type [Hash[String,Integer]]
# @semantifold-immutable
empty_values = {}
# @type [Array[Array[Integer]]]
# @semantifold-immutable
nested = [[1, 2], [3]]
puts numbers[0]
puts numbers[1]
puts numbers[2]
puts values.fetch("answer")
puts numbers.size
puts values.size
puts nested[1][0]
puts pass_list(numbers).size
puts pass_map(values).size
