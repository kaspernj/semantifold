#nullable enable

namespace Semantifold.Generated;

internal static class Program
{
    private static long arithmetic(long left, long right)
    {
        if ((left < right) && !(left == right))
        {
            return checked(checked(-left) + checked(right * 2L));
        }
        else
        {
            return checked(left - right);
        }
    }

    private static bool ordered(long left, long right)
    {
        if (((left <= right) || (left >= right)) && (left != right))
        {
            return left > right;
        }
        else
        {
            return left < right;
        }
    }

    private static bool logic(bool left, bool right)
    {
        if (((!left) || right) && (left != right))
        {
            return left == right;
        }
        else
        {
            return left || right;
        }
    }

    private static string combine(string left, string right)
    {
        if ((left == right) || (left != right))
        {
            return left + ":" + right;
        }
        else
        {
            return left + right;
        }
    }

    private static string report(long left, long right)
    {
        if (((arithmetic(left, right) == 17L) && ordered(right, left)) && !logic(false, true))
        {
            return combine("typed", "operators");
        }
        else
        {
            return "bad";
        }
    }

    private static void Main()
    {
        System.Console.WriteLine(report(3L, 10L));
    }
}
