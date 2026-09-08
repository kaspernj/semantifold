fn semantifold_print_string(value: String) { println!("{}", value); }
fn select(flag: bool, fallback: String) -> String {
    let preferred: String = String::from("yes");
    let mut result: String = fallback.clone();
    if flag { result = preferred.clone(); return result; } else { return result; }
}
fn main() {
    let mut output: String = String::from("no");
    output = select(true, output.clone());
    semantifold_print_string(output.clone());
}
