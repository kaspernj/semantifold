fn semantifold_print_string(value: String) { println!("{}", value); }
fn arithmetic(left: i64, right: i64) -> i64 {
    if (left < right) && !(left == right) { return -left + right * 2i64; } else { return left - right; }
}
fn ordered(left: i64, right: i64) -> bool {
    if (left <= right || left >= right) && left != right { return left > right; } else { return left < right; }
}
fn logic(left: bool, right: bool) -> bool {
    if (!left || right) && left != right { return left == right; } else { return left || right; }
}
fn combine(left: String, right: String) -> String {
    if left == right || left != right { return (left.clone() + &String::from(":")) + &right; } else { return left + &right; }
}
fn report(left: i64, right: i64) -> String {
    if (arithmetic(left, right) == 17i64 && ordered(right, left)) && !logic(false, true) {
        return combine(String::from("typed"), String::from("operators"));
    } else { return String::from("bad"); }
}
fn main() { semantifold_print_string(report(3i64, 10i64)); }
