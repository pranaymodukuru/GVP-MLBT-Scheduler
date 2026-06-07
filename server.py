#!/usr/bin/env python3
"""
Dev server for GVP-MLBT-Scheduler.
Serves static files and handles POST /save to write schedules to saved_schedules/.

Usage:
    python3 server.py          # serves on port 8080
    python3 server.py 3000     # serves on a custom port

Auth:
    Set APP_PASSWORD env var to enable password protection.
    Leave it unset for open access (local dev default).
"""

import json
import os
import secrets
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, HTTPServer

from dotenv import load_dotenv
load_dotenv()  # loads .env into os.environ (no-op if file doesn't exist)

SAVE_DIR    = os.path.join(os.path.dirname(__file__), "saved_schedules")
DATA_DIR    = os.path.join(SAVE_DIR, "data")
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config", "school-config.json")
BACKUP_PATH = os.path.join(SAVE_DIR, "backup.json")

# Auth — only active when APP_PASSWORD is set
APP_PASSWORD   = os.environ.get("APP_PASSWORD", "")
VALID_SESSIONS = set()   # in-memory; cleared on server restart (fine for this use case)

LOGIN_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GVP MLBT Scheduler — Login</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f4f6f9;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.10);
      padding: 2.5rem 2rem;
      width: 100%;
      max-width: 360px;
      text-align: center;
    }
    .logo {
      font-size: 28px;
      font-weight: 800;
      color: #1d4ed8;
      letter-spacing: -0.5px;
      margin-bottom: 4px;
    }
    .subtitle {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 2rem;
    }
    label {
      display: block;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    input[type="password"] {
      width: 100%;
      padding: 10px 14px;
      border-radius: 8px;
      border: 1.5px solid #e5e7eb;
      font-size: 14px;
      outline: none;
      transition: border-color .15s;
      margin-bottom: 1rem;
      background: #f9fafb;
    }
    input[type="password"]:focus { border-color: #1d4ed8; background: #fff; }
    button {
      width: 100%;
      padding: 10px;
      border-radius: 8px;
      border: none;
      background: #1d4ed8;
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background .15s;
    }
    button:hover { background: #1e40af; }
    .error {
      font-size: 13px;
      color: #dc2626;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      padding: 8px 12px;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">MLBT</div>
    <div class="subtitle">Timetable Scheduler</div>
    {error}
    <form method="POST" action="/login">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autofocus autocomplete="current-password" placeholder="Enter password">
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>
"""


def _parse_cookies(handler):
    """Return a dict of cookie name→value from the request headers."""
    cookies = {}
    header = handler.headers.get("Cookie", "")
    for part in header.split(";"):
        k, _, v = part.strip().partition("=")
        if k:
            cookies[k.strip()] = v.strip()
    return cookies


def _is_authenticated(handler):
    """Return True if auth is disabled or the request carries a valid session cookie."""
    if not APP_PASSWORD:
        return True
    cookies = _parse_cookies(handler)
    return cookies.get("session", "") in VALID_SESSIONS


def _serve_login(handler, error=""):
    """Send the login page, optionally with an error message."""
    error_html = f'<div class="error">{error}</div>' if error else ""
    body = LOGIN_HTML.replace("{error}", error_html).encode()
    handler.send_response(200)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _redirect(handler, location="/"):
    handler.send_response(303)
    handler.send_header("Location", location)
    handler.end_headers()


def latest_schedule():
    """Return (filename, parsed_data) for the newest file in SAVE_DIR, or (None, None)."""
    if not os.path.isdir(SAVE_DIR):
        return None, None
    files = [f for f in os.listdir(SAVE_DIR) if f.endswith(".json")]
    if not files:
        return None, None
    newest = max(files, key=lambda f: os.path.getmtime(os.path.join(SAVE_DIR, f)))
    with open(os.path.join(SAVE_DIR, newest), encoding="utf-8") as fh:
        return newest, json.load(fh)


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        # Serve login page (always public)
        if self.path == "/login":
            _serve_login(self)
            return

        # Auth gate — redirect to /login if not authenticated
        if not _is_authenticated(self):
            _redirect(self, "/login")
            return

        if self.path == "/latest-schedule":
            filename, data = latest_schedule()
            if data is None:
                self.send_response(204)
                self.end_headers()
                return
            body = json.dumps({"filename": filename, "data": data}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if self.path == "/backup-schedule":
            if not os.path.isfile(BACKUP_PATH):
                self.send_response(204)
                self.end_headers()
                return
            with open(BACKUP_PATH, encoding="utf-8") as fh:
                data = json.load(fh)
            body = json.dumps({"filename": "backup.json", "data": data}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if self.path == "/saved-schedules":
            files = []
            if os.path.isdir(SAVE_DIR):
                for f in os.listdir(SAVE_DIR):
                    if f.endswith(".json"):
                        path = os.path.join(SAVE_DIR, f)
                        files.append({"filename": f, "mtime": os.path.getmtime(path)})
            files.sort(key=lambda x: x["mtime"], reverse=True)
            body = json.dumps(files).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if self.path.startswith("/data/"):
            name = self.path[6:]  # strip "/data/"
            if not name or "/" in name:
                self.send_error(400, "Invalid data name")
                return
            path = os.path.join(DATA_DIR, f"{name}.json")
            if not os.path.isfile(path):
                self.send_response(204)
                self.end_headers()
                return
            with open(path, encoding="utf-8") as fh:
                raw = fh.read()
            body = raw.encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        super().do_GET()

    def do_PUT(self):
        if not _is_authenticated(self):
            self.send_error(401, "Unauthorized")
            return

        if self.path.startswith("/data/"):
            name = self.path[6:]
            if not name or "/" in name:
                self.send_error(400, "Invalid data name")
                return
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                json.loads(body)  # validate JSON before writing
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
                return
            os.makedirs(DATA_DIR, exist_ok=True)
            dest = os.path.join(DATA_DIR, f"{name}.json")
            # Atomic write: write to a temp file then rename so a crash mid-write
            # never corrupts the existing file.
            fd, tmp = tempfile.mkstemp(dir=DATA_DIR, suffix=".tmp")
            try:
                with os.fdopen(fd, "wb") as fh:
                    fh.write(body)
                os.replace(tmp, dest)
            except Exception:
                os.unlink(tmp)
                raise
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"saved": name}).encode())
            return
        self.send_error(404)

    def do_POST(self):
        # Handle login before the auth gate
        if self.path == "/login":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode()
            # Parse application/x-www-form-urlencoded
            params = {}
            for part in body.split("&"):
                k, _, v = part.partition("=")
                params[k] = v.replace("+", " ")
            from urllib.parse import unquote
            password = unquote(params.get("password", ""))
            if APP_PASSWORD and password == APP_PASSWORD:
                token = secrets.token_hex(32)
                VALID_SESSIONS.add(token)
                self.send_response(303)
                self.send_header("Set-Cookie", f"session={token}; HttpOnly; SameSite=Strict; Path=/")
                self.send_header("Location", "/")
                self.end_headers()
            else:
                _serve_login(self, error="Incorrect password. Please try again.")
            return

        # Auth gate for all other POST endpoints
        if not _is_authenticated(self):
            self.send_error(401, "Unauthorized")
            return

        if self.path == "/save-config":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
                return
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.write("\n")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"saved": "school-config.json"}).encode())
            return

        if self.path == "/save-backup":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
                return
            os.makedirs(SAVE_DIR, exist_ok=True)
            with open(BACKUP_PATH, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"saved": "backup.json"}).encode())
            return

        if self.path != "/save":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return

        filename = self.headers.get("X-Filename", "timetable.json")
        # Sanitise: strip any path components the client might send
        filename = os.path.basename(filename)

        os.makedirs(SAVE_DIR, exist_ok=True)
        filepath = os.path.join(SAVE_DIR, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps({"saved": filename}).encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Filename")
        self.end_headers()
        return

    def log_message(self, fmt, *args):
        if self.command == "POST":
            super().log_message(fmt, *args)
        elif args and str(args[1]) not in ("200", "304"):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8080))
    print(f"Serving at http://localhost:{port}  (saves → saved_schedules/)")
    HTTPServer(("", port), Handler).serve_forever()
