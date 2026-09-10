# @param value [String?]
# @return [String]
def label(value)
  if value.nil?
    return "absent"
  else
    return value
  end
end

# @type [Array[String?]]
# @semantifold-immutable
values = ["list-present", nil]
# @type [Hash[String,String?]]
# @semantifold-immutable
by_name = {"present" => "map-present", "absent" => nil}
puts label(values[0])
puts label(values[1])
puts label(by_name.fetch("present"))
puts label(by_name.fetch("absent"))
