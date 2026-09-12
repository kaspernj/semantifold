class Counter
  # @param value [Integer]
  def initialize(value)
    @value = value
  end

  # @param delta [Integer]
  # @return [void]
  def add(delta)
    @value = @value + delta
  end

  # @return [Integer]
  def next
    @value = @value + 1
    return @value
  end

  # @return [Integer]
  def current
    return @value
  end

  # @param first [Integer]
  # @param second [Integer]
  # @return [Integer]
  def combine(first, second)
    return @value * 100 + first * 10 + second
  end
end

class Pair
  # @param left [Integer]
  # @param right [Integer]
  def initialize(left, right)
    @left = left
    @right = right
  end

  # @return [Integer]
  def code
    return @left * 100 + @right
  end
end

# @param marker [Counter]
# @param target [Counter]
# @return [Counter]
def choose(marker, target)
  marker.add(10)
  return target
end

# @type [Counter]
# @semantifold-immutable
first = Counter.new(1)
# @type [Counter]
# @semantifold-immutable
second = Counter.new(5)
# @type [Counter]
# @semantifold-immutable
alias_value = first
alias_value.add(2)
puts first.current
puts second.current
# @type [Counter]
# @semantifold-immutable
marker = Counter.new(0)
# @type [Counter]
# @semantifold-immutable
target = Counter.new(1)
puts choose(marker, target).combine(marker.next, marker.next)
# @type [Pair]
# @semantifold-immutable
pair = Pair.new(marker.next, marker.next)
puts pair.code
