#!/usr/bin/env python3
"""
Dev server for GVP-MLBT-Scheduler.
Serves static files and handles POST /save to write schedules to saved_schedules/.

Usage:
    uv run python server.py          # serves on :8080, saves to saved_schedules/
    uv run python server.py 3000     # custom port

Auth:
    Set APP_PASSWORD env var to enable password protection.
    Leave it unset (local dev default) for open access.
"""

import hmac
import json
import os
import secrets
import sys
import tempfile
import time
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib.parse import unquote

from dotenv import load_dotenv
load_dotenv()  # loads .env into os.environ (no-op if file doesn't exist)

_BASE        = os.path.dirname(__file__)
SAVE_DIR     = os.environ.get("SAVE_DIR", os.path.join(_BASE, "saved_schedules"))
DATA_DIR     = os.path.join(SAVE_DIR, "data")
CONFIG_PATH  = os.path.join(_BASE, "config", "school-config.json")
BACKUP_PATH = os.path.join(SAVE_DIR, "backup.json")

# ── Auth ───────────────────────────────────────────────────────────────────────
APP_PASSWORD  = os.environ.get("APP_PASSWORD", "")
# Auto-detected on Railway; set PRODUCTION=true on other hosts
IS_PRODUCTION = bool(os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("PRODUCTION", ""))

SESSION_TTL    = 8 * 3600  # sessions expire after 8 hours
VALID_SESSIONS = {}         # {token: expiry_timestamp}

# ── Brute-force protection ─────────────────────────────────────────────────────
MAX_ATTEMPTS    = 5
LOCKOUT_SECONDS = 15 * 60   # 15-minute lockout after MAX_ATTEMPTS failures
FAILED_LOGINS   = {}         # {ip: {"count": n, "locked_until": float}}

# ── Paths blocked from static file serving ────────────────────────────────────
_BLOCKED_EXACT = frozenset({
    "/pyproject.toml", "/uv.lock", "/requirements.txt",
    "/.env", "/.env.example", "/procfile",
    "/claude.md", "/readme.md", "/architecture.md",
    "/scheduling_constraints.md", "/v2_plan.md",
})
_BLOCKED_PREFIXES = ("/saved_schedules/", "/.venv/", "/.git/")


LOGIN_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GVP MLBT Scheduler — Login</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: system-ui, -apple-system, sans-serif;
      background: #f4f6f9;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }}
    .card {{
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.10);
      padding: 2.5rem 2rem;
      width: 100%;
      max-width: 360px;
      text-align: center;
    }}
    .logo {{
      font-size: 28px;
      font-weight: 800;
      color: #1d4ed8;
      letter-spacing: -0.5px;
      margin-bottom: 4px;
    }}
    .subtitle {{
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 2rem;
    }}
    label {{
      display: block;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }}
    input[type="password"] {{
      width: 100%;
      padding: 10px 14px;
      border-radius: 8px;
      border: 1.5px solid #e5e7eb;
      font-size: 14px;
      outline: none;
      transition: border-color .15s;
      margin-bottom: 1rem;
      background: #f9fafb;
    }}
    input[type="password"]:focus {{ border-color: #1d4ed8; background: #fff; }}
    button {{
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
    }}
    button:hover {{ background: #1e40af; }}
    .error {{
      font-size: 13px;
      color: #dc2626;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      padding: 8px 12px;
      margin-bottom: 1rem;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">MLBT</div>
    <div class="subtitle">Timetable Scheduler</div>
    {error}
    <form method="POST" action="/login">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autofocus
             autocomplete="current-password" placeholder="Enter password">
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>
"""


# ── Helpers ────────────────────────────────────────────────────────────────────

def _client_ip(handler):
    """Real client IP, accounting for Railway's reverse proxy."""
    forwarded = handler.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return handler.client_address[0]


def _parse_cookies(handler):
    """Return a dict of cookie name → value from the request headers."""
    cookies = {}
    for part in handler.headers.get("Cookie", "").split(";"):
        k, _, v = part.strip().partition("=")
        if k:
            cookies[k.strip()] = v.strip()
    return cookies


def _is_authenticated(handler):
    """True if auth is disabled or the request carries a valid, unexpired session."""
    if not APP_PASSWORD:
        return True
    token = _parse_cookies(handler).get("session", "")
    expiry = VALID_SESSIONS.get(token, 0)
    if expiry > time.time():
        return True
    VALID_SESSIONS.pop(token, None)   # clean up expired token
    return False


def _check_rate_limit(ip):
    """Return (is_locked, seconds_remaining). Cleans up expired lockouts."""
    record = FAILED_LOGINS.get(ip)
    if not record:
        return False, 0
    remaining = record["locked_until"] - time.time()
    if remaining > 0:
        return True, int(remaining)
    # Lockout expired — clear it
    FAILED_LOGINS.pop(ip, None)
    return False, 0


def _record_failed_login(ip):
    """Increment failure count; lock out the IP after MAX_ATTEMPTS."""
    record = FAILED_LOGINS.get(ip, {"count": 0, "locked_until": 0})
    record["count"] += 1
    if record["count"] >= MAX_ATTEMPTS:
        record["locked_until"] = time.time() + LOCKOUT_SECONDS
        record["count"] = 0
    FAILED_LOGINS[ip] = record


def _is_blocked_path(path):
    """True if the path should never be served as a static file."""
    clean = path.split("?")[0].lower().rstrip("/") or "/"
    if clean in _BLOCKED_EXACT:
        return True
    return any(clean.startswith(p) for p in _BLOCKED_PREFIXES)


def _cookie_header(token):
    """Build a Set-Cookie header value with the right flags for the environment."""
    flags = "HttpOnly; SameSite=Strict; Path=/"
    if IS_PRODUCTION:
        flags += "; Secure"
    return f"session={token}; {flags}"


def _serve_login(handler, error=""):
    """Send the login page, optionally with an inline error message."""
    error_html = f'<div class="error">{error}</div>' if error else ""
    body = LOGIN_HTML.format(error=error_html).encode()
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


# ── Request handler ────────────────────────────────────────────────────────────

class Handler(SimpleHTTPRequestHandler):

    def end_headers(self):
        """Inject security headers into every response."""
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "font-src 'self'; "
            "connect-src 'self';"
        )
        super().end_headers()

    def do_GET(self):
        # Always public: login page
        if self.path == "/login":
            _serve_login(self)
            return

        # Block sensitive files before auth check (return 404, not 403,
        # to avoid confirming the file exists)
        if _is_blocked_path(self.path):
            self.send_error(404, "Not Found")
            return

        # Auth gate
        if not _is_authenticated(self):
            _redirect(self, "/login")
            return

        if self.path.startswith("/schedule/"):
            filename = unquote(self.path[len("/schedule/"):])
            filename = os.path.basename(filename)  # strip any path traversal
            if not filename:
                self.send_error(400, "Missing filename")
                return
            filepath = os.path.join(SAVE_DIR, filename)
            if not os.path.isfile(filepath):
                self.send_error(404, "Not Found")
                return
            with open(filepath, encoding="utf-8") as fh:
                raw = fh.read()
            body = raw.encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
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
            self.end_headers()
            self.wfile.write(json.dumps({"saved": name}).encode())
            return
        self.send_error(404)

    def do_POST(self):
        # ── Login (always public) ──────────────────────────────────────────────
        if self.path == "/login":
            ip = _client_ip(self)

            # Check lockout before reading the body
            locked, remaining = _check_rate_limit(ip)
            if locked:
                mins = remaining // 60
                secs = remaining % 60
                _serve_login(
                    self,
                    error=f"Too many failed attempts. Try again in {mins}m {secs}s."
                )
                return

            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length).decode()
            params = {}
            for part in raw.split("&"):
                k, _, v = part.partition("=")
                params[k] = unquote(v.replace("+", " "))

            password = params.get("password", "")

            # Timing-safe comparison — prevents password-length timing attacks
            if APP_PASSWORD and hmac.compare_digest(password, APP_PASSWORD):
                FAILED_LOGINS.pop(ip, None)   # clear any previous failures
                token = secrets.token_hex(32)
                VALID_SESSIONS[token] = time.time() + SESSION_TTL
                self.send_response(303)
                self.send_header("Set-Cookie", _cookie_header(token))
                self.send_header("Location", "/")
                self.end_headers()
            else:
                _record_failed_login(ip)
                _serve_login(self, error="Incorrect password. Please try again.")
            return

        # ── Auth gate for all other POST endpoints ─────────────────────────────
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

        filename = os.path.basename(self.headers.get("X-Filename", "timetable.json"))
        os.makedirs(SAVE_DIR, exist_ok=True)
        with open(os.path.join(SAVE_DIR, filename), "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"saved": filename}).encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Filename")
        self.end_headers()

    def log_message(self, fmt, *args):
        if self.command == "POST":
            super().log_message(fmt, *args)
        elif args and str(args[1]) not in ("200", "304"):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", 8080))
    auth_status = "password-protected" if APP_PASSWORD else "open (no APP_PASSWORD set)"
    env_status  = "production" if IS_PRODUCTION else "development"
    print(f"Serving at http://localhost:{port}  [{env_status}] [{auth_status}]")
    print(f"  saves → saved_schedules/")
    HTTPServer(("", port), Handler).serve_forever()
