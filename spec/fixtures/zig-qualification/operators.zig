fn operators(left: i64, right: i64, yes: bool, no: bool) bool {
    const arithmetic: i64 = @addWithOverflow(left, right)[0];
    return (arithmetic >= 0 and yes) or !no;
}
