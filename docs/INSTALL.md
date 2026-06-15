# Agent Browsers — Install Guide

A friendly, step-by-step setup for a new computer. No coding needed — you copy a
couple of commands and paste them in. About 10 minutes.

**Repo:** <https://github.com/Zbrooklyn/Agent-Browser-Monitor>

What you'll end up with: a dashboard at `http://127.0.0.1:8090` that shows every
Chrome/Edge browser running with "remote debugging" turned on, as live tiles you can
tap into, watch, and (optionally) control.

There are three pieces:

1. **Node.js** — the thing that runs the app (one-time install).
2. **The app** — a single file, `grid.cjs`, that you download.
3. **A browser to watch** — any Chrome/Edge launched with one extra setting.

---

## 1. Install Node.js (one time)

The app needs **Node.js version 22 or newer**.

- **Windows / macOS:** go to <https://nodejs.org>, download the **LTS** installer,
  run it, click Next through the prompts. Done.
- **Check it worked:** open a terminal and run:
  - Windows: press `Win`, type **PowerShell**, hit Enter.
  - macOS: press `Cmd+Space`, type **Terminal**, hit Enter.

  Then type:

  ```bash
  node --version
  ```

  You should see something like `v22.x.x`. If the number is **22 or higher**, you're set.
  (If it says "not recognized" or shows a number below 22, install/reinstall from
  nodejs.org and reopen the terminal.)

---

## 2. Get the app

**Easiest — download one file:**

1. Open <https://github.com/Zbrooklyn/Agent-Browser-Monitor>.
2. Click **`grid.cjs`** in the file list, then the **Download raw file** button
   (the download icon, top-right of the file view).
3. Save it somewhere easy, e.g. your **Downloads** folder.

**Or, if you have Git:** clone the whole repo instead:

```bash
git clone https://github.com/Zbrooklyn/Agent-Browser-Monitor.git
cd Agent-Browser-Monitor
```

---

## 3. Start the dashboard

In the terminal, go to wherever you saved the file and run it.

**Windows (PowerShell):**

```powershell
cd $HOME\Downloads        # or wherever grid.cjs is
node grid.cjs
```

**macOS (Terminal):**

```bash
cd ~/Downloads            # or wherever grid.cjs is
node grid.cjs
```

You'll see a line like `[grid] on http://127.0.0.1:8090`. Leave this window open —
it's the server. To stop it later, click the window and press `Ctrl+C`.

Now open a browser and go to **<http://127.0.0.1:8090>**.

It'll say "no agent browsers detected" — that's expected until you give it a browser to
watch (next step).

---

## 4. Give it a browser to watch

The dashboard only sees browsers started with **remote debugging** turned on. Open a
**second** terminal window and launch one:

**Windows (Chrome):**

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$HOME\.chrome-debug"
```

**Windows (Edge), if you don't have Chrome:**

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --user-data-dir="$HOME\.edge-debug"
```

**macOS (Chrome):**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug
```

> **The `--user-data-dir` part is required.** It tells the browser to open a separate
> profile. Without it, if Chrome/Edge is already open the setting is silently ignored and
> nothing shows up.

A fresh browser window opens. Browse to any site in it. Within a second or two it should
appear as a **live tile** on your dashboard at `http://127.0.0.1:8090`. Tap the tile for a
full-screen stream.

---

## 5. Using it

- **Watch:** tap any tile to open a big live view. Swipe left/right to move between
  browsers, pinch to zoom, tap the screen to hide the buttons.
- **Control (optional):** in the full-screen view, tap the green **Control** button. Now
  tapping the stream clicks the real page, the **Type** button gives you a keyboard, and
  dragging scrolls. Tap **Control** again to go back to watch-only.

---

## 6. (Optional) Keep it always running

The dashboard only runs while the terminal window from step 3 is open. If you want it to
stay up on its own — survive crashes and reclaim its port if something else grabs it —
the repo includes a small guardian script:

```powershell
powershell -ExecutionPolicy Bypass -File port-guardian.ps1 -Port 8090
```

To start it automatically every time you log in, see the **Keep it always-on** section of
the [README](https://github.com/Zbrooklyn/Agent-Browser-Monitor#readme). Skip this if you
are just trying it out.

## 7. (Optional) Watch it from your phone

The dashboard stays private to the computer it runs on. To reach it from a phone without
exposing anything to the internet, the simplest option is **Tailscale** (a free private
network):

1. Install Tailscale on both the computer and the phone from <https://tailscale.com>,
   and sign in with the same account on both.
2. On the computer, in a terminal:

   ```bash
   tailscale serve --bg 8090
   ```

3. It prints a `https://<name>.<something>.ts.net/` address. Open that on the phone
   (it only works on devices signed into your Tailscale) and add it to the home screen —
   it behaves like an app.

---

## Safety notes (please read)

- **No password protection.** Anyone who can reach the dashboard URL can watch — and, with
  Control on, *drive* — your browsers. Keep it on your own machine or your private
  Tailscale network. **Never put it on the public internet.**
- **Don't sign into Google/email through the Control feature.** Browsers started this way
  are flagged as "automated," so a freshly typed Google password gets rejected ("this
  browser may not be secure") — that's Google's rule, not a bug. Control is fine on pages
  you're *already* logged into; do the actual sign-in in a normal browser.

---

## If something's not working

- **Dashboard says "no agent browsers detected."** The watched browser isn't exposing the
  debug port. Re-check step 4 — most often the `--user-data-dir` was left off, or that
  browser was already open. Test the port directly: visit `http://127.0.0.1:9222/json` —
  you should get a page of text (a list of tabs). If that fails, the browser isn't
  listening.
- **`node: command not found` / `not recognized`.** Node didn't install or the terminal
  was open before you installed it. Reinstall from nodejs.org and open a **new** terminal.
- **`node --version` shows below 22.** Install the current LTS from nodejs.org.
- **Can't reach it from the phone.** Both devices must be signed into the *same* Tailscale
  account, and you must run `tailscale serve --bg 8090` on the computer first.

That's it — enjoy. Full details and options are in the main
[README](https://github.com/Zbrooklyn/Agent-Browser-Monitor#readme).
