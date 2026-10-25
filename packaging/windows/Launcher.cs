using System;
using System.Diagnostics;
using System.IO;
using System.Text;

// 浏览器需要真正的 exe 宿主；不经过 cmd.exe，继承 Native Messaging 标准流。
class BeeHelperLauncher {
    static string Quote(string value) {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value) {
            if (character == '\\') { slashes++; continue; }
            result.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
            result.Append(character); slashes = 0;
        }
        result.Append('\\', slashes * 2); result.Append('"');
        return result.ToString();
    }
    static int Main(string[] args) {
        try {
            string root = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            string arguments = Quote(Path.Combine(root, "connector", "host.mjs"));
            foreach (string arg in args) arguments += " " + Quote(arg);
            var info = new ProcessStartInfo(Path.Combine(root, "runtime", "node.exe"), arguments);
            info.UseShellExecute = false; info.CreateNoWindow = true;
            using (var child = Process.Start(info)) { child.WaitForExit(); return child.ExitCode; }
        } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
