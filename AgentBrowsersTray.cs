// Agent Browsers — system-tray controller.
// A visible indicator + control surface for the dashboard, so it never runs invisibly:
//   - green dot = server up on its port, grey = down / starting
//   - right-click: Open dashboard, Copy phone link, Restart server, Quit
//   - it owns the port guardian (keeps grid.cjs on the port); Quit fully stops everything
//   - shows in Task Manager as "AgentBrowsers.exe" (a clear name, not a mystery node.exe)
// Build: csc /target:winexe /r:System.Windows.Forms.dll /r:System.Drawing.dll
//            /r:System.Management.dll /out:AgentBrowsers.exe AgentBrowsersTray.cs
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Management;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace AgentBrowsers
{
    static class Program
    {
        const int Port = 8090;
        static NotifyIcon tray;
        static System.Windows.Forms.Timer timer;
        static Process guardian;
        static Icon upIcon, downIcon;
        static bool isUp = false;

        [STAThread]
        static void Main()
        {
            bool createdNew;
            Mutex mutex = new Mutex(true, "AgentBrowsersTray_SingleInstance", out createdNew);
            if (!createdNew) return;            // already running in this session
            GC.KeepAlive(mutex);

            Application.EnableVisualStyles();
            upIcon = MakeDot(Color.FromArgb(62, 207, 142));     // phosphor green = up
            downIcon = MakeDot(Color.FromArgb(130, 130, 138));  // grey = down / starting

            tray = new NotifyIcon();
            tray.Icon = downIcon;
            tray.Text = "Agent Browsers - starting...";
            tray.Visible = true;

            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("Open dashboard", null, delegate { OpenDashboard(); });
            menu.Items.Add("Copy phone link", null, delegate { CopyPhoneLink(); });
            menu.Items.Add("Restart server", null, delegate { RestartServer(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit", null, delegate { QuitApp(); });
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += delegate { OpenDashboard(); };

            StartGuardian();

            timer = new System.Windows.Forms.Timer();
            timer.Interval = 4000;
            timer.Tick += delegate { Tick(); };
            timer.Start();
            Tick();

            Application.Run();
        }

        static string BaseDir()
        {
            return Path.GetDirectoryName(Application.ExecutablePath);
        }

        static Icon MakeDot(Color c)
        {
            Bitmap bmp = new Bitmap(32, 32);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                using (SolidBrush b = new SolidBrush(c))
                    g.FillEllipse(b, 5, 5, 22, 22);
            }
            return Icon.FromHandle(bmp.GetHicon());
        }

        // Spawn (or respawn) the port guardian, which keeps grid.cjs bound to the port.
        static void StartGuardian()
        {
            try
            {
                if (guardian != null && !guardian.HasExited) return;
                string script = Path.Combine(BaseDir(), "port-guardian.ps1");
                int myPid = Process.GetCurrentProcess().Id;
                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe",
                    "-WindowStyle Hidden -ExecutionPolicy Bypass -NoProfile -File \"" + script + "\" -Port " + Port + " -OwnerPid " + myPid);
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                guardian = Process.Start(psi);
            }
            catch { }
        }

        static void Tick()
        {
            StartGuardian();                 // keep the guardian alive too
            bool up = Probe();
            if (up != isUp)
            {
                isUp = up;
                tray.Icon = up ? upIcon : downIcon;
            }
            tray.Text = up
                ? "Agent Browsers - running on http://127.0.0.1:" + Port
                : "Agent Browsers - starting...";
        }

        static bool Probe()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + Port + "/");
                req.Timeout = 2000;
                req.Method = "GET";
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    return (int)resp.StatusCode == 200;
            }
            catch { return false; }
        }

        static void OpenDashboard()
        {
            try { Process.Start("http://127.0.0.1:" + Port + "/"); }
            catch { }
        }

        static void CopyPhoneLink()
        {
            string url = TailscaleUrl();
            bool ts = !string.IsNullOrEmpty(url);
            if (!ts) url = "http://127.0.0.1:" + Port + "/";
            try { Clipboard.SetText(url); } catch { }
            Balloon("Agent Browsers", (ts ? "Phone link copied:\n" : "No Tailscale link found - copied local URL:\n") + url);
        }

        // Best-effort: read the tailnet HTTPS URL from `tailscale serve status`.
        static string TailscaleUrl()
        {
            try
            {
                string ts = @"C:\Program Files\Tailscale\tailscale.exe";
                if (!File.Exists(ts)) return null;
                ProcessStartInfo psi = new ProcessStartInfo(ts, "serve status");
                psi.RedirectStandardOutput = true;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                Process p = Process.Start(psi);
                string outp = p.StandardOutput.ReadToEnd();
                p.WaitForExit(4000);
                Match m = Regex.Match(outp, @"https://[^\s]+\.ts\.net[^\s]*");
                if (m.Success) return m.Value.TrimEnd('/') + "/";
            }
            catch { }
            return null;
        }

        // Kill grid.cjs; the guardian rebinds it within a few seconds.
        static void KillGrid()
        {
            try
            {
                using (ManagementObjectSearcher s = new ManagementObjectSearcher(
                    "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='node.exe'"))
                {
                    foreach (ManagementObject o in s.Get())
                    {
                        object cmdObj = o["CommandLine"];
                        string cmd = cmdObj == null ? "" : cmdObj.ToString();
                        if (cmd.Contains("grid.cjs"))
                        {
                            try { Process.GetProcessById(Convert.ToInt32(o["ProcessId"])).Kill(); }
                            catch { }
                        }
                    }
                }
            }
            catch { }
        }

        static void RestartServer()
        {
            KillGrid();
            Balloon("Agent Browsers", "Restarting server...");
        }

        static void QuitApp()
        {
            try { if (guardian != null && !guardian.HasExited) guardian.Kill(); }
            catch { }
            KillGrid();
            if (timer != null) timer.Stop();
            if (tray != null) tray.Visible = false;
            Application.Exit();
        }

        static void Balloon(string title, string text)
        {
            try
            {
                tray.BalloonTipTitle = title;
                tray.BalloonTipText = text;
                tray.ShowBalloonTip(2500);
            }
            catch { }
        }
    }
}
