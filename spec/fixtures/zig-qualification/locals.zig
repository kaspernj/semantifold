fn locals(unused: i64) i64 {
    _ = unused;
    const immutable: i64 = 1;
    var unmutated: i64 = immutable;
    _ = &unmutated;
    var mutable: i64 = unmutated;
    mutable = 2;
    return mutable;
}
