# @param flag [bool]
# @param fallback [String]
# @return [String]
def label(flag, fallback)
  if flag
    return "yes"
  else
    return fallback
  end
end

puts label(true, "no")
