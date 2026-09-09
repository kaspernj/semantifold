#nullable enable

namespace Semantifold.Generated;

internal static class Program
{
    private static long difference(long left, long right)
    {
        if (left > right)
        {
            return checked(left - right);
        }
        else
        {
            return checked(right - left);
        }
    }

    private static void Main()
    {
        System.Console.WriteLine(difference(4L, 9L));
    }
}
