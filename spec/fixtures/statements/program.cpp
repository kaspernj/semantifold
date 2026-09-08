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

std::string select(bool flag, std::string fallback);

std::string select(bool flag, std::string fallback) {
    (void)flag;
    (void)fallback;
    /* semantifold:ordered-expression:cpp:v1 begin 000001 ebb6c087ce97bcb9fe3a3c6c24f12b26144894a6c0bf71d49dc3f193c05cfbc3 */
    std::string result = fallback;
    (void)result;
    /* semantifold:ordered-expression:cpp:v1 end 000001 ebb6c087ce97bcb9fe3a3c6c24f12b26144894a6c0bf71d49dc3f193c05cfbc3 */
    /* semantifold:ordered-expression:cpp:v1 begin 000002 48ea2cc331dd63d0a145cd419ccbfd1d22b8b65b64e855e571c9746e4da540bd */
    if (flag) {
        /* semantifold:ordered-expression:cpp:v1 begin 000003 10578fdf3eff85d9ce24895abe0d4964f49eadebbac7ff2f8dee7df8cf3bd282 */
        result = std::string("\171\145\163", 3);
        /* semantifold:ordered-expression:cpp:v1 end 000003 10578fdf3eff85d9ce24895abe0d4964f49eadebbac7ff2f8dee7df8cf3bd282 */
        /* semantifold:ordered-expression:cpp:v1 begin 000004 c5bb4cd0e9a472c6f4afbc0776c0b7f2ca4d09e802dc96eab928b2d1e63d2015 */
        semantifold_print_string(std::string("\143\150\145\143\153\151\156\147", 8));
        /* semantifold:ordered-expression:cpp:v1 end 000004 c5bb4cd0e9a472c6f4afbc0776c0b7f2ca4d09e802dc96eab928b2d1e63d2015 */
        /* semantifold:ordered-expression:cpp:v1 begin 000005 d8182c24f6777b9e95925fa5fe9c02d88757fec82ea340a855219a6554f892c6 */
        bool semantifold_ordered_000001 = semantifold_string_equal(fallback, std::string("\141\154\164", 3));
        if (semantifold_ordered_000001) {
            /* semantifold:ordered-expression:cpp:v1 begin 000006 2835df535bdc8c38528f6a7d3d9be1fbdf645a0fe6c57fb3b91e63905c668a21 */
            return fallback;
            /* semantifold:ordered-expression:cpp:v1 end 000006 2835df535bdc8c38528f6a7d3d9be1fbdf645a0fe6c57fb3b91e63905c668a21 */
        } else {
            /* semantifold:ordered-expression:cpp:v1 begin 000007 6fde59c6ae3238850b09b470dc7e2c01d8aad82657cdfea01ef808d07241307d */
            bool semantifold_ordered_000002 = semantifold_string_equal(fallback, std::string("\156\157", 2));
            if (semantifold_ordered_000002) {
                /* semantifold:ordered-expression:cpp:v1 begin 000008 0ba4a8242741fd1dda87e459e9c5f9d4e5245064282cb6f2bd104840f3656edd */
                return result;
                /* semantifold:ordered-expression:cpp:v1 end 000008 0ba4a8242741fd1dda87e459e9c5f9d4e5245064282cb6f2bd104840f3656edd */
            } else {
                /* semantifold:ordered-expression:cpp:v1 begin 000009 c0e4c3357a7b48f077e81397fff75e925220ce58f983a1d524cb26ab1c196a59 */
                return std::string("\157\164\150\145\162", 5);
                /* semantifold:ordered-expression:cpp:v1 end 000009 c0e4c3357a7b48f077e81397fff75e925220ce58f983a1d524cb26ab1c196a59 */
            }
            /* semantifold:ordered-expression:cpp:v1 end 000007 6fde59c6ae3238850b09b470dc7e2c01d8aad82657cdfea01ef808d07241307d */
        }
        /* semantifold:ordered-expression:cpp:v1 end 000005 d8182c24f6777b9e95925fa5fe9c02d88757fec82ea340a855219a6554f892c6 */
    }
    /* semantifold:ordered-expression:cpp:v1 end 000002 48ea2cc331dd63d0a145cd419ccbfd1d22b8b65b64e855e571c9746e4da540bd */
    /* semantifold:ordered-expression:cpp:v1 begin 000010 0ba4a8242741fd1dda87e459e9c5f9d4e5245064282cb6f2bd104840f3656edd */
    return result;
    /* semantifold:ordered-expression:cpp:v1 end 000010 0ba4a8242741fd1dda87e459e9c5f9d4e5245064282cb6f2bd104840f3656edd */
}

int main() {
    /* semantifold:ordered-expression:cpp:v1 begin 000011 ee4cf201750e3d1685a8ca099627e2fe81091ed41e291681bfd440c9abbe4c2d */
    std::string semantifold_ordered_000003 = select(true, std::string("\156\157", 2));
    std::string output = semantifold_ordered_000003;
    (void)output;
    /* semantifold:ordered-expression:cpp:v1 end 000011 ee4cf201750e3d1685a8ca099627e2fe81091ed41e291681bfd440c9abbe4c2d */
    /* semantifold:ordered-expression:cpp:v1 begin 000012 9d74f8e8969dd2098e40b1956796947ce0535af915dfe5000bd93b2024616dc4 */
    semantifold_print_string(output);
    /* semantifold:ordered-expression:cpp:v1 end 000012 9d74f8e8969dd2098e40b1956796947ce0535af915dfe5000bd93b2024616dc4 */
    /* semantifold:ordered-expression:cpp:v1 begin 000013 c7773688d7dee3edb7ff2520cb9f579a7d59ac645a4e739c8573842a8ad94c74 */
    bool semantifold_ordered_000004 = semantifold_string_equal(output, std::string("\171\145\163", 3));
    if (semantifold_ordered_000004) {
        /* semantifold:ordered-expression:cpp:v1 begin 000014 89fc69228244445594f32a6a345f285f7f1924f853274c9b71fe3bc8da6663a9 */
        semantifold_print_string(std::string("\155\141\164\143\150\145\144", 7));
        /* semantifold:ordered-expression:cpp:v1 end 000014 89fc69228244445594f32a6a345f285f7f1924f853274c9b71fe3bc8da6663a9 */
    }
    /* semantifold:ordered-expression:cpp:v1 end 000013 c7773688d7dee3edb7ff2520cb9f579a7d59ac645a4e739c8573842a8ad94c74 */
    /* semantifold:ordered-expression:cpp:v1 begin 000015 ed18a8e04789032535b6b5e3fc8faa7c67ce8375fe4f16308d724fef81c69eb8 */
    std::string semantifold_ordered_000005 = select(false, std::string("\146\141\154\154\142\141\143\153", 8));
    output = semantifold_ordered_000005;
    /* semantifold:ordered-expression:cpp:v1 end 000015 ed18a8e04789032535b6b5e3fc8faa7c67ce8375fe4f16308d724fef81c69eb8 */
    /* semantifold:ordered-expression:cpp:v1 begin 000016 9d74f8e8969dd2098e40b1956796947ce0535af915dfe5000bd93b2024616dc4 */
    semantifold_print_string(output);
    /* semantifold:ordered-expression:cpp:v1 end 000016 9d74f8e8969dd2098e40b1956796947ce0535af915dfe5000bd93b2024616dc4 */
    return 0;
}
