package main

import "fmt"

func arithmetic(left int64, right int64) int64 {
	if (left < right) && !(left == right) {
		return -left + right*2
	} else {
		return left - right
	}
}

func ordered(left int64, right int64) bool {
	if (left <= right || left >= right) && left != right {
		return left > right
	} else {
		return left < right
	}
}

func logic(left bool, right bool) bool {
	if (!left || right) && left != right {
		return left == right
	} else {
		return left || right
	}
}

func combine(left string, right string) string {
	if left == right || left != right {
		return left + ":" + right
	} else {
		return left + right
	}
}

func report(left int64, right int64) string {
	if (arithmetic(left, right) == 17 && ordered(right, left)) && !logic(false, true) {
		return combine("typed", "operators")
	} else {
		return "bad"
	}
}

func main() {
	fmt.Println(report(3, 10))
}
