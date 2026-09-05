#nullable enable

namespace Semantifold.Generated;

internal static class Program
{
    private static long difference(long left, long right)
    {
        return checked(left - right);
    }

    private static void Main()
    {
        System.Console.WriteLine(difference(4L, 9L));
    }
}
