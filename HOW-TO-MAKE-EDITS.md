# How to Make an Edit Safely — Quick Guide

No coding experience needed. You'll describe what you want changed in plain English,
and Claude will make the edit for you. Just follow these steps in order, every time.

---

## ⚠️ Read this first — the most important rule

When you preview the app on your computer (steps below), it is **NOT a fake/test copy**.
It connects to the **real, live company database** — the same one everyone uses at work
right now.

That means:
- Looking around and clicking through screens is fine.
- **Do NOT click Save, Submit, Complete, Delete, or Approve** on anything unless
  Josiah specifically told you to test that exact button. Those actions change real
  work orders, real purchase orders, and real production data.
- If you're not sure whether a click is "safe," stop and ask before clicking it.

---

## Step 1 — Open the project

1. Open **VS Code**.
2. File → Open Folder → select the `WO-Progress-Kiosk` folder.
3. Wait for the file list to appear on the left side.

## Step 2 — Ask Claude to make your edit

1. Open a terminal: top menu → **Terminal → New Terminal**.
   (A black/dark text box will open at the bottom of the screen.)
2. Click inside that box, type `claude`, and press Enter. Wait for it to start up.
3. Describe **only the one change** you were asked to make, in plain English. Be
   specific — say exactly what should change and where, e.g. "On the Office screen,
   change the button that says 'Close Out' to say 'Complete'." Don't bundle several
   unrelated changes into one request.
4. Claude will explain what it's about to do and may ask you to approve a step
   (a permission prompt). Only approve things that clearly match what you asked for.
   If Claude wants to do something you didn't ask for or don't understand — press
   **No** and ask Josiah before continuing.
5. When Claude says it's done, read its summary. If it doesn't match what you wanted,
   just tell it so in the same chat ("that's not quite right, please also...") —
   don't start over from scratch.

## Step 3 — Preview your change (view it like a webpage)

1. Open a **second** terminal (Terminal → New Terminal again — keep the Claude one
   open too) so Claude keeps running while you preview.
2. In the new terminal, type exactly this, then press Enter:

   ```
   python -m http.server 8000
   ```

3. Leave that terminal window open and running — don't close it or type anything
   else in it while you're previewing.
4. Open a web browser (Chrome, Edge, etc.) and go to this address:

   ```
   http://localhost:8000
   ```

5. The app will load. Find the screen where your change should show up and check
   that it looks right — remembering the warning above about not clicking
   Save/Submit/Delete/Complete/Approve on real records.

## Step 4 — If something goes wrong

- If your edit doesn't look right, go back to the Claude terminal and describe what's
  wrong — Claude can fix it or undo it.
- If you're unsure whether something broke, **don't keep guessing** — stop and message
  Josiah with what you asked Claude to change and what you're seeing.

## Step 5 — When you're done

1. Go to the preview terminal and press `Ctrl + C` to stop the server.
2. **Do not** ask Claude to "push," "publish," "sync," or "commit to GitHub" —
   Josiah handles getting changes live. Just let him know what you changed and that
   it's ready for him to check.

---

### The short version
1. Open the folder in VS Code.
2. Terminal → New Terminal → type `claude` → Enter. Describe your one change in
   plain English. Only approve steps that match what you asked.
3. Second terminal → type `python -m http.server 8000` → Enter.
4. Browser → `http://localhost:8000` → look, don't click Save/Submit/Delete.
5. Done looking? `Ctrl + C` in the preview terminal. Tell Josiah what you changed.
