/* semantifold:program:cpp:v1 */
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <limits>
#include <climits>

static_assert(CHAR_BIT == 8 && sizeof(std::int64_t) == 8, "Semantifold requires eight-bit bytes and int64");
static_assert(sizeof(std::size_t) == 8 && sizeof(std::ptrdiff_t) == 8, "Semantifold requires the qualified 64-bit ABI");
static_assert(_GLIBCXX_USE_CXX11_ABI == 1, "Semantifold requires libstdc++ C++11 string ABI");

[[noreturn]] inline void semantifold_fatal(const char *message, std::size_t length) {
    (void)std::fwrite(message, 1, length, stderr);
    std::exit(70);
}

inline std::int64_t semantifold_integer_add(std::int64_t left, std::int64_t right) {
    std::int64_t result;
    if (__builtin_add_overflow(left, right, &result)) {
        semantifold_fatal("semantifold: integer overflow\n", sizeof("semantifold: integer overflow\n") - 1);
    }
    return result;
}

inline std::int64_t semantifold_integer_subtract(std::int64_t left, std::int64_t right) {
    std::int64_t result;
    if (__builtin_sub_overflow(left, right, &result)) {
        semantifold_fatal("semantifold: integer overflow\n", sizeof("semantifold: integer overflow\n") - 1);
    }
    return result;
}

inline std::int64_t semantifold_integer_multiply(std::int64_t left, std::int64_t right) {
    std::int64_t result;
    if (__builtin_mul_overflow(left, right, &result)) {
        semantifold_fatal("semantifold: integer overflow\n", sizeof("semantifold: integer overflow\n") - 1);
    }
    return result;
}

inline std::int64_t semantifold_integer_negate(std::int64_t value) {
    return semantifold_integer_subtract(std::int64_t(0), value);
}

inline std::string semantifold_string_concat(std::string left, std::string right) {
    if (right.size() > left.max_size() - left.size()) {
        semantifold_fatal("semantifold: string size\n", sizeof("semantifold: string size\n") - 1);
    }
    return left + right;
}

inline bool semantifold_string_equal(std::string left, std::string right) {
    return left == right;
}

inline bool semantifold_string_not_equal(std::string left, std::string right) {
    return left != right;
}

inline void semantifold_write(const char *data, std::size_t length) {
    if (length != 0 && std::fwrite(data, 1, length, stdout) != length) {
        semantifold_fatal("semantifold: output failure\n", sizeof("semantifold: output failure\n") - 1);
    }
}

inline void semantifold_newline() {
    semantifold_write("\n", 1);
    if (std::fflush(stdout) != 0) semantifold_fatal("semantifold: output failure\n", sizeof("semantifold: output failure\n") - 1);
}

inline void semantifold_print_string(std::string value) {
    semantifold_write(value.data(), value.size());
    semantifold_newline();
}

inline void semantifold_print_boolean(bool value) {
    if (value) semantifold_write("true", 4);
    else semantifold_write("false", 5);
    semantifold_newline();
}

inline void semantifold_print_integer(std::int64_t value) {
    char digits[20];
    std::size_t position = sizeof(digits);
    std::uint64_t magnitude = static_cast<std::uint64_t>(value);
    if (value < 0) magnitude = std::uint64_t(0) - magnitude;
    do {
        digits[--position] = static_cast<char>(std::uint64_t(48) + magnitude % std::uint64_t(10));
        magnitude /= std::uint64_t(10);
    } while (magnitude != 0);
    if (value < 0) digits[--position] = '-';
    semantifold_write(digits + position, sizeof(digits) - position);
    semantifold_newline();
}
/* semantifold:runtime:cpp:v1 end */

std::int64_t arithmetic(std::int64_t left, std::int64_t right);
bool ordered(std::int64_t left, std::int64_t right);
bool logic(bool left, bool right);
std::string combine(std::string left, std::string right);
std::string report(std::int64_t left, std::int64_t right);

std::int64_t arithmetic(std::int64_t left, std::int64_t right) {
    (void)left;
    (void)right;
    /* semantifold:ordered-expression:cpp:v1 begin 000001 82ceeb98527260629e4639d9d160052d863f207765b1ce67510791063acb48fa */
    bool semantifold_ordered_000001 = (left < right);
    bool semantifold_ordered_000002 = semantifold_ordered_000001;
    if (semantifold_ordered_000002) {
        bool semantifold_ordered_000003 = (left == right);
        bool semantifold_ordered_000004 = !(semantifold_ordered_000003);
        semantifold_ordered_000002 = (semantifold_ordered_000002 && semantifold_ordered_000004);
    }
    if (semantifold_ordered_000002) {
        /* semantifold:ordered-expression:cpp:v1 begin 000002 6fa20fbec7d9d33ccbe09e8b265e443199e28064e2eb6a661a531ddfe385f6a0 */
        std::int64_t semantifold_ordered_000005 = semantifold_integer_negate(left);
        std::int64_t semantifold_ordered_000006 = semantifold_integer_multiply(right, std::int64_t(2));
        std::int64_t semantifold_ordered_000007 = semantifold_integer_add(semantifold_ordered_000005, semantifold_ordered_000006);
        return semantifold_ordered_000007;
        /* semantifold:ordered-expression:cpp:v1 end 000002 6fa20fbec7d9d33ccbe09e8b265e443199e28064e2eb6a661a531ddfe385f6a0 */
    } else {
        /* semantifold:ordered-expression:cpp:v1 begin 000003 18cee81695dfee124b895b5d71b02cef500136671aa8a806aefc68004fbc3176 */
        std::int64_t semantifold_ordered_000008 = semantifold_integer_subtract(left, right);
        return semantifold_ordered_000008;
        /* semantifold:ordered-expression:cpp:v1 end 000003 18cee81695dfee124b895b5d71b02cef500136671aa8a806aefc68004fbc3176 */
    }
    /* semantifold:ordered-expression:cpp:v1 end 000001 82ceeb98527260629e4639d9d160052d863f207765b1ce67510791063acb48fa */
}

bool ordered(std::int64_t left, std::int64_t right) {
    (void)left;
    (void)right;
    /* semantifold:ordered-expression:cpp:v1 begin 000004 a946c8b33b904e349270660023d2a826eada1b3b2c29b1c859ab476f158ef20f */
    bool semantifold_ordered_000009 = (left <= right);
    bool semantifold_ordered_000010 = semantifold_ordered_000009;
    if (!semantifold_ordered_000010) {
        bool semantifold_ordered_000011 = (left >= right);
        semantifold_ordered_000010 = (semantifold_ordered_000010 || semantifold_ordered_000011);
    }
    bool semantifold_ordered_000012 = semantifold_ordered_000010;
    if (semantifold_ordered_000012) {
        bool semantifold_ordered_000013 = (left != right);
        semantifold_ordered_000012 = (semantifold_ordered_000012 && semantifold_ordered_000013);
    }
    if (semantifold_ordered_000012) {
        /* semantifold:ordered-expression:cpp:v1 begin 000005 ad792081b7b4e08c05881dce0e6487d42260d8cf4e11c8bfe9ec3ffba3cd671d */
        bool semantifold_ordered_000014 = (left > right);
        return semantifold_ordered_000014;
        /* semantifold:ordered-expression:cpp:v1 end 000005 ad792081b7b4e08c05881dce0e6487d42260d8cf4e11c8bfe9ec3ffba3cd671d */
    } else {
        /* semantifold:ordered-expression:cpp:v1 begin 000006 e909f1b8235c7bccb0aab54ddb8f80994e41737ec5b8217e1295e031940e7c2a */
        bool semantifold_ordered_000015 = (left < right);
        return semantifold_ordered_000015;
        /* semantifold:ordered-expression:cpp:v1 end 000006 e909f1b8235c7bccb0aab54ddb8f80994e41737ec5b8217e1295e031940e7c2a */
    }
    /* semantifold:ordered-expression:cpp:v1 end 000004 a946c8b33b904e349270660023d2a826eada1b3b2c29b1c859ab476f158ef20f */
}

bool logic(bool left, bool right) {
    (void)left;
    (void)right;
    /* semantifold:ordered-expression:cpp:v1 begin 000007 d90370e4cf504f546c69d6a73aedc7ca595f618ece0ff2170ff9349fde424578 */
    bool semantifold_ordered_000016 = !(left);
    bool semantifold_ordered_000017 = semantifold_ordered_000016;
    if (!semantifold_ordered_000017) {
        semantifold_ordered_000017 = (semantifold_ordered_000017 || right);
    }
    bool semantifold_ordered_000018 = semantifold_ordered_000017;
    if (semantifold_ordered_000018) {
        bool semantifold_ordered_000019 = (left != right);
        semantifold_ordered_000018 = (semantifold_ordered_000018 && semantifold_ordered_000019);
    }
    if (semantifold_ordered_000018) {
        /* semantifold:ordered-expression:cpp:v1 begin 000008 0eb4ce50cf5e1853b70f35be18c88de9b7031634ed6565fdfb67ffb8daed0c58 */
        bool semantifold_ordered_000020 = (left == right);
        return semantifold_ordered_000020;
        /* semantifold:ordered-expression:cpp:v1 end 000008 0eb4ce50cf5e1853b70f35be18c88de9b7031634ed6565fdfb67ffb8daed0c58 */
    } else {
        /* semantifold:ordered-expression:cpp:v1 begin 000009 ca8a24d457445ddf25344978773289f053db4a4a3d7c8b35760d7aef8d547339 */
        bool semantifold_ordered_000021 = left;
        if (!semantifold_ordered_000021) {
            semantifold_ordered_000021 = (semantifold_ordered_000021 || right);
        }
        return semantifold_ordered_000021;
        /* semantifold:ordered-expression:cpp:v1 end 000009 ca8a24d457445ddf25344978773289f053db4a4a3d7c8b35760d7aef8d547339 */
    }
    /* semantifold:ordered-expression:cpp:v1 end 000007 d90370e4cf504f546c69d6a73aedc7ca595f618ece0ff2170ff9349fde424578 */
}

std::string combine(std::string left, std::string right) {
    (void)left;
    (void)right;
    /* semantifold:ordered-expression:cpp:v1 begin 000010 7d005a0b3685bf98a776cb8c96c8e6b17c60a4de7fc0632f2645fdef0f33120e */
    bool semantifold_ordered_000022 = semantifold_string_equal(left, right);
    bool semantifold_ordered_000023 = semantifold_ordered_000022;
    if (!semantifold_ordered_000023) {
        bool semantifold_ordered_000024 = semantifold_string_not_equal(left, right);
        semantifold_ordered_000023 = (semantifold_ordered_000023 || semantifold_ordered_000024);
    }
    if (semantifold_ordered_000023) {
        /* semantifold:ordered-expression:cpp:v1 begin 000011 611467205603b2a3d4eaaa70f3644a7ad85ae1565941369ec0575380378c39c7 */
        std::string semantifold_ordered_000025 = semantifold_string_concat(left, std::string("\072", 1));
        std::string semantifold_ordered_000026 = semantifold_string_concat(semantifold_ordered_000025, right);
        return semantifold_ordered_000026;
        /* semantifold:ordered-expression:cpp:v1 end 000011 611467205603b2a3d4eaaa70f3644a7ad85ae1565941369ec0575380378c39c7 */
    } else {
        /* semantifold:ordered-expression:cpp:v1 begin 000012 c0ebc48f15279bf5be9a4bc762c8c62d07af1300ffafa2ad83865838035485ba */
        std::string semantifold_ordered_000027 = semantifold_string_concat(left, right);
        return semantifold_ordered_000027;
        /* semantifold:ordered-expression:cpp:v1 end 000012 c0ebc48f15279bf5be9a4bc762c8c62d07af1300ffafa2ad83865838035485ba */
    }
    /* semantifold:ordered-expression:cpp:v1 end 000010 7d005a0b3685bf98a776cb8c96c8e6b17c60a4de7fc0632f2645fdef0f33120e */
}

std::string report(std::int64_t left, std::int64_t right) {
    (void)left;
    (void)right;
    /* semantifold:ordered-expression:cpp:v1 begin 000013 b1792db8f16d8c2e2b6afcada115dd7afaac3c4bec36dea929de07f6d55ed50e */
    std::int64_t semantifold_ordered_000028 = arithmetic(left, right);
    bool semantifold_ordered_000029 = (semantifold_ordered_000028 == std::int64_t(17));
    bool semantifold_ordered_000030 = semantifold_ordered_000029;
    if (semantifold_ordered_000030) {
        bool semantifold_ordered_000031 = ordered(right, left);
        semantifold_ordered_000030 = (semantifold_ordered_000030 && semantifold_ordered_000031);
    }
    bool semantifold_ordered_000032 = semantifold_ordered_000030;
    if (semantifold_ordered_000032) {
        bool semantifold_ordered_000033 = logic(false, true);
        bool semantifold_ordered_000034 = !(semantifold_ordered_000033);
        semantifold_ordered_000032 = (semantifold_ordered_000032 && semantifold_ordered_000034);
    }
    if (semantifold_ordered_000032) {
        /* semantifold:ordered-expression:cpp:v1 begin 000014 5896eeabaa572cd9f2df0aae4dc85f7ab1ae5485f76d9d27ed2668fcaa196942 */
        std::string semantifold_ordered_000035 = combine(std::string("\164\171\160\145\144", 5), std::string("\157\160\145\162\141\164\157\162\163", 9));
        return semantifold_ordered_000035;
        /* semantifold:ordered-expression:cpp:v1 end 000014 5896eeabaa572cd9f2df0aae4dc85f7ab1ae5485f76d9d27ed2668fcaa196942 */
    } else {
        /* semantifold:ordered-expression:cpp:v1 begin 000015 665fb78f1a14779b2df64012aa375161df8b9fca0efecb7107d135d0fe94a30d */
        return std::string("\142\141\144", 3);
        /* semantifold:ordered-expression:cpp:v1 end 000015 665fb78f1a14779b2df64012aa375161df8b9fca0efecb7107d135d0fe94a30d */
    }
    /* semantifold:ordered-expression:cpp:v1 end 000013 b1792db8f16d8c2e2b6afcada115dd7afaac3c4bec36dea929de07f6d55ed50e */
}

int main() {
    /* semantifold:ordered-expression:cpp:v1 begin 000016 4eff6eb36f289bbc1dc29c1dad5a6c1fa57c47b17f102d96de38baceeaceaff9 */
    std::string semantifold_ordered_000036 = report(std::int64_t(3), std::int64_t(10));
    semantifold_print_string(semantifold_ordered_000036);
    /* semantifold:ordered-expression:cpp:v1 end 000016 4eff6eb36f289bbc1dc29c1dad5a6c1fa57c47b17f102d96de38baceeaceaff9 */
    return 0;
}
