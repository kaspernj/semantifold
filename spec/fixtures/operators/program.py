def arithmetic(left: int, right: int) -> int:
    if (left < right) and (not (left == right)):
        return (-left) + (right * 2)
    else:
        return left - right

def ordered(left: int, right: int) -> bool:
    if ((left <= right) or (left >= right)) and (left != right):
        return left > right
    else:
        return left < right

def logic(left: bool, right: bool) -> bool:
    if ((not left) or right) and (left != right):
        return left == right
    else:
        return left or right

def combine(left: str, right: str) -> str:
    if (left == right) or (left != right):
        return (left + ":") + right
    else:
        return left + right

def report(left: int, right: int) -> str:
    if ((arithmetic(left, right) == 17) and ordered(right, left)) and (not logic(False, True)):
        return combine("typed", "operators")
    else:
        return "bad"

print(report(3, 10))
