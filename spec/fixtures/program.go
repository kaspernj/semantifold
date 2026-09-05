package main

import "fmt"

func difference(left int64, right int64) int64 {
	if left > right {
		return left - right
	} else {
		return right - left
	}
}

func main() {
	fmt.Println(difference(4, 9))
}
