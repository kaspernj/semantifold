function label(value: string | null): string {
  if (value !== null) return value
  else return "absent"
}

const values: ReadonlyArray<string | null> = ["list-present", null]
const byName: ReadonlyMap<string, string | null> = new Map([["present", "map-present"], ["absent", null]])
console.log(label(values[0]))
console.log(label(values[1]))
console.log(label(byName.get("present")!))
console.log(label(byName.get("absent")!))
