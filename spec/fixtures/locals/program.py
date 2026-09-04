def select(flag: bool, fallback: str) -> str:
    # @semantifold-immutable
    preferred: str = "yes"
    result: str = fallback
    if flag:
        result = preferred
        return result
    else:
        return result

output: str = "no"
output = select(True, output)
print(output)
