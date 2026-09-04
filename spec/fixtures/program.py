def difference(left: int, right: int) -> int:
    if left > right:
        return left - right
    else:
        return right - left

print(difference(4, 9))
