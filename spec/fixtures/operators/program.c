/* semantifold:program:c:v1 */
#include "semantifold_runtime.h"

static int64_t arithmetic(int64_t left, int64_t right);
static bool ordered(int64_t left, int64_t right);
static bool logic(bool left, bool right);
static SemantifoldString combine(SemantifoldString left, SemantifoldString right);
static SemantifoldString report(int64_t left, int64_t right);

static int64_t arithmetic(int64_t left, int64_t right) {
    (void)left;
    (void)right;
    /* semantifold:ordered-expression:c:v1 begin 000001 82ceeb98527260629e4639d9d160052d863f207765b1ce67510791063acb48fa */
    bool semantifold_ordered_000001 = (left < right);
    bool semantifold_ordered_000002 = semantifold_ordered_000001;
    if (semantifold_ordered_000002) {
        bool semantifold_ordered_000003 = (left == right);
        bool semantifold_ordered_000004 = !(semantifold_ordered_000003);
        semantifold_ordered_000002 = (semantifold_ordered_000002 && semantifold_ordered_000004);
    }
    if (semantifold_ordered_000002) {
        /* semantifold:ordered-expression:c:v1 begin 000002 6fa20fbec7d9d33ccbe09e8b265e443199e28064e2eb6a661a531ddfe385f6a0 */
        int64_t semantifold_ordered_000005 = semantifold_integer_negate(left);
        int64_t semantifold_ordered_000006 = semantifold_integer_multiply(right, INT64_C(2));
        int64_t semantifold_ordered_000007 = semantifold_integer_add(semantifold_ordered_000005, semantifold_ordered_000006);
        return semantifold_ordered_000007;
        /* semantifold:ordered-expression:c:v1 end 000002 6fa20fbec7d9d33ccbe09e8b265e443199e28064e2eb6a661a531ddfe385f6a0 */
    } else {
        /* semantifold:ordered-expression:c:v1 begin 000003 18cee81695dfee124b895b5d71b02cef500136671aa8a806aefc68004fbc3176 */
        int64_t semantifold_ordered_000008 = semantifold_integer_subtract(left, right);
        return semantifold_ordered_000008;
        /* semantifold:ordered-expression:c:v1 end 000003 18cee81695dfee124b895b5d71b02cef500136671aa8a806aefc68004fbc3176 */
    }
    /* semantifold:ordered-expression:c:v1 end 000001 82ceeb98527260629e4639d9d160052d863f207765b1ce67510791063acb48fa */
}

static bool ordered(int64_t left, int64_t right) {
    (void)left;
    (void)right;
    /* semantifold:ordered-expression:c:v1 begin 000004 a946c8b33b904e349270660023d2a826eada1b3b2c29b1c859ab476f158ef20f */
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
        /* semantifold:ordered-expression:c:v1 begin 000005 ad792081b7b4e08c05881dce0e6487d42260d8cf4e11c8bfe9ec3ffba3cd671d */
        bool semantifold_ordered_000014 = (left > right);
        return semantifold_ordered_000014;
        /* semantifold:ordered-expression:c:v1 end 000005 ad792081b7b4e08c05881dce0e6487d42260d8cf4e11c8bfe9ec3ffba3cd671d */
    } else {
        /* semantifold:ordered-expression:c:v1 begin 000006 e909f1b8235c7bccb0aab54ddb8f80994e41737ec5b8217e1295e031940e7c2a */
        bool semantifold_ordered_000015 = (left < right);
        return semantifold_ordered_000015;
        /* semantifold:ordered-expression:c:v1 end 000006 e909f1b8235c7bccb0aab54ddb8f80994e41737ec5b8217e1295e031940e7c2a */
    }
    /* semantifold:ordered-expression:c:v1 end 000004 a946c8b33b904e349270660023d2a826eada1b3b2c29b1c859ab476f158ef20f */
}

static bool logic(bool left, bool right) {
    (void)left;
    (void)right;
    /* semantifold:ordered-expression:c:v1 begin 000007 d90370e4cf504f546c69d6a73aedc7ca595f618ece0ff2170ff9349fde424578 */
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
        /* semantifold:ordered-expression:c:v1 begin 000008 0eb4ce50cf5e1853b70f35be18c88de9b7031634ed6565fdfb67ffb8daed0c58 */
        bool semantifold_ordered_000020 = (left == right);
        return semantifold_ordered_000020;
        /* semantifold:ordered-expression:c:v1 end 000008 0eb4ce50cf5e1853b70f35be18c88de9b7031634ed6565fdfb67ffb8daed0c58 */
    } else {
        /* semantifold:ordered-expression:c:v1 begin 000009 ca8a24d457445ddf25344978773289f053db4a4a3d7c8b35760d7aef8d547339 */
        bool semantifold_ordered_000021 = left;
        if (!semantifold_ordered_000021) {
            semantifold_ordered_000021 = (semantifold_ordered_000021 || right);
        }
        return semantifold_ordered_000021;
        /* semantifold:ordered-expression:c:v1 end 000009 ca8a24d457445ddf25344978773289f053db4a4a3d7c8b35760d7aef8d547339 */
    }
    /* semantifold:ordered-expression:c:v1 end 000007 d90370e4cf504f546c69d6a73aedc7ca595f618ece0ff2170ff9349fde424578 */
}

static SemantifoldString combine(SemantifoldString left, SemantifoldString right) {
    (void)left;
    (void)right;
    /* semantifold:ordered-expression:c:v1 begin 000010 7d005a0b3685bf98a776cb8c96c8e6b17c60a4de7fc0632f2645fdef0f33120e */
    bool semantifold_ordered_000022 = semantifold_string_equal(left, right);
    bool semantifold_ordered_000023 = semantifold_ordered_000022;
    if (!semantifold_ordered_000023) {
        bool semantifold_ordered_000024 = semantifold_string_not_equal(left, right);
        semantifold_ordered_000023 = (semantifold_ordered_000023 || semantifold_ordered_000024);
    }
    if (semantifold_ordered_000023) {
        /* semantifold:ordered-expression:c:v1 begin 000011 611467205603b2a3d4eaaa70f3644a7ad85ae1565941369ec0575380378c39c7 */
        SemantifoldString semantifold_ordered_000025 = semantifold_string_concat(left, SEMANTIFOLD_STRING("\072"));
        SemantifoldString semantifold_ordered_000026 = semantifold_string_concat(semantifold_ordered_000025, right);
        return semantifold_ordered_000026;
        /* semantifold:ordered-expression:c:v1 end 000011 611467205603b2a3d4eaaa70f3644a7ad85ae1565941369ec0575380378c39c7 */
    } else {
        /* semantifold:ordered-expression:c:v1 begin 000012 c0ebc48f15279bf5be9a4bc762c8c62d07af1300ffafa2ad83865838035485ba */
        SemantifoldString semantifold_ordered_000027 = semantifold_string_concat(left, right);
        return semantifold_ordered_000027;
        /* semantifold:ordered-expression:c:v1 end 000012 c0ebc48f15279bf5be9a4bc762c8c62d07af1300ffafa2ad83865838035485ba */
    }
    /* semantifold:ordered-expression:c:v1 end 000010 7d005a0b3685bf98a776cb8c96c8e6b17c60a4de7fc0632f2645fdef0f33120e */
}

static SemantifoldString report(int64_t left, int64_t right) {
    (void)left;
    (void)right;
    /* semantifold:ordered-expression:c:v1 begin 000013 b1792db8f16d8c2e2b6afcada115dd7afaac3c4bec36dea929de07f6d55ed50e */
    int64_t semantifold_ordered_000028 = arithmetic(left, right);
    bool semantifold_ordered_000029 = (semantifold_ordered_000028 == INT64_C(17));
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
        /* semantifold:ordered-expression:c:v1 begin 000014 5896eeabaa572cd9f2df0aae4dc85f7ab1ae5485f76d9d27ed2668fcaa196942 */
        SemantifoldString semantifold_ordered_000035 = combine(SEMANTIFOLD_STRING("\164\171\160\145\144"), SEMANTIFOLD_STRING("\157\160\145\162\141\164\157\162\163"));
        return semantifold_ordered_000035;
        /* semantifold:ordered-expression:c:v1 end 000014 5896eeabaa572cd9f2df0aae4dc85f7ab1ae5485f76d9d27ed2668fcaa196942 */
    } else {
        /* semantifold:ordered-expression:c:v1 begin 000015 665fb78f1a14779b2df64012aa375161df8b9fca0efecb7107d135d0fe94a30d */
        return SEMANTIFOLD_STRING("\142\141\144");
        /* semantifold:ordered-expression:c:v1 end 000015 665fb78f1a14779b2df64012aa375161df8b9fca0efecb7107d135d0fe94a30d */
    }
    /* semantifold:ordered-expression:c:v1 end 000013 b1792db8f16d8c2e2b6afcada115dd7afaac3c4bec36dea929de07f6d55ed50e */
}

int main(void) {
    (void)arithmetic;
    (void)ordered;
    (void)logic;
    (void)combine;
    (void)report;
    /* semantifold:ordered-expression:c:v1 begin 000016 4eff6eb36f289bbc1dc29c1dad5a6c1fa57c47b17f102d96de38baceeaceaff9 */
    SemantifoldString semantifold_ordered_000036 = report(INT64_C(3), INT64_C(10));
    semantifold_print_string(semantifold_ordered_000036);
    /* semantifold:ordered-expression:c:v1 end 000016 4eff6eb36f289bbc1dc29c1dad5a6c1fa57c47b17f102d96de38baceeaceaff9 */
    semantifold_cleanup();
    return 0;
}
