#!/data/data/com.termux/files/usr/bin/python3
"""
ToME 2.3.8-ah PTY <-> WebSocket Bridge Server
Serves static web files and provides bidirectional terminal streaming over WebSocket.
"""

import argparse
import asyncio
import errno
import fcntl
import json
import mimetypes
import os
import pty
import signal
import struct
import sys
import termios
import time
from urllib.parse import urlparse

import websockets
from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.http11 import Request, Response

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
GAME_DIR = os.path.join(PROJECT_ROOT, "game")
GAME_BIN = os.path.join(GAME_DIR, "tome")
GAME_LIB = os.path.join(GAME_DIR, "lib")
STATIC_DIR = os.path.join(PROJECT_ROOT, "web")

class PtySession:
    def __init__(self, session_id: str, cmd: list, env: dict, cols: int = 80, rows: int = 24):
        self.session_id = session_id
        self.cmd = cmd
        self.env = env
        self.cols = cols
        self.rows = rows
        self.master_fd = None
        self.child_pid = None
        self.clients = set()
        self.recent_buffer = bytearray()
        self.max_buffer_size = 65536
        self.loop = asyncio.get_running_loop()
        self.is_alive = False

    def start(self):
        self.master_fd, slave_fd = pty.openpty()
        self._set_winsize(self.cols, self.rows, slave_fd)

        pid = os.fork()
        if pid == 0:
            # Child process
            os.close(self.master_fd)
            os.setsid()
            os.dup2(slave_fd, 0)
            os.dup2(slave_fd, 1)
            os.dup2(slave_fd, 2)
            os.close(slave_fd)

            os.chdir(GAME_DIR)
            os.execvpe(self.cmd[0], self.cmd, self.env)

        # Parent process
        os.close(slave_fd)
        self.child_pid = pid
        self.is_alive = True

        # Make master non-blocking
        flags = fcntl.fcntl(self.master_fd, fcntl.F_GETFL)
        fcntl.fcntl(self.master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

        # Register event loop reader
        self.loop.add_reader(self.master_fd, self._on_pty_read)

    def _set_winsize(self, cols: int, rows: int, fd: int = None):
        target_fd = fd if fd is not None else self.master_fd
        if target_fd is not None:
            try:
                fcntl.ioctl(target_fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
            except OSError:
                pass

    def resize(self, cols: int, rows: int):
        self.cols = cols
        self.rows = rows
        if self.master_fd is not None:
            self._set_winsize(cols, rows)
            if self.child_pid and self.is_alive:
                try:
                    os.kill(self.child_pid, signal.SIGWINCH)
                except OSError:
                    pass

    def write_input(self, data: bytes):
        if self.master_fd is not None and self.is_alive:
            try:
                os.write(self.master_fd, data)
            except OSError as e:
                if e.errno == errno.EIO:
                    self._handle_exit()

    def _on_pty_read(self):
        if not self.is_alive or self.master_fd is None:
            return
        try:
            data = os.read(self.master_fd, 4096)
            if not data:
                self._handle_exit()
                return

            # Keep recent buffer for client reconnections
            self.recent_buffer.extend(data)
            if len(self.recent_buffer) > self.max_buffer_size:
                self.recent_buffer = self.recent_buffer[-self.max_buffer_size:]

            # Broadcast to connected WebSocket clients
            for ws in list(self.clients):
                try:
                    asyncio.create_task(ws.send(data))
                except Exception:
                    pass

        except OSError as e:
            if e.errno == errno.EIO:
                self._handle_exit()

    def _handle_exit(self):
        if not self.is_alive:
            return
        self.is_alive = False
        if self.master_fd is not None:
            self.loop.remove_reader(self.master_fd)
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None

        if self.child_pid:
            try:
                os.waitpid(self.child_pid, os.WNOHANG)
            except OSError:
                pass

        # Notify clients of exit
        exit_msg = json.dumps({"type": "exit"}).encode("utf-8")
        for ws in list(self.clients):
            try:
                asyncio.create_task(ws.send(exit_msg))
            except Exception:
                pass

    def cleanup(self):
        self._handle_exit()
        if self.child_pid:
            try:
                os.kill(self.child_pid, signal.SIGTERM)
                time.sleep(0.1)
                os.kill(self.child_pid, signal.SIGKILL)
            except OSError:
                pass


active_sessions = {}

def get_or_create_session(session_id: str) -> PtySession:
    sess = active_sessions.get(session_id)
    if sess and sess.is_alive:
        return sess

    env = os.environ.copy()
    env["TERM"] = "xterm-256color"
    env["TOME_PATH"] = GAME_LIB
    env["LANG"] = "en_US.UTF-8"

    cmd = [GAME_BIN, "-mgcu", "-MToME"]
    sess = PtySession(session_id, cmd, env)
    sess.start()
    active_sessions[session_id] = sess
    return sess


def process_http_request(connection: ServerConnection, request: Request):
    parsed = urlparse(request.path)
    path = parsed.path

    if path == "/ws":
        # Upgrade to WebSocket
        return None

    # Handle static files
    if path == "/" or path == "":
        rel_path = "index.html"
    else:
        rel_path = path.lstrip("/")

    # Security check: avoid directory traversal
    file_path = os.path.normpath(os.path.join(STATIC_DIR, rel_path))
    if not file_path.startswith(STATIC_DIR):
        return Response(403, "Forbidden", Headers([("Content-Type", "text/plain")]), b"403 Forbidden")

    if not os.path.isfile(file_path):
        return Response(404, "Not Found", Headers([("Content-Type", "text/plain")]), b"404 Not Found")

    mime_type, _ = mimetypes.guess_type(file_path)
    if not mime_type:
        mime_type = "application/octet-stream"

    try:
        with open(file_path, "rb") as f:
            content = f.read()
        headers = Headers([
            ("Content-Type", f"{mime_type}; charset=utf-8" if "text" in mime_type or "javascript" in mime_type else mime_type),
            ("Content-Length", str(len(content))),
            ("Cache-Control", "no-cache")
        ])
        return Response(200, "OK", headers, content)
    except Exception as e:
        return Response(500, "Internal Server Error", Headers([("Content-Type", "text/plain")]), str(e).encode("utf-8"))


async def ws_handler(websocket: ServerConnection):
    parsed = urlparse(websocket.request.path)
    session_id = "default"
    if parsed.query:
        from urllib.parse import parse_qs
        qs = parse_qs(parsed.query)
        session_id = qs.get("session", ["default"])[0]

    session = get_or_create_session(session_id)
    session.clients.add(websocket)

    try:
        # Send initial screen buffer if reconnecting
        if session.recent_buffer:
            await websocket.send(bytes(session.recent_buffer))

        # Redraw screen
        session.write_input(b"\x12") # Ctrl+R

        async for message in websocket:
            if isinstance(message, bytes):
                session.write_input(message)
            elif isinstance(message, str):
                if message.startswith("{"):
                    try:
                        cmd = json.loads(message)
                        msg_type = cmd.get("type")
                        if msg_type == "resize":
                            cols = int(cmd.get("cols", 80))
                            rows = int(cmd.get("rows", 24))
                            session.resize(cols, rows)
                        elif msg_type == "input":
                            data = cmd.get("data", "")
                            session.write_input(data.encode("utf-8"))
                        elif msg_type == "restart":
                            session.cleanup()
                            session = get_or_create_session(session_id)
                            session.clients.add(websocket)
                    except json.JSONDecodeError:
                        session.write_input(message.encode("utf-8"))
                else:
                    session.write_input(message.encode("utf-8"))
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        session.clients.discard(websocket)
        # If no clients left, schedule cleanup after 300 seconds
        if not session.clients:
            async def delayed_cleanup():
                await asyncio.sleep(300)
                if not session.clients and session_id in active_sessions:
                    active_sessions.pop(session_id, None).cleanup()
            asyncio.create_task(delayed_cleanup())


async def main():
    parser = argparse.ArgumentParser(description="ToME 2.3.8 Mobile Web Server")
    parser.add_argument("--host", default="0.0.0.0", help="Listen host (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8080, help="Listen port (default: 8080)")
    args = parser.parse_args()

    # Pre-check binary
    if not os.path.isfile(GAME_BIN):
        print(f"Error: Game binary not found at {GAME_BIN}. Please run ./scripts/build.sh first.")
        sys.exit(1)

    print(f"==================================================")
    print(f" ToME 2.3.8-ah Mobile Web Terminal Server")
    print(f" Listening on http://{args.host}:{args.port}")
    print(f" Game Binary: {GAME_BIN}")
    print(f" Static Dir:  {STATIC_DIR}")
    print(f"==================================================")

    def shutdown(sig, frame):
        print("\nShutting down server...")
        for sess in list(active_sessions.values()):
            sess.cleanup()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    server = await serve(
        ws_handler,
        args.host,
        args.port,
        process_request=process_http_request
    )
    await server.wait_closed()


if __name__ == "__main__":
    asyncio.run(main())
