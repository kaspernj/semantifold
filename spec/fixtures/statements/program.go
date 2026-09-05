package main

import "fmt"

func choose(flag bool, fallback string) string {
	var result string = fallback
	if flag {
		result = "yes"
		fmt.Println("checking")
		if fallback == "alt" {
			return fallback
		} else if fallback == "no" {
			return result
		} else {
			return "other"
		}
	}
	return result
}

func main() {
	var output string = choose(true, "no")
	fmt.Println(output)
	if output == "yes" {
		fmt.Println("matched")
	}
	output = choose(false, "fallback")
	fmt.Println(output)
}
