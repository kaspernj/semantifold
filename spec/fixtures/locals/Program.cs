#nullable enable

namespace Semantifold.Generated;

internal static class Program
{
    private static string choose(bool flag, string fallback)
    {
        // @semantifold-immutable
        string preferred = "yes";
        string result = fallback;
        if (flag)
        {
            result = preferred;
            return result;
        }
        else
        {
            return result;
        }
    }

    private static void Main()
    {
        string output = "no";
        output = choose(true, output);
        System.Console.WriteLine(output);
    }
}
