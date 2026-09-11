class ValidationError < StandardError
end

class ProcessingError < StandardError
end

# @param mode [Integer]
# @return [String]
def describe(mode)
  begin
    begin
      if mode == 0
        return "ok"
      end
      if mode == 1
        raise ValidationError, "bad"
      end
      raise ProcessingError, "deep"
    rescue ValidationError => innerError
      return innerError.message
    end
  rescue ProcessingError => outerError
    return outerError.message
  end
end

puts describe(0)
puts describe(1)
puts describe(2)
