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

std::int64_t mark(std::string label, std::int64_t value);
bool flag(std::string label, bool value);
std::string piece(std::string label, std::string value);
std::int64_t compute(std::int64_t left, std::int64_t right);

std::int64_t mark(std::string label, std::int64_t value) {
    (void)label;
    (void)value;
    /* semantifold:ordered-expression:cpp:v1 begin 000001 48552432718f56d26bdca9ec9335811141dd0538d52a5216cd31a7bab495e5f5 */
    semantifold_print_string(label);
    /* semantifold:ordered-expression:cpp:v1 end 000001 48552432718f56d26bdca9ec9335811141dd0538d52a5216cd31a7bab495e5f5 */
    /* semantifold:ordered-expression:cpp:v1 begin 000002 946830abdfcf996cbd4995e6b8916ad98f49e3b5e852d03fcdeae8d44e48ab7b */
    return value;
    /* semantifold:ordered-expression:cpp:v1 end 000002 946830abdfcf996cbd4995e6b8916ad98f49e3b5e852d03fcdeae8d44e48ab7b */
}

bool flag(std::string label, bool value) {
    (void)label;
    (void)value;
    /* semantifold:ordered-expression:cpp:v1 begin 000003 48552432718f56d26bdca9ec9335811141dd0538d52a5216cd31a7bab495e5f5 */
    semantifold_print_string(label);
    /* semantifold:ordered-expression:cpp:v1 end 000003 48552432718f56d26bdca9ec9335811141dd0538d52a5216cd31a7bab495e5f5 */
    /* semantifold:ordered-expression:cpp:v1 begin 000004 946830abdfcf996cbd4995e6b8916ad98f49e3b5e852d03fcdeae8d44e48ab7b */
    return value;
    /* semantifold:ordered-expression:cpp:v1 end 000004 946830abdfcf996cbd4995e6b8916ad98f49e3b5e852d03fcdeae8d44e48ab7b */
}

std::string piece(std::string label, std::string value) {
    (void)label;
    (void)value;
    /* semantifold:ordered-expression:cpp:v1 begin 000005 48552432718f56d26bdca9ec9335811141dd0538d52a5216cd31a7bab495e5f5 */
    semantifold_print_string(label);
    /* semantifold:ordered-expression:cpp:v1 end 000005 48552432718f56d26bdca9ec9335811141dd0538d52a5216cd31a7bab495e5f5 */
    /* semantifold:ordered-expression:cpp:v1 begin 000006 946830abdfcf996cbd4995e6b8916ad98f49e3b5e852d03fcdeae8d44e48ab7b */
    return value;
    /* semantifold:ordered-expression:cpp:v1 end 000006 946830abdfcf996cbd4995e6b8916ad98f49e3b5e852d03fcdeae8d44e48ab7b */
}

std::int64_t compute(std::int64_t left, std::int64_t right) {
    (void)left;
    (void)right;
    /* semantifold:ordered-expression:cpp:v1 begin 000007 027d7934434c7336d9b8cac7b8d4cc09a2d4ea03e0348cc88aa2cca1215021fa */
    std::int64_t semantifold_ordered_000001 = mark(std::string("\151\156\151\164\151\141\154\055\154\145\146\164", 12), left);
    std::int64_t semantifold_ordered_000002 = mark(std::string("\151\156\151\164\151\141\154\055\162\151\147\150\164", 13), right);
    std::int64_t semantifold_ordered_000003 = semantifold_integer_add(semantifold_ordered_000001, semantifold_ordered_000002);
    std::int64_t result = semantifold_ordered_000003;
    (void)result;
    /* semantifold:ordered-expression:cpp:v1 end 000007 027d7934434c7336d9b8cac7b8d4cc09a2d4ea03e0348cc88aa2cca1215021fa */
    /* semantifold:ordered-expression:cpp:v1 begin 000008 58a67cc7cfbf0d5856ced90ba88f34b423dbfd7c2882cb8e6f0aa53c1d5529ce */
    std::int64_t semantifold_ordered_000004 = mark(std::string("\141\163\163\151\147\156\055\154\145\146\164", 11), result);
    std::int64_t semantifold_ordered_000005 = mark(std::string("\141\163\163\151\147\156\055\162\151\147\150\164", 12), right);
    std::int64_t semantifold_ordered_000006 = semantifold_integer_subtract(semantifold_ordered_000004, semantifold_ordered_000005);
    result = semantifold_ordered_000006;
    /* semantifold:ordered-expression:cpp:v1 end 000008 58a67cc7cfbf0d5856ced90ba88f34b423dbfd7c2882cb8e6f0aa53c1d5529ce */
    /* semantifold:ordered-expression:cpp:v1 begin 000009 4df8d6ad37a3a9e9968f66db44eebc190c875a4f6af112a5e2efb5f3db55a23f */
    bool semantifold_ordered_000007 = flag(std::string("\164\145\163\164", 4), true);
    if (semantifold_ordered_000007) {
        /* semantifold:ordered-expression:cpp:v1 begin 000010 421f152ded1743f123009474b736a9752718a92df4f6003f24320f461f8618a1 */
        std::int64_t semantifold_ordered_000008 = mark(std::string("\160\162\151\156\164\055\154\145\146\164", 10), left);
        std::int64_t semantifold_ordered_000009 = mark(std::string("\160\162\151\156\164\055\162\151\147\150\164", 11), right);
        std::int64_t semantifold_ordered_000010 = semantifold_integer_multiply(semantifold_ordered_000008, semantifold_ordered_000009);
        semantifold_print_integer(semantifold_ordered_000010);
        /* semantifold:ordered-expression:cpp:v1 end 000010 421f152ded1743f123009474b736a9752718a92df4f6003f24320f461f8618a1 */
    }
    /* semantifold:ordered-expression:cpp:v1 end 000009 4df8d6ad37a3a9e9968f66db44eebc190c875a4f6af112a5e2efb5f3db55a23f */
    /* semantifold:ordered-expression:cpp:v1 begin 000011 800b39a0503596589ab039b6b9fc0d29fcd82f295f7a3cb73ce9ff80e6a46c1f */
    bool semantifold_ordered_000011 = flag(std::string("\141\156\144\055\154\145\146\164", 8), false);
    bool semantifold_ordered_000012 = semantifold_ordered_000011;
    if (semantifold_ordered_000012) {
        bool semantifold_ordered_000013 = flag(std::string("\163\153\151\160\160\145\144\055\157\162\055\154\145\146\164", 15), true);
        bool semantifold_ordered_000014 = semantifold_ordered_000013;
        if (!semantifold_ordered_000014) {
            bool semantifold_ordered_000015 = flag(std::string("\163\153\151\160\160\145\144\055\157\162\055\162\151\147\150\164", 16), false);
            semantifold_ordered_000014 = (semantifold_ordered_000014 || semantifold_ordered_000015);
        }
        semantifold_ordered_000012 = (semantifold_ordered_000012 && semantifold_ordered_000014);
    }
    if (semantifold_ordered_000012) {
        /* semantifold:ordered-expression:cpp:v1 begin 000012 bedf96617ed0e1762eac4088258076a43077e572e4d1836bdaec10130412a1d1 */
        return right;
        /* semantifold:ordered-expression:cpp:v1 end 000012 bedf96617ed0e1762eac4088258076a43077e572e4d1836bdaec10130412a1d1 */
    }
    /* semantifold:ordered-expression:cpp:v1 end 000011 800b39a0503596589ab039b6b9fc0d29fcd82f295f7a3cb73ce9ff80e6a46c1f */
    /* semantifold:ordered-expression:cpp:v1 begin 000013 b21b69530893ea0af5fe00842ce777054f381970aec954d167330d54bfc8c521 */
    std::int64_t semantifold_ordered_000016 = mark(std::string("\162\145\164\165\162\156\055\154\145\146\164", 11), result);
    std::int64_t semantifold_ordered_000017 = mark(std::string("\162\145\164\165\162\156\055\162\151\147\150\164", 12), right);
    std::int64_t semantifold_ordered_000018 = semantifold_integer_add(semantifold_ordered_000016, semantifold_ordered_000017);
    return semantifold_ordered_000018;
    /* semantifold:ordered-expression:cpp:v1 end 000013 b21b69530893ea0af5fe00842ce777054f381970aec954d167330d54bfc8c521 */
}

int main() {
    /* semantifold:ordered-expression:cpp:v1 begin 000014 8a2196f156d4756d98f0fab787ffd517e07bf9c963150708ad30fd3a076dbb23 */
    std::int64_t semantifold_ordered_000019 = mark(std::string("\141\162\147\055\154\145\146\164", 8), std::int64_t(3));
    std::int64_t semantifold_ordered_000020 = mark(std::string("\141\162\147\055\162\151\147\150\164", 9), std::int64_t(4));
    std::int64_t semantifold_ordered_000021 = compute(semantifold_ordered_000019, semantifold_ordered_000020);
    semantifold_print_integer(semantifold_ordered_000021);
    /* semantifold:ordered-expression:cpp:v1 end 000014 8a2196f156d4756d98f0fab787ffd517e07bf9c963150708ad30fd3a076dbb23 */
    /* semantifold:ordered-expression:cpp:v1 begin 000015 dbf531245ed8faa8e86c32c9e959879032f96515ceb6e322038738a234623e8e */
    bool semantifold_ordered_000022 = flag(std::string("\164\162\165\145\055\141\156\144\055\154\145\146\164", 13), true);
    bool semantifold_ordered_000023 = semantifold_ordered_000022;
    if (semantifold_ordered_000023) {
        bool semantifold_ordered_000024 = flag(std::string("\164\162\165\145\055\141\156\144\055\162\151\147\150\164", 14), true);
        semantifold_ordered_000023 = (semantifold_ordered_000023 && semantifold_ordered_000024);
    }
    semantifold_print_boolean(semantifold_ordered_000023);
    /* semantifold:ordered-expression:cpp:v1 end 000015 dbf531245ed8faa8e86c32c9e959879032f96515ceb6e322038738a234623e8e */
    /* semantifold:ordered-expression:cpp:v1 begin 000016 b8be69dd95826935593e4912972d7362529b86420c3b5b2b239c268390fc5b3b */
    bool semantifold_ordered_000025 = flag(std::string("\146\141\154\163\145\055\157\162\055\154\145\146\164", 13), false);
    bool semantifold_ordered_000026 = semantifold_ordered_000025;
    if (!semantifold_ordered_000026) {
        bool semantifold_ordered_000027 = flag(std::string("\146\141\154\163\145\055\157\162\055\162\151\147\150\164", 14), true);
        semantifold_ordered_000026 = (semantifold_ordered_000026 || semantifold_ordered_000027);
    }
    semantifold_print_boolean(semantifold_ordered_000026);
    /* semantifold:ordered-expression:cpp:v1 end 000016 b8be69dd95826935593e4912972d7362529b86420c3b5b2b239c268390fc5b3b */
    /* semantifold:ordered-expression:cpp:v1 begin 000017 0f650efded53198ed8c1c780341341520935b2c640c3d0385cb842ac979a9aad */
    bool semantifold_ordered_000028 = flag(std::string("\164\162\165\145\055\157\162\055\154\145\146\164", 12), true);
    bool semantifold_ordered_000029 = semantifold_ordered_000028;
    if (!semantifold_ordered_000029) {
        bool semantifold_ordered_000030 = flag(std::string("\163\153\151\160\160\145\144\055\164\162\165\145\055\157\162\055\162\151\147\150\164", 21), false);
        semantifold_ordered_000029 = (semantifold_ordered_000029 || semantifold_ordered_000030);
    }
    semantifold_print_boolean(semantifold_ordered_000029);
    /* semantifold:ordered-expression:cpp:v1 end 000017 0f650efded53198ed8c1c780341341520935b2c640c3d0385cb842ac979a9aad */
    /* semantifold:ordered-expression:cpp:v1 begin 000018 be9ad0d12e2eecfe8ac5a3a1c5bc3a05c9103cf693c3fbb8e901fb70768e4b2a */
    std::string semantifold_ordered_000031 = piece(std::string("\163\164\162\151\156\147\055\154\145\146\164", 11), std::string("\303\251\000", 3));
    std::string semantifold_ordered_000032 = piece(std::string("\163\164\162\151\156\147\055\162\151\147\150\164", 12), std::string("\360\237\230\200", 4));
    std::string semantifold_ordered_000033 = semantifold_string_concat(semantifold_ordered_000031, semantifold_ordered_000032);
    semantifold_print_string(semantifold_ordered_000033);
    /* semantifold:ordered-expression:cpp:v1 end 000018 be9ad0d12e2eecfe8ac5a3a1c5bc3a05c9103cf693c3fbb8e901fb70768e4b2a */
    return 0;
}
