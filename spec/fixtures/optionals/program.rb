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
def label(value)
  unless value.nil?
    return value
  else
    return "absent"
  end
end

# @type [String?]
# @semantifold-immutable
present_value = maybe("present", true)
# @type [String?]
# @semantifold-immutable
absent_value = maybe("ignored", false)
puts label(present_value)
puts label(absent_value)
