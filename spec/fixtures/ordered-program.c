/* semantifold:program:c:v1 */
#include "semantifold_runtime.h"

static int64_t mark(SemantifoldString label, int64_t value);
static bool flag(SemantifoldString label, bool value);
static SemantifoldString piece(SemantifoldString label, SemantifoldString value);
static int64_t compute(int64_t left, int64_t right);

static int64_t mark(SemantifoldString label, int64_t value) {
    (void)label;
    (void)value;
    /* semantifold:ordered-expression:c:v1 begin 000001 48552432718f56d26bdca9ec9335811141dd0538d52a5216cd31a7bab495e5f5 */
    semantifold_print_string(label);
    /* semantifold:ordered-expression:c:v1 end 000001 48552432718f56d26bdca9ec9335811141dd0538d52a5216cd31a7bab495e5f5 */
    /* semantifold:ordered-expression:c:v1 begin 000002 946830abdfcf996cbd4995e6b8916ad98f49e3b5e852d03fcdeae8d44e48ab7b */
    return value;
    /* semantifold:ordered-expression:c:v1 end 000002 946830abdfcf996cbd4995e6b8916ad98f49e3b5e852d03fcdeae8d44e48ab7b */
}

static bool flag(SemantifoldString label, bool value) {
    (void)label;
    (void)value;
    /* semantifold:ordered-expression:c:v1 begin 000003 48552432718f56d26bdca9ec9335811141dd0538d52a5216cd31a7bab495e5f5 */
    semantifold_print_string(label);
    /* semantifold:ordered-expression:c:v1 end 000003 48552432718f56d26bdca9ec9335811141dd0538d52a5216cd31a7bab495e5f5 */
    /* semantifold:ordered-expression:c:v1 begin 000004 946830abdfcf996cbd4995e6b8916ad98f49e3b5e852d03fcdeae8d44e48ab7b */
    return value;
    /* semantifold:ordered-expression:c:v1 end 000004 946830abdfcf996cbd4995e6b8916ad98f49e3b5e852d03fcdeae8d44e48ab7b */
}

static SemantifoldString piece(SemantifoldString label, SemantifoldString value) {
    (void)label;
    (void)value;
    /* semantifold:ordered-expression:c:v1 begin 000005 48552432718f56d26bdca9ec9335811141dd0538d52a5216cd31a7bab495e5f5 */
    semantifold_print_string(label);
    /* semantifold:ordered-expression:c:v1 end 000005 48552432718f56d26bdca9ec9335811141dd0538d52a5216cd31a7bab495e5f5 */
    /* semantifold:ordered-expression:c:v1 begin 000006 946830abdfcf996cbd4995e6b8916ad98f49e3b5e852d03fcdeae8d44e48ab7b */
    return value;
    /* semantifold:ordered-expression:c:v1 end 000006 946830abdfcf996cbd4995e6b8916ad98f49e3b5e852d03fcdeae8d44e48ab7b */
}

static int64_t compute(int64_t left, int64_t right) {
    (void)left;
    (void)right;
    /* semantifold:ordered-expression:c:v1 begin 000007 027d7934434c7336d9b8cac7b8d4cc09a2d4ea03e0348cc88aa2cca1215021fa */
    int64_t semantifold_ordered_000001 = mark(SEMANTIFOLD_STRING("\151\156\151\164\151\141\154\055\154\145\146\164"), left);
    int64_t semantifold_ordered_000002 = mark(SEMANTIFOLD_STRING("\151\156\151\164\151\141\154\055\162\151\147\150\164"), right);
    int64_t semantifold_ordered_000003 = semantifold_integer_add(semantifold_ordered_000001, semantifold_ordered_000002);
    int64_t result = semantifold_ordered_000003;
    (void)result;
    /* semantifold:ordered-expression:c:v1 end 000007 027d7934434c7336d9b8cac7b8d4cc09a2d4ea03e0348cc88aa2cca1215021fa */
    /* semantifold:ordered-expression:c:v1 begin 000008 58a67cc7cfbf0d5856ced90ba88f34b423dbfd7c2882cb8e6f0aa53c1d5529ce */
    int64_t semantifold_ordered_000004 = mark(SEMANTIFOLD_STRING("\141\163\163\151\147\156\055\154\145\146\164"), result);
    int64_t semantifold_ordered_000005 = mark(SEMANTIFOLD_STRING("\141\163\163\151\147\156\055\162\151\147\150\164"), right);
    int64_t semantifold_ordered_000006 = semantifold_integer_subtract(semantifold_ordered_000004, semantifold_ordered_000005);
    result = semantifold_ordered_000006;
    /* semantifold:ordered-expression:c:v1 end 000008 58a67cc7cfbf0d5856ced90ba88f34b423dbfd7c2882cb8e6f0aa53c1d5529ce */
    /* semantifold:ordered-expression:c:v1 begin 000009 4df8d6ad37a3a9e9968f66db44eebc190c875a4f6af112a5e2efb5f3db55a23f */
    bool semantifold_ordered_000007 = flag(SEMANTIFOLD_STRING("\164\145\163\164"), true);
    if (semantifold_ordered_000007) {
        /* semantifold:ordered-expression:c:v1 begin 000010 421f152ded1743f123009474b736a9752718a92df4f6003f24320f461f8618a1 */
        int64_t semantifold_ordered_000008 = mark(SEMANTIFOLD_STRING("\160\162\151\156\164\055\154\145\146\164"), left);
        int64_t semantifold_ordered_000009 = mark(SEMANTIFOLD_STRING("\160\162\151\156\164\055\162\151\147\150\164"), right);
        int64_t semantifold_ordered_000010 = semantifold_integer_multiply(semantifold_ordered_000008, semantifold_ordered_000009);
        semantifold_print_integer(semantifold_ordered_000010);
        /* semantifold:ordered-expression:c:v1 end 000010 421f152ded1743f123009474b736a9752718a92df4f6003f24320f461f8618a1 */
    }
    /* semantifold:ordered-expression:c:v1 end 000009 4df8d6ad37a3a9e9968f66db44eebc190c875a4f6af112a5e2efb5f3db55a23f */
    /* semantifold:ordered-expression:c:v1 begin 000011 800b39a0503596589ab039b6b9fc0d29fcd82f295f7a3cb73ce9ff80e6a46c1f */
    bool semantifold_ordered_000011 = flag(SEMANTIFOLD_STRING("\141\156\144\055\154\145\146\164"), false);
    bool semantifold_ordered_000012 = semantifold_ordered_000011;
    if (semantifold_ordered_000012) {
        bool semantifold_ordered_000013 = flag(SEMANTIFOLD_STRING("\163\153\151\160\160\145\144\055\157\162\055\154\145\146\164"), true);
        bool semantifold_ordered_000014 = semantifold_ordered_000013;
        if (!semantifold_ordered_000014) {
            bool semantifold_ordered_000015 = flag(SEMANTIFOLD_STRING("\163\153\151\160\160\145\144\055\157\162\055\162\151\147\150\164"), false);
            semantifold_ordered_000014 = (semantifold_ordered_000014 || semantifold_ordered_000015);
        }
        semantifold_ordered_000012 = (semantifold_ordered_000012 && semantifold_ordered_000014);
    }
    if (semantifold_ordered_000012) {
        /* semantifold:ordered-expression:c:v1 begin 000012 bedf96617ed0e1762eac4088258076a43077e572e4d1836bdaec10130412a1d1 */
        return right;
        /* semantifold:ordered-expression:c:v1 end 000012 bedf96617ed0e1762eac4088258076a43077e572e4d1836bdaec10130412a1d1 */
    }
    /* semantifold:ordered-expression:c:v1 end 000011 800b39a0503596589ab039b6b9fc0d29fcd82f295f7a3cb73ce9ff80e6a46c1f */
    /* semantifold:ordered-expression:c:v1 begin 000013 b21b69530893ea0af5fe00842ce777054f381970aec954d167330d54bfc8c521 */
    int64_t semantifold_ordered_000016 = mark(SEMANTIFOLD_STRING("\162\145\164\165\162\156\055\154\145\146\164"), result);
    int64_t semantifold_ordered_000017 = mark(SEMANTIFOLD_STRING("\162\145\164\165\162\156\055\162\151\147\150\164"), right);
    int64_t semantifold_ordered_000018 = semantifold_integer_add(semantifold_ordered_000016, semantifold_ordered_000017);
    return semantifold_ordered_000018;
    /* semantifold:ordered-expression:c:v1 end 000013 b21b69530893ea0af5fe00842ce777054f381970aec954d167330d54bfc8c521 */
}

int main(void) {
    (void)mark;
    (void)flag;
    (void)piece;
    (void)compute;
    /* semantifold:ordered-expression:c:v1 begin 000014 8a2196f156d4756d98f0fab787ffd517e07bf9c963150708ad30fd3a076dbb23 */
    int64_t semantifold_ordered_000019 = mark(SEMANTIFOLD_STRING("\141\162\147\055\154\145\146\164"), INT64_C(3));
    int64_t semantifold_ordered_000020 = mark(SEMANTIFOLD_STRING("\141\162\147\055\162\151\147\150\164"), INT64_C(4));
    int64_t semantifold_ordered_000021 = compute(semantifold_ordered_000019, semantifold_ordered_000020);
    semantifold_print_integer(semantifold_ordered_000021);
    /* semantifold:ordered-expression:c:v1 end 000014 8a2196f156d4756d98f0fab787ffd517e07bf9c963150708ad30fd3a076dbb23 */
    /* semantifold:ordered-expression:c:v1 begin 000015 dbf531245ed8faa8e86c32c9e959879032f96515ceb6e322038738a234623e8e */
    bool semantifold_ordered_000022 = flag(SEMANTIFOLD_STRING("\164\162\165\145\055\141\156\144\055\154\145\146\164"), true);
    bool semantifold_ordered_000023 = semantifold_ordered_000022;
    if (semantifold_ordered_000023) {
        bool semantifold_ordered_000024 = flag(SEMANTIFOLD_STRING("\164\162\165\145\055\141\156\144\055\162\151\147\150\164"), true);
        semantifold_ordered_000023 = (semantifold_ordered_000023 && semantifold_ordered_000024);
    }
    semantifold_print_boolean(semantifold_ordered_000023);
    /* semantifold:ordered-expression:c:v1 end 000015 dbf531245ed8faa8e86c32c9e959879032f96515ceb6e322038738a234623e8e */
    /* semantifold:ordered-expression:c:v1 begin 000016 b8be69dd95826935593e4912972d7362529b86420c3b5b2b239c268390fc5b3b */
    bool semantifold_ordered_000025 = flag(SEMANTIFOLD_STRING("\146\141\154\163\145\055\157\162\055\154\145\146\164"), false);
    bool semantifold_ordered_000026 = semantifold_ordered_000025;
    if (!semantifold_ordered_000026) {
        bool semantifold_ordered_000027 = flag(SEMANTIFOLD_STRING("\146\141\154\163\145\055\157\162\055\162\151\147\150\164"), true);
        semantifold_ordered_000026 = (semantifold_ordered_000026 || semantifold_ordered_000027);
    }
    semantifold_print_boolean(semantifold_ordered_000026);
    /* semantifold:ordered-expression:c:v1 end 000016 b8be69dd95826935593e4912972d7362529b86420c3b5b2b239c268390fc5b3b */
    /* semantifold:ordered-expression:c:v1 begin 000017 0f650efded53198ed8c1c780341341520935b2c640c3d0385cb842ac979a9aad */
    bool semantifold_ordered_000028 = flag(SEMANTIFOLD_STRING("\164\162\165\145\055\157\162\055\154\145\146\164"), true);
    bool semantifold_ordered_000029 = semantifold_ordered_000028;
    if (!semantifold_ordered_000029) {
        bool semantifold_ordered_000030 = flag(SEMANTIFOLD_STRING("\163\153\151\160\160\145\144\055\164\162\165\145\055\157\162\055\162\151\147\150\164"), false);
        semantifold_ordered_000029 = (semantifold_ordered_000029 || semantifold_ordered_000030);
    }
    semantifold_print_boolean(semantifold_ordered_000029);
    /* semantifold:ordered-expression:c:v1 end 000017 0f650efded53198ed8c1c780341341520935b2c640c3d0385cb842ac979a9aad */
    /* semantifold:ordered-expression:c:v1 begin 000018 be9ad0d12e2eecfe8ac5a3a1c5bc3a05c9103cf693c3fbb8e901fb70768e4b2a */
    SemantifoldString semantifold_ordered_000031 = piece(SEMANTIFOLD_STRING("\163\164\162\151\156\147\055\154\145\146\164"), SEMANTIFOLD_STRING("\303\251\000"));
    SemantifoldString semantifold_ordered_000032 = piece(SEMANTIFOLD_STRING("\163\164\162\151\156\147\055\162\151\147\150\164"), SEMANTIFOLD_STRING("\360\237\230\200"));
    SemantifoldString semantifold_ordered_000033 = semantifold_string_concat(semantifold_ordered_000031, semantifold_ordered_000032);
    semantifold_print_string(semantifold_ordered_000033);
    /* semantifold:ordered-expression:c:v1 end 000018 be9ad0d12e2eecfe8ac5a3a1c5bc3a05c9103cf693c3fbb8e901fb70768e4b2a */
    semantifold_cleanup();
    return 0;
}
