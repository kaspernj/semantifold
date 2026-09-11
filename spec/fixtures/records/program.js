class Address {
  /**
   * @param {string} city
   * @param {number} zip
   */
  constructor(city, zip) {
    /** @readonly */
    this.city = city
    /** @readonly */
    this.zip = zip
    Object.freeze(this)
  }
}

class User {
  /**
   * @param {string} name
   * @param {Address} address
   * @param {ReadonlyArray<string>} tags
   * @param {ReadonlyMap<string, string>} attributes
   * @param {string|null} nickname
   */
  constructor(name, address, tags, attributes, nickname) {
    /** @readonly */
    this.name = name
    /** @readonly */
    this.address = address
    /** @readonly */
    this.tags = tags
    /** @readonly */
    this.attributes = attributes
    /** @readonly */
    this.nickname = nickname
    Object.freeze(this)
  }
}

/**
 * @param {User} user
 * @returns {User}
 */
function pass(user) {
  return user
}

/** @type {Address} */ const address = new Address("Paris", 75000)
/** @type {User} */ const user = new User("Ada", address, ["admin", "coder"], new Map([["role", "editor"]]), null)
console.log(address.city)
console.log(pass(user).address.zip)
console.log(user.tags.length)
console.log(user.attributes.size)
console.log(user.name)
