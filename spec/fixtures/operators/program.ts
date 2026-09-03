function arithmetic(left: number, right: number): number {
  if ((left < right) && !(left === right)) {
    return -left + right * 2
  } else {
    return left - right
  }
}

function ordered(left: number, right: number): boolean {
  if ((left <= right || left >= right) && left !== right) {
    return left > right
  } else {
    return left < right
  }
}

function logic(left: boolean, right: boolean): boolean {
  if ((!left || right) && left !== right) {
    return left === right
  } else {
    return left || right
  }
}

function combine(left: string, right: string): string {
  if (left === right || left !== right) {
    return left + ":" + right
  } else {
    return left + right
  }
}

function report(left: number, right: number): string {
  if ((arithmetic(left, right) === 17 && ordered(right, left)) && !logic(false, true)) {
    return combine("typed", "operators")
  } else {
    return "bad"
  }
}

console.log(report(3, 10))
