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

std::int64_t difference(std::int64_t left, std::int64_t right);

std::int64_t difference(std::int64_t left, std::int64_t right) {
    (void)left;
    (void)right;
    /* semantifold:ordered-expression:cpp:v1 begin 000001 653448ec8c270400be3226a181c27e62c8105425eb2d94373ed39d5c8b96c468 */
    bool semantifold_ordered_000001 = (left > right);
    if (semantifold_ordered_000001) {
        /* semantifold:ordered-expression:cpp:v1 begin 000002 18cee81695dfee124b895b5d71b02cef500136671aa8a806aefc68004fbc3176 */
        std::int64_t semantifold_ordered_000002 = semantifold_integer_subtract(left, right);
        return semantifold_ordered_000002;
        /* semantifold:ordered-expression:cpp:v1 end 000002 18cee81695dfee124b895b5d71b02cef500136671aa8a806aefc68004fbc3176 */
    } else {
        /* semantifold:ordered-expression:cpp:v1 begin 000003 3bcc5a928e1b39d0e2f8718421557178c9ae4f45f545c76bd373da690c691d14 */
        std::int64_t semantifold_ordered_000003 = semantifold_integer_subtract(right, left);
        return semantifold_ordered_000003;
        /* semantifold:ordered-expression:cpp:v1 end 000003 3bcc5a928e1b39d0e2f8718421557178c9ae4f45f545c76bd373da690c691d14 */
    }
    /* semantifold:ordered-expression:cpp:v1 end 000001 653448ec8c270400be3226a181c27e62c8105425eb2d94373ed39d5c8b96c468 */
}

int main() {
    /* semantifold:ordered-expression:cpp:v1 begin 000004 c657787bb3e2d7c87de2eb1a2beece581c12ea828e616fddeb5cc7795393ab05 */
    std::int64_t semantifold_ordered_000004 = difference(std::int64_t(4), std::int64_t(9));
    semantifold_print_integer(semantifold_ordered_000004);
    /* semantifold:ordered-expression:cpp:v1 end 000004 c657787bb3e2d7c87de2eb1a2beece581c12ea828e616fddeb5cc7795393ab05 */
    return 0;
}
