package main

import "fmt"

func label(flag bool, fallback string) string {
	if flag {
		return "yes"
	} else {
		return fallback
	}
}

func main() {
	fmt.Println(label(true, "no"))
}
