#nullable enable

namespace Semantifold.Generated;

internal static class Program
{
    private static string label(bool flag, string fallback)
    {
        if (flag)
        {
            return "yes";
        }
        else
        {
            return fallback;
        }
    }

    private static void Main()
    {
        System.Console.WriteLine(label(true, "no"));
    }
}
