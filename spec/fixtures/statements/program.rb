# @param flag [bool]
# @param fallback [String]
# @return [String]
def select(flag, fallback)
  # @type [String]
  result = fallback
  if flag
    result = "yes"
    puts "checking"
    if fallback == "alt"
      return fallback
    elsif fallback == "no"
      return result
    else
      return "other"
    end
  end
  return result
end

# @type [String]
output = select(true, "no")
puts output
if output == "yes"
  puts "matched"
end
output = select(false, "fallback")
puts output
