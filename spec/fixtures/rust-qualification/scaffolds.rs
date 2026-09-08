#![allow(dead_code, unused_variables, unused_mut, unused_assignments, unused_parens)]
// Ordinary comment with astral text: 😀
/* Nested /* comment */ remains an extra. */
fn semantifold_print_integer(value: i64) { println!("{}", value); }
fn semantifold_print_boolean(value: bool) { println!("{}", value); }
fn semantifold_print_string(value: String) { println!("{}", value); }
fn semantifold_integer_add(left: i64, right: i64) -> i64 {
    let (result, overflow): (i64, bool) = left.overflowing_add(right);
    if overflow { eprintln!("semantifold: integer overflow"); std::process::exit(70); }
    return result;
}
fn semantifold_integer_subtract(left: i64, right: i64) -> i64 {
    let (result, overflow): (i64, bool) = left.overflowing_sub(right);
    if overflow { eprintln!("semantifold: integer overflow"); std::process::exit(70); }
    return result;
}
fn semantifold_integer_multiply(left: i64, right: i64) -> i64 {
    let (result, overflow): (i64, bool) = left.overflowing_mul(right);
    if overflow { eprintln!("semantifold: integer overflow"); std::process::exit(70); }
    return result;
}
fn semantifold_integer_negate(value: i64) -> i64 {
    let (result, overflow): (i64, bool) = value.overflowing_neg();
    if overflow { eprintln!("semantifold: integer overflow"); std::process::exit(70); }
    return result;
}
fn copy(left: String, right: String) -> String {
    let mut value: String = left.clone();
    let again: String = value.clone();
    value = value.clone() + &right;
    semantifold_print_string(again.clone());
    semantifold_print_string(again);
    if false {} else if true {} else {}
    return value;
}
fn main() {
    let value: String = String::from("é😀\0\n\r\t\\\"\'\x7f\u{1f600}");
    semantifold_print_string(copy(value.clone(), String::from("!")));
    semantifold_print_string(value);
    semantifold_print_integer(semantifold_integer_add(1i64, 2i64));
    semantifold_print_boolean(true);
}
