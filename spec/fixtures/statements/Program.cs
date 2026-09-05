#nullable enable

namespace Semantifold.Generated;

internal static class Program
{
    private static string choose(bool flag, string fallback)
    {
        string result = fallback;
        if (flag)
        {
            result = "yes";
            System.Console.WriteLine("checking");
            if (fallback == "alt")
            {
                return fallback;
            }
            else if (fallback == "no")
            {
                return result;
            }
            else
            {
                return "other";
            }
        }
        return result;
    }

    private static void Main()
    {
        string output = choose(true, "no");
        System.Console.WriteLine(output);
        if (output == "yes")
        {
            System.Console.WriteLine("matched");
        }
        output = choose(false, "fallback");
        System.Console.WriteLine(output);
    }
}
