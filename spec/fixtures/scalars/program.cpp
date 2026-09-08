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

std::string label(bool flag, std::string fallback);

std::string label(bool flag, std::string fallback) {
    (void)flag;
    (void)fallback;
    /* semantifold:ordered-expression:cpp:v1 begin 000001 48ea2cc331dd63d0a145cd419ccbfd1d22b8b65b64e855e571c9746e4da540bd */
    if (flag) {
        /* semantifold:ordered-expression:cpp:v1 begin 000002 7869fb14271d99047eff3652e9d57a257dee79dfd606d369d53c4f8f32048402 */
        return std::string("\171\145\163", 3);
        /* semantifold:ordered-expression:cpp:v1 end 000002 7869fb14271d99047eff3652e9d57a257dee79dfd606d369d53c4f8f32048402 */
    } else {
        /* semantifold:ordered-expression:cpp:v1 begin 000003 2835df535bdc8c38528f6a7d3d9be1fbdf645a0fe6c57fb3b91e63905c668a21 */
        return fallback;
        /* semantifold:ordered-expression:cpp:v1 end 000003 2835df535bdc8c38528f6a7d3d9be1fbdf645a0fe6c57fb3b91e63905c668a21 */
    }
    /* semantifold:ordered-expression:cpp:v1 end 000001 48ea2cc331dd63d0a145cd419ccbfd1d22b8b65b64e855e571c9746e4da540bd */
}

int main() {
    /* semantifold:ordered-expression:cpp:v1 begin 000004 5379e64d1ace16e712245f7c536f733cacba16e0a936006effbfa348ed1b7afc */
    std::string semantifold_ordered_000001 = label(true, std::string("\156\157", 2));
    semantifold_print_string(semantifold_ordered_000001);
    /* semantifold:ordered-expression:cpp:v1 end 000004 5379e64d1ace16e712245f7c536f733cacba16e0a936006effbfa348ed1b7afc */
    return 0;
}
