function maybe(value: string, present: boolean): string | null {
  if (present) return value
  else return null
}

function label(value: string | null): string {
  if (value !== null) return value
  else return "absent"
}

const presentValue: string | null = maybe("present", true)
const absentValue: string | null = maybe("ignored", false)
console.log(label(presentValue))
console.log(label(absentValue))
