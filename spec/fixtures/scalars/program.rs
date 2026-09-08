fn semantifold_print_string(value: String) { println!("{}", value); }
fn label(flag: bool, fallback: String) -> String {
    if flag { return String::from("yes"); } else { return fallback; }
}
fn main() { semantifold_print_string(label(true, String::from("no"))); }
