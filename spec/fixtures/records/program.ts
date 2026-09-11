class Address {
  constructor(readonly city: string, readonly zip: number) {}
}

class User {
  constructor(
    readonly name: string,
    readonly address: Address,
    readonly tags: ReadonlyArray<string>,
    readonly attributes: ReadonlyMap<string, string>,
    readonly nickname: string | null
  ) {}
}

function pass(user: User): User {
  return user
}

const address: Address = new Address("Paris", 75000)
const user: User = new User("Ada", address, ["admin", "coder"], new Map([["role", "editor"]]), null)
console.log(address.city)
console.log(pass(user).address.zip)
console.log(user.tags.length)
console.log(user.attributes.size)
console.log(user.name)
