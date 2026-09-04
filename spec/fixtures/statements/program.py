def select(flag: bool, fallback: str) -> str:
    result: str = fallback
    if flag:
        result = "yes"
        print("checking")
        if fallback == "alt":
            return fallback
        elif fallback == "no":
            return result
        else:
            return "other"
    return result

output: str = select(True, "no")
print(output)
if output == "yes":
    print("matched")
output = select(False, "fallback")
print(output)
