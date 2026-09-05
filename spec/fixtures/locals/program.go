package main

import "fmt"

func choose(flag bool, fallback string) string {
	// @semantifold-immutable
	var preferred string = "yes"
	var result string = fallback
	if flag {
		result = preferred
		return result
	} else {
		return result
	}
}

func main() {
	var output string = "no"
	output = choose(true, output)
	fmt.Println(output)
}
