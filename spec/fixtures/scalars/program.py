def label(flag: bool, fallback: str) -> str:
    if flag:
        return "yes"
    else:
        return fallback

print(label(True, "no"))
