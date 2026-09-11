class Address
  # @type [String]
  attr_reader :city
  # @type [Integer]
  attr_reader :zip

  # @param city [String]
  # @param zip [Integer]
  def initialize(city, zip)
    @city = city
    @zip = zip
    freeze
  end
end

class User
  # @type [String]
  attr_reader :name
  # @type [Address]
  attr_reader :address
  # @type [Array[String]]
  attr_reader :tags
  # @type [Hash[String,String]]
  attr_reader :attributes
  # @type [String?]
  attr_reader :nickname

  # @param name [String]
  # @param address [Address]
  # @param tags [Array[String]]
  # @param attributes [Hash[String,String]]
  # @param nickname [String?]
  def initialize(name, address, tags, attributes, nickname)
    @name = name
    @address = address
    @tags = tags
    @attributes = attributes
    @nickname = nickname
    freeze
  end
end

# @param user [User]
# @return [User]
def pass(user)
  return user
end

# @type [Address]
# @semantifold-immutable
address = Address.new("Paris", 75000)
# @type [User]
# @semantifold-immutable
user = User.new("Ada", address, ["admin", "coder"], {"role" => "editor"}, nil)
puts address.city
puts pass(user).address.zip
puts user.tags.size
puts user.attributes.size
puts user.name
