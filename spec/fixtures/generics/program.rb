# @template T
class Batch
  # @type [Array[T]]
  attr_reader :values

  # @param values [Array[T]]
  def initialize(values)
    @values = values
    freeze
  end
end

# @template T
class Box
  # @type [T]
  attr_reader :value

  # @param value [T]
  def initialize(value)
    @value = value
    freeze
  end
end

# @template T
# @param value [T]
# @return [T]
def identity(value)
  return value
end

# @template T
# @param batch [Batch[T]]
# @return [Batch[T]]
def passthrough(batch)
  return batch
end

# @template T
# @template U
# @param left [T]
# @param _right [U]
# @return [T]
def choose(left, _right)
  return left
end

# @template T
# @param left [T]
# @param _right [T]
# @return [T]
def same(left, _right)
  return left
end

# @type [Batch[String]]
# @semantifold-immutable
batch = Batch.new(["first", "second"])
# @type [Box[String]]
# @semantifold-immutable
box = Box.new("ready")
puts identity(box).value
puts passthrough(batch).values.size
puts choose("left", 1)
puts same(2, 3)
