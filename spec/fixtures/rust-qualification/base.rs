fn semantifold_print_integer(value: i64) { println!("{}", value); }
fn difference(left: i64, right: i64) -> i64 {
    if left > right { return left - right; } else { return right - left; }
}
fn main() { semantifold_print_integer(difference(4i64, 9i64)); }
