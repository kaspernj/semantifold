# @param value [Integer]
# @return [Integer]
def identity(value)
  return value
end

# @type [Hash[String,Integer]]
# @semantifold-immutable
values = {"b" => 2, "a" => 1, "c" => 3}
puts values.size
puts values.fetch("b")
values.each do |key, value|
  if key == "a"
    next
  end
  puts key
  puts identity(value)
  if key == "c"
    break
  end
end
