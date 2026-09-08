fn semantifold_print_string(value: String) { println!("{}", value); }
fn select(flag: bool, fallback: String) -> String {
    let mut result: String = fallback.clone();
    if flag {
        result = String::from("yes");
        semantifold_print_string(String::from("checking"));
        if fallback == String::from("alt") { return fallback; }
        else if fallback == String::from("no") { return result; }
        else { return String::from("other"); }
    }
    return result;
}
fn main() {
    let mut output: String = select(true, String::from("no"));
    semantifold_print_string(output.clone());
    if output == String::from("yes") { semantifold_print_string(String::from("matched")); }
    output = select(false, String::from("fallback"));
    semantifold_print_string(output.clone());
}
