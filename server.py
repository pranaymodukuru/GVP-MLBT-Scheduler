#!/usr/bin/env python3
"""
Dev server for GVP-MLBT-Scheduler.
Serves static files and handles POST /save to write schedules to saved_schedules/.

Usage:
    python3 server.py          # serves on port 8080
    python3 server.py 3000     # serves on a custom port
"""

import json
import os
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, HTTPServer

SAVE_DIR    = os.path.join(os.path.dirname(__file__), "saved_schedules")
DATA_DIR    = os.path.join(SAVE_DIR, "data")
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config", "school-config.json")
BACKUP_PATH = os.path.join(SAVE_DIR, "backup.json")


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
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"Serving at http://localhost:{port}  (saves → saved_schedules/)")
    HTTPServer(("", port), Handler).serve_forever()
