/* semantifold:program:c:v1 */
#include "semantifold_runtime.h"

static SemantifoldString select(bool flag, SemantifoldString fallback);

static SemantifoldString select(bool flag, SemantifoldString fallback) {
    (void)flag;
    (void)fallback;
    /* semantifold:ordered-expression:c:v1 begin 000001 ebb6c087ce97bcb9fe3a3c6c24f12b26144894a6c0bf71d49dc3f193c05cfbc3 */
    SemantifoldString result = fallback;
    (void)result;
    /* semantifold:ordered-expression:c:v1 end 000001 ebb6c087ce97bcb9fe3a3c6c24f12b26144894a6c0bf71d49dc3f193c05cfbc3 */
    /* semantifold:ordered-expression:c:v1 begin 000002 48ea2cc331dd63d0a145cd419ccbfd1d22b8b65b64e855e571c9746e4da540bd */
    if (flag) {
        /* semantifold:ordered-expression:c:v1 begin 000003 10578fdf3eff85d9ce24895abe0d4964f49eadebbac7ff2f8dee7df8cf3bd282 */
        result = SEMANTIFOLD_STRING("\171\145\163");
        /* semantifold:ordered-expression:c:v1 end 000003 10578fdf3eff85d9ce24895abe0d4964f49eadebbac7ff2f8dee7df8cf3bd282 */
        /* semantifold:ordered-expression:c:v1 begin 000004 c5bb4cd0e9a472c6f4afbc0776c0b7f2ca4d09e802dc96eab928b2d1e63d2015 */
        semantifold_print_string(SEMANTIFOLD_STRING("\143\150\145\143\153\151\156\147"));
        /* semantifold:ordered-expression:c:v1 end 000004 c5bb4cd0e9a472c6f4afbc0776c0b7f2ca4d09e802dc96eab928b2d1e63d2015 */
        /* semantifold:ordered-expression:c:v1 begin 000005 d8182c24f6777b9e95925fa5fe9c02d88757fec82ea340a855219a6554f892c6 */
        bool semantifold_ordered_000001 = semantifold_string_equal(fallback, SEMANTIFOLD_STRING("\141\154\164"));
        if (semantifold_ordered_000001) {
            /* semantifold:ordered-expression:c:v1 begin 000006 2835df535bdc8c38528f6a7d3d9be1fbdf645a0fe6c57fb3b91e63905c668a21 */
            return fallback;
            /* semantifold:ordered-expression:c:v1 end 000006 2835df535bdc8c38528f6a7d3d9be1fbdf645a0fe6c57fb3b91e63905c668a21 */
        } else {
            /* semantifold:ordered-expression:c:v1 begin 000007 6fde59c6ae3238850b09b470dc7e2c01d8aad82657cdfea01ef808d07241307d */
            bool semantifold_ordered_000002 = semantifold_string_equal(fallback, SEMANTIFOLD_STRING("\156\157"));
            if (semantifold_ordered_000002) {
                /* semantifold:ordered-expression:c:v1 begin 000008 0ba4a8242741fd1dda87e459e9c5f9d4e5245064282cb6f2bd104840f3656edd */
                return result;
                /* semantifold:ordered-expression:c:v1 end 000008 0ba4a8242741fd1dda87e459e9c5f9d4e5245064282cb6f2bd104840f3656edd */
            } else {
                /* semantifold:ordered-expression:c:v1 begin 000009 c0e4c3357a7b48f077e81397fff75e925220ce58f983a1d524cb26ab1c196a59 */
                return SEMANTIFOLD_STRING("\157\164\150\145\162");
                /* semantifold:ordered-expression:c:v1 end 000009 c0e4c3357a7b48f077e81397fff75e925220ce58f983a1d524cb26ab1c196a59 */
            }
            /* semantifold:ordered-expression:c:v1 end 000007 6fde59c6ae3238850b09b470dc7e2c01d8aad82657cdfea01ef808d07241307d */
        }
        /* semantifold:ordered-expression:c:v1 end 000005 d8182c24f6777b9e95925fa5fe9c02d88757fec82ea340a855219a6554f892c6 */
    }
    /* semantifold:ordered-expression:c:v1 end 000002 48ea2cc331dd63d0a145cd419ccbfd1d22b8b65b64e855e571c9746e4da540bd */
    /* semantifold:ordered-expression:c:v1 begin 000010 0ba4a8242741fd1dda87e459e9c5f9d4e5245064282cb6f2bd104840f3656edd */
    return result;
    /* semantifold:ordered-expression:c:v1 end 000010 0ba4a8242741fd1dda87e459e9c5f9d4e5245064282cb6f2bd104840f3656edd */
}

int main(void) {
    (void)select;
    /* semantifold:ordered-expression:c:v1 begin 000011 ee4cf201750e3d1685a8ca099627e2fe81091ed41e291681bfd440c9abbe4c2d */
    SemantifoldString semantifold_ordered_000003 = select(true, SEMANTIFOLD_STRING("\156\157"));
    SemantifoldString output = semantifold_ordered_000003;
    (void)output;
    /* semantifold:ordered-expression:c:v1 end 000011 ee4cf201750e3d1685a8ca099627e2fe81091ed41e291681bfd440c9abbe4c2d */
    /* semantifold:ordered-expression:c:v1 begin 000012 9d74f8e8969dd2098e40b1956796947ce0535af915dfe5000bd93b2024616dc4 */
    semantifold_print_string(output);
    /* semantifold:ordered-expression:c:v1 end 000012 9d74f8e8969dd2098e40b1956796947ce0535af915dfe5000bd93b2024616dc4 */
    /* semantifold:ordered-expression:c:v1 begin 000013 c7773688d7dee3edb7ff2520cb9f579a7d59ac645a4e739c8573842a8ad94c74 */
    bool semantifold_ordered_000004 = semantifold_string_equal(output, SEMANTIFOLD_STRING("\171\145\163"));
    if (semantifold_ordered_000004) {
        /* semantifold:ordered-expression:c:v1 begin 000014 89fc69228244445594f32a6a345f285f7f1924f853274c9b71fe3bc8da6663a9 */
        semantifold_print_string(SEMANTIFOLD_STRING("\155\141\164\143\150\145\144"));
        /* semantifold:ordered-expression:c:v1 end 000014 89fc69228244445594f32a6a345f285f7f1924f853274c9b71fe3bc8da6663a9 */
    }
    /* semantifold:ordered-expression:c:v1 end 000013 c7773688d7dee3edb7ff2520cb9f579a7d59ac645a4e739c8573842a8ad94c74 */
    /* semantifold:ordered-expression:c:v1 begin 000015 ed18a8e04789032535b6b5e3fc8faa7c67ce8375fe4f16308d724fef81c69eb8 */
    SemantifoldString semantifold_ordered_000005 = select(false, SEMANTIFOLD_STRING("\146\141\154\154\142\141\143\153"));
    output = semantifold_ordered_000005;
    /* semantifold:ordered-expression:c:v1 end 000015 ed18a8e04789032535b6b5e3fc8faa7c67ce8375fe4f16308d724fef81c69eb8 */
    /* semantifold:ordered-expression:c:v1 begin 000016 9d74f8e8969dd2098e40b1956796947ce0535af915dfe5000bd93b2024616dc4 */
    semantifold_print_string(output);
    /* semantifold:ordered-expression:c:v1 end 000016 9d74f8e8969dd2098e40b1956796947ce0535af915dfe5000bd93b2024616dc4 */
    semantifold_cleanup();
    return 0;
}
