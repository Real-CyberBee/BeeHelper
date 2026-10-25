using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Threading;

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
    static async Task Pump(Stream input, Stream output) {
        var buffer = new byte[8192]; int count;
        while ((count = await input.ReadAsync(buffer, 0, buffer.Length)) > 0) {
            await output.WriteAsync(buffer, 0, count);
            // FileStream 有缓冲；Native Messaging 帧必须立即送达，而不能等到 EOF。
            await output.FlushAsync();
        }
    }
    static int Main(string[] args) {
        try {
            string root = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            string arguments = Quote(Path.Combine(root, "connector", "host.mjs"));
            foreach (string arg in args) arguments += " " + Quote(arg);
            var info = new ProcessStartInfo(Path.Combine(root, "runtime", "node.exe"), arguments);
            info.UseShellExecute = false; info.CreateNoWindow = true;
            info.RedirectStandardInput = true; info.RedirectStandardOutput = true; info.RedirectStandardError = true;
            using (var child = Process.Start(info)) {
                // 显式转发二进制流；.NET 默认继承无法保证浏览器的管道句柄可继承。
                var input = Pump(Console.OpenStandardInput(), child.StandardInput.BaseStream).ContinueWith(task => {
                    try { child.StandardInput.Close(); } catch (ObjectDisposedException) { }
                });
                var output = Pump(child.StandardOutput.BaseStream, Console.OpenStandardOutput());
                var error = Pump(child.StandardError.BaseStream, Console.OpenStandardError());
                child.WaitForExit(); Task.WaitAll(output, error); return child.ExitCode;
            }
        } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
