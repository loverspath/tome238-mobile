#!/data/data/com.termux/files/usr/bin/python3
"""
Declarative Mobile Web Terminal PTY Host & Bridge Server
Serves static web files, exposes profile metadata (/api/profile),
and provides bidirectional terminal streaming over WebSocket.
"""

import argparse
import asyncio
import datetime
import errno
import fcntl
import json
import mimetypes
import os
import pty
import re
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
STATIC_DIR = os.path.join(PROJECT_ROOT, "web")
DEFAULT_PROFILE_PATH = os.path.join(PROJECT_ROOT, "profiles", "tome238.json")

ACTIVE_PROFILE = {}
ACTIVE_PROFILE_RAW_JSON = b"{}"


def resolve_path(path: str, base_dir: str = PROJECT_ROOT) -> str:
    if os.path.isabs(path):
        return path
    return os.path.normpath(os.path.join(base_dir, path))


def load_profile(profile_path: str) -> dict:
    global ACTIVE_PROFILE, ACTIVE_PROFILE_RAW_JSON
    abs_path = resolve_path(profile_path)
    if not os.path.isfile(abs_path):
        raise FileNotFoundError(f"Profile configuration file not found at: {abs_path}")

    with open(abs_path, "r", encoding="utf-8") as f:
        profile_data = json.load(f)

    # Resolve executable and cwd relative to PROJECT_ROOT
    if "executable" in profile_data:
        profile_data["resolved_executable"] = resolve_path(profile_data["executable"])
    if "cwd" in profile_data:
        profile_data["resolved_cwd"] = resolve_path(profile_data["cwd"])
    else:
        profile_data["resolved_cwd"] = PROJECT_ROOT

    ACTIVE_PROFILE = profile_data
    ACTIVE_PROFILE_RAW_JSON = json.dumps(profile_data, ensure_ascii=False).encode("utf-8")
    return profile_data


class PtySession:
    def __init__(self, session_id: str, cmd: list, env: dict, cwd: str, cols: int = 80, rows: int = 24):
        self.session_id = session_id
        self.cmd = cmd
        self.env = env
        self.cwd = cwd
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

        # Disable software flow control (IXON/IXOFF) so Ctrl+S does not freeze terminal
        try:
            attrs = termios.tcgetattr(slave_fd)
            attrs[0] &= ~(termios.IXON | termios.IXOFF)
            termios.tcsetattr(slave_fd, termios.TCSANOW, attrs)
        except OSError:
            pass

        pid = os.fork()
        if pid == 0:
            # Child process
            os.close(self.master_fd)
            os.setsid()
            os.dup2(slave_fd, 0)
            os.dup2(slave_fd, 1)
            os.dup2(slave_fd, 2)
            os.close(slave_fd)

            os.chdir(self.cwd)
            os.execvpe(self.cmd[0], self.cmd, self.env)

        # Parent process
        os.close(slave_fd)
        self.child_pid = pid
        self.is_alive = True

        flags = fcntl.fcntl(self.master_fd, fcntl.F_GETFL)
        fcntl.fcntl(self.master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

        self.loop.add_reader(self.master_fd, self._on_pty_read)

    def _set_winsize(self, cols: int, rows: int, fd: int = None):
        target_fd = fd if fd is not None else self.master_fd
        if target_fd is not None:
            try:
                fcntl.ioctl(target_fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
            except OSError:
                pass

    def resize(self, cols: int, rows: int):
        geometry = ACTIVE_PROFILE.get("geometry", {})
        if ACTIVE_PROFILE.get("fixed_geometry", False):
            cols = geometry.get("cols", 80)
            rows = geometry.get("rows", 24)

        size_changed = (cols != self.cols or rows != self.rows)
        self.cols = cols
        self.rows = rows
        if self.master_fd is not None:
            self._set_winsize(cols, rows)
            if size_changed and self.child_pid and self.is_alive:
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

            self.recent_buffer.extend(data)
            if len(self.recent_buffer) > self.max_buffer_size:
                self.recent_buffer = self.recent_buffer[-self.max_buffer_size:]

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

        exit_code = 0
        sig_name = None
        is_crash = False

        if self.child_pid:
            try:
                pid_res, status = os.waitpid(self.child_pid, os.WNOHANG)
                if pid_res == 0:
                    time.sleep(0.05)
                    pid_res, status = os.waitpid(self.child_pid, os.WNOHANG)

                if pid_res != 0:
                    if os.WIFEXITED(status):
                        exit_code = os.WEXITSTATUS(status)
                        if exit_code != 0:
                            is_crash = True
                    elif os.WIFSIGNALED(status):
                        sig_num = os.WTERMSIG(status)
                        exit_code = -sig_num
                        is_crash = True
                        try:
                            sig_name = signal.Signals(sig_num).name
                        except (ValueError, AttributeError):
                            sig_name = f"SIG_{sig_num}"
            except OSError:
                pass

        # Capture last up to 4KB of recent PTY / stderr output
        raw_tail = bytes(self.recent_buffer[-4096:]) if self.recent_buffer else b""
        stderr_tail = raw_tail.decode("latin1", errors="replace")

        if is_crash and not sig_name and stderr_tail:
            m = re.search(r"Caught fatal signal (\d+)", stderr_tail)
            if m:
                try:
                    sig_num = int(m.group(1))
                    sig_name = signal.Signals(sig_num).name
                except Exception:
                    pass

        if is_crash:
            now_iso = datetime.datetime.now().isoformat()
            crash_payload = {
                "type": "crash",
                "code": exit_code,
                "signal": sig_name or f"Exit {exit_code}",
                "message": f"Engine process crashed or aborted unexpectedly (Exit code: {exit_code}, Signal: {sig_name or 'none'}).",
                "stderr": stderr_tail,
                "timestamp": now_iso
            }
            exit_msg = json.dumps(crash_payload, ensure_ascii=False)
        else:
            exit_msg = json.dumps({"type": "exit"}, ensure_ascii=False)

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

    executable = ACTIVE_PROFILE.get("resolved_executable")
    if not executable or not os.path.isfile(executable):
        raise FileNotFoundError(f"Target executable not found: {executable}")

    args = ACTIVE_PROFILE.get("args", [])
    cmd = [executable] + list(args)

    cwd = ACTIVE_PROFILE.get("resolved_cwd", PROJECT_ROOT)

    env = os.environ.copy()
    profile_env = ACTIVE_PROFILE.get("env", {})
    for k, v in profile_env.items():
        if k == "TOME_PATH" and not os.path.isabs(v):
            env[k] = resolve_path(v, cwd)
        else:
            env[k] = str(v)

    geometry = ACTIVE_PROFILE.get("geometry", {})
    cols = geometry.get("cols", 80)
    rows = geometry.get("rows", 24)

    sess = PtySession(session_id, cmd, env, cwd, cols=cols, rows=rows)
    sess.start()
    active_sessions[session_id] = sess
    return sess


def process_http_request(connection: ServerConnection, request: Request):
    parsed = urlparse(request.path)
    path = parsed.path

    if path == "/ws":
        return None

    # Expose current profile configuration to frontend client
    if path == "/api/profile":
        headers = Headers([
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Length", str(len(ACTIVE_PROFILE_RAW_JSON))),
            ("Cache-Control", "no-cache")
        ])
        return Response(200, "OK", headers, ACTIVE_PROFILE_RAW_JSON)

    # Handle static files
    if path == "/" or path == "":
        rel_path = "index.html"
    else:
        rel_path = path.lstrip("/")

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
            ("Content-Type", f"{mime_type}; charset=utf-8" if "text" in mime_type or "javascript" in mime_type or "json" in mime_type else mime_type),
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
        if session.recent_buffer:
            await websocket.send(bytes(session.recent_buffer))

        # Redraw screen using profile's redraw_key
        redraw_str = ACTIVE_PROFILE.get("redraw_key", "\x12")
        if redraw_str:
            session.write_input(redraw_str.encode("utf-8"))

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
        if not session.clients:
            async def delayed_cleanup():
                await asyncio.sleep(300)
                if not session.clients and session_id in active_sessions:
                    active_sessions.pop(session_id, None).cleanup()
            asyncio.create_task(delayed_cleanup())


async def main():
    parser = argparse.ArgumentParser(description="Generic Mobile Web Terminal Bridge Server")
    parser.add_argument("--host", default="0.0.0.0", help="Listen host (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8080, help="Listen port (default: 8080)")
    parser.add_argument("--profile", default=DEFAULT_PROFILE_PATH, help=f"Path to profile json (default: {DEFAULT_PROFILE_PATH})")
    args = parser.parse_args()

    # Load and validate profile
    try:
        profile = load_profile(args.profile)
    except Exception as e:
        print(f"Error loading profile: {e}")
        sys.exit(1)

    print(f"==================================================")
    print(f" Mobile Web Terminal PTY Bridge Server")
    print(f" Profile:     {profile.get('name')} ({profile.get('id')})")
    print(f" Executable:  {profile.get('resolved_executable')}")
    print(f" Working Dir: {profile.get('resolved_cwd')}")
    print(f" Listening:   http://{args.host}:{args.port}")
    print(f" Static Dir:  {STATIC_DIR}")
    print(f"==================================================")

    def shutdown(sig, frame):
        print("\nShutting down server...")
        for sess in list(active_sessions.values()):
            sess.cleanup()
        os._exit(0)

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
