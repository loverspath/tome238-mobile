#!/data/data/com.termux/files/usr/bin/python3
"""
Declarative Mobile Web Terminal PTY Host & Bridge Server
Serves static web files, exposes profile metadata (/api/profile, /api/profiles),
manages companion game daemons (CompanionServerManager), and provides bidirectional
terminal streaming over WebSocket.
"""

import argparse
import asyncio
import datetime
import errno
import fcntl
import glob
import json
import mimetypes
import os
import pty
import re
import signal
import socket
import struct
import subprocess
import sys
import termios
import time
from urllib.parse import parse_qs, urlparse

import websockets
from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.http11 import Request, Response

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
STATIC_DIR = os.path.join(PROJECT_ROOT, "web")
PROFILES_DIR = os.path.join(PROJECT_ROOT, "profiles")
DEFAULT_PROFILE_PATH = os.path.join(PROFILES_DIR, "tome238.json")

AVAILABLE_PROFILES = {}
ACTIVE_PROFILE = {}
ACTIVE_PROFILE_RAW_JSON = b"{}"


def resolve_path(path: str, base_dir: str = PROJECT_ROOT) -> str:
    if os.path.isabs(path):
        return path
    return os.path.normpath(os.path.join(base_dir, path))


def index_profiles() -> dict:
    global AVAILABLE_PROFILES
    AVAILABLE_PROFILES = {}
    if os.path.isdir(PROFILES_DIR):
        for fpath in glob.glob(os.path.join(PROFILES_DIR, "*.json")):
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    pdata = json.load(f)
                pid = pdata.get("id") or os.path.splitext(os.path.basename(fpath))[0]
                pdata["_profile_path"] = fpath
                if "executable" in pdata:
                    pdata["resolved_executable"] = resolve_path(pdata["executable"])
                if "cwd" in pdata:
                    pdata["resolved_cwd"] = resolve_path(pdata["cwd"])
                else:
                    pdata["resolved_cwd"] = PROJECT_ROOT

                if "companion" in pdata and isinstance(pdata["companion"], dict):
                    comp = pdata["companion"]
                    if "executable" in comp:
                        comp["resolved_executable"] = resolve_path(comp["executable"])
                    if "cwd" in comp:
                        comp["resolved_cwd"] = resolve_path(comp["cwd"])
                    else:
                        comp["resolved_cwd"] = PROJECT_ROOT

                AVAILABLE_PROFILES[pid] = pdata
            except Exception as e:
                print(f"[Warning] Failed to index profile {fpath}: {e}")
    return AVAILABLE_PROFILES


def load_profile(profile_path_or_id: str) -> dict:
    global ACTIVE_PROFILE, ACTIVE_PROFILE_RAW_JSON
    if not AVAILABLE_PROFILES:
        index_profiles()

    profile_data = None
    if profile_path_or_id in AVAILABLE_PROFILES:
        profile_data = AVAILABLE_PROFILES[profile_path_or_id]
    else:
        abs_path = resolve_path(profile_path_or_id)
        if os.path.isfile(abs_path):
            with open(abs_path, "r", encoding="utf-8") as f:
                profile_data = json.load(f)
            pid = profile_data.get("id") or os.path.splitext(os.path.basename(abs_path))[0]
            if "executable" in profile_data:
                profile_data["resolved_executable"] = resolve_path(profile_data["executable"])
            if "cwd" in profile_data:
                profile_data["resolved_cwd"] = resolve_path(profile_data["cwd"])
            else:
                profile_data["resolved_cwd"] = PROJECT_ROOT

            if "companion" in profile_data and isinstance(profile_data["companion"], dict):
                comp = profile_data["companion"]
                if "executable" in comp:
                    comp["resolved_executable"] = resolve_path(comp["executable"])
                if "cwd" in comp:
                    comp["resolved_cwd"] = resolve_path(comp["cwd"])
                else:
                    comp["resolved_cwd"] = PROJECT_ROOT

            AVAILABLE_PROFILES[pid] = profile_data
        else:
            raise FileNotFoundError(f"Profile configuration file not found at: {profile_path_or_id}")

    ACTIVE_PROFILE = profile_data
    ACTIVE_PROFILE_RAW_JSON = json.dumps(profile_data, ensure_ascii=False).encode("utf-8")
    return profile_data


class CompanionServerManager:
    """
    Manages dedicated background game server daemon (e.g. tomenet.server)
    and automated account validation watcher.
    """
    def __init__(self):
        self.process = None
        self.log_file = None
        self.current_port = None
        self.watcher_task = None
        self.running_config = None

    def is_port_open(self, host: str = "127.0.0.1", port: int = 18348) -> bool:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.2)
        try:
            s.connect((host, port))
            s.close()
            return True
        except Exception:
            return False

    def ensure_running(self, companion_config: dict) -> bool:
        if not companion_config:
            return True

        port = int(companion_config.get("port", 18348))
        if self.is_port_open("127.0.0.1", port):
            if not self.watcher_task:
                self.start_account_watcher(companion_config.get("resolved_cwd", PROJECT_ROOT))
            return True

        resolved_exec = companion_config.get("resolved_executable")
        if not resolved_exec:
            resolved_exec = resolve_path(companion_config.get("executable", "ref_repos/tomenet/tomenet.server"))
        resolved_cwd = companion_config.get("resolved_cwd")
        if not resolved_cwd:
            resolved_cwd = resolve_path(companion_config.get("cwd", "ref_repos/tomenet"))

        if not os.path.isfile(resolved_exec):
            raise FileNotFoundError(f"Companion executable not found: {resolved_exec}")

        log_path = os.path.join(resolved_cwd, "server_daemon.log")
        self.log_file = open(log_path, "a", encoding="utf-8", errors="replace")

        print(f"[CompanionServerManager] Starting background server: {resolved_exec} (port: {port})...")
        self.process = subprocess.Popen(
            [resolved_exec],
            cwd=resolved_cwd,
            stdout=self.log_file,
            stderr=subprocess.STDOUT,
            preexec_fn=os.setsid
        )
        self.current_port = port
        self.running_config = companion_config

        # Poll port until listening (up to 10 seconds, check every 100ms)
        start_t = time.time()
        while time.time() - start_t < 10.0:
            if self.is_port_open("127.0.0.1", port):
                print(f"[CompanionServerManager] Port {port} is OPEN and ready ({int((time.time() - start_t)*1000)}ms)!")
                self.start_account_watcher(resolved_cwd)
                return True
            if self.process.poll() is not None:
                raise RuntimeError(f"Companion server exited prematurely with code {self.process.returncode}")
            time.sleep(0.1)

        raise TimeoutError(f"Companion server failed to listen on port {port} within 10s")

    def start_account_watcher(self, cwd: str):
        acc_path = os.path.join(cwd, "lib", "save", "tomenet.acc")
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return

        if self.watcher_task and not self.watcher_task.done():
            return

        async def _watch_loop():
            ACC_SIZE = 336
            ACC_TRIAL = 0x01
            while True:
                try:
                    await asyncio.sleep(1.5)
                    if not os.path.isfile(acc_path):
                        continue
                    validated = []
                    with open(acc_path, "r+b") as f:
                        fcntl.flock(f, fcntl.LOCK_EX)
                        try:
                            data = bytearray(f.read())
                            num_recs = len(data) // ACC_SIZE
                            for i in range(num_recs):
                                flags = struct.unpack_from("<I", data, i * ACC_SIZE + 4)[0]
                                if flags & ACC_TRIAL:
                                    name = data[i * ACC_SIZE + 8 : i * ACC_SIZE + 38].split(b"\x00")[0].decode("latin1", errors="ignore")
                                    new_flags = flags & (~ACC_TRIAL)
                                    struct.pack_into("<I", data, i * ACC_SIZE + 4, new_flags)
                                    validated.append(name)
                            if validated:
                                f.seek(0)
                                f.write(data)
                                f.flush()
                        finally:
                            fcntl.flock(f, fcntl.LOCK_UN)
                    if validated:
                        for n in validated:
                            print(f"[CompanionServerManager] Auto-validated TomeNET account '{n}' (ACC_TRIAL cleared)")
                except asyncio.CancelledError:
                    break
                except Exception:
                    pass

        self.watcher_task = loop.create_task(_watch_loop())

    def shutdown(self):
        if self.watcher_task and not self.watcher_task.done():
            self.watcher_task.cancel()

        if self.process and self.process.poll() is None:
            print("[CompanionServerManager] Stopping companion server...")
            try:
                os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
                self.process.wait(timeout=3)
            except Exception:
                try:
                    os.killpg(os.getpgid(self.process.pid), signal.SIGKILL)
                except Exception:
                    pass

        if self.log_file and not self.log_file.closed:
            self.log_file.close()


companion_manager = CompanionServerManager()


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
            if slave_fd > 2:
                os.close(slave_fd)

            try:
                os.chdir(self.cwd)
            except OSError:
                pass

            try:
                os.execvpe(self.cmd[0], self.cmd, self.env)
            except Exception as e:
                sys.stderr.write(f"execvpe failed: {e}\n")
                sys.exit(127)
        else:
            # Parent process
            os.close(slave_fd)
            self.child_pid = pid
            self.is_alive = True

            # Make master_fd non-blocking
            flags = fcntl.fcntl(self.master_fd, fcntl.F_GETFL)
            fcntl.fcntl(self.master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

            # Register read callback with asyncio loop
            self.loop.add_reader(self.master_fd, self._on_master_readable)

    def _set_winsize(self, cols: int, rows: int, fd: int = None):
        target_fd = self.master_fd if fd is None else fd
        if target_fd is not None:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            try:
                fcntl.ioctl(target_fd, termios.TIOCSWINSZ, winsize)
            except OSError:
                pass

    def resize(self, cols: int, rows: int):
        self.cols = cols
        self.rows = rows
        self._set_winsize(cols, rows)

    def write_input(self, data: bytes):
        if self.master_fd is not None and self.is_alive:
            try:
                os.write(self.master_fd, data)
            except (OSError, BrokenPipeError):
                pass

    def _on_master_readable(self):
        try:
            data = os.read(self.master_fd, 4096)
        except OSError as e:
            if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                return
            # Master FD reached EOF or error -> child exited
            self._handle_exit()
            return

        if not data:
            self._handle_exit()
            return

        # Keep rolling recent buffer for reconnection replay
        self.recent_buffer.extend(data)
        if len(self.recent_buffer) > self.max_buffer_size:
            del self.recent_buffer[:-self.max_buffer_size]

        # Broadcast output to connected web clients
        for ws in list(self.clients):
            try:
                asyncio.create_task(ws.send(data))
            except Exception:
                pass

    def _handle_exit(self):
        if not self.is_alive:
            return
        self.is_alive = False

        if self.master_fd is not None:
            try:
                self.loop.remove_reader(self.master_fd)
            except Exception:
                pass
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
                pid, status = os.waitpid(self.child_pid, os.WNOHANG)
                if pid == self.child_pid:
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
    expected_exec = ACTIVE_PROFILE.get("resolved_executable")

    if sess and sess.is_alive:
        if sess.cmd and sess.cmd[0] == expected_exec:
            return sess
        else:
            sess.cleanup()
            active_sessions.pop(session_id, None)

    if not expected_exec or not os.path.isfile(expected_exec):
        raise FileNotFoundError(f"Target executable not found: {expected_exec}")

    args = ACTIVE_PROFILE.get("args", [])
    cmd = [expected_exec] + list(args)

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

    # Expose list of all indexed profiles
    if path == "/api/profiles":
        if not AVAILABLE_PROFILES:
            index_profiles()
        profiles_list = [
            {
                "id": pid,
                "name": p.get("name", pid),
                "title": p.get("title", ""),
                "brand": p.get("brand", {}),
                "active": pid == ACTIVE_PROFILE.get("id")
            }
            for pid, p in AVAILABLE_PROFILES.items()
        ]
        body = json.dumps(profiles_list, ensure_ascii=False).encode("utf-8")
        headers = Headers([
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Length", str(len(body))),
            ("Cache-Control", "no-cache")
        ])
        return Response(200, "OK", headers, body)

    # Dynamic profile switching endpoint
    if path == "/api/switch_profile":
        qs = parse_qs(parsed.query)
        target_id = qs.get("id", [None])[0]
        if not AVAILABLE_PROFILES:
            index_profiles()

        if target_id and target_id in AVAILABLE_PROFILES:
            load_profile(target_id)
            comp_cfg = ACTIVE_PROFILE.get("companion")
            if comp_cfg:
                try:
                    companion_manager.ensure_running(comp_cfg)
                except Exception as e:
                    print(f"[Warning] Failed to pre-warm companion: {e}")

            # Reset running sessions
            for sess in list(active_sessions.values()):
                sess.cleanup()
            active_sessions.clear()

            body = json.dumps({"ok": True, "active_profile": ACTIVE_PROFILE}, ensure_ascii=False).encode("utf-8")
            headers = Headers([
                ("Content-Type", "application/json; charset=utf-8"),
                ("Content-Length", str(len(body))),
                ("Cache-Control", "no-cache")
            ])
            return Response(200, "OK", headers, body)
        else:
            body = b'{"ok": false, "error": "Profile not found"}'
            headers = Headers([
                ("Content-Type", "application/json; charset=utf-8"),
                ("Content-Length", str(len(body))),
                ("Cache-Control", "no-cache")
            ])
            return Response(404, "Not Found", headers, body)

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
        qs = parse_qs(parsed.query)
        session_id = qs.get("session", ["default"])[0]
        req_profile = qs.get("profile", [None])[0]
        if req_profile and req_profile in AVAILABLE_PROFILES and req_profile != ACTIVE_PROFILE.get("id"):
            load_profile(req_profile)
            for sess in list(active_sessions.values()):
                sess.cleanup()
            active_sessions.clear()

    # Pre-warm / ensure companion server is running if declared in profile
    comp_cfg = ACTIVE_PROFILE.get("companion")
    if comp_cfg:
        try:
            await asyncio.to_thread(companion_manager.ensure_running, comp_cfg)
        except Exception as e:
            err_msg = json.dumps({
                "type": "crash",
                "code": 1,
                "signal": "COMPANION_ERROR",
                "message": f"Failed to start companion server: {e}",
                "stderr": f"Could not launch companion {comp_cfg.get('executable')}: {e}",
                "timestamp": datetime.datetime.now().isoformat()
            })
            await websocket.send(err_msg)
            return

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

    # Ensure persistent directories and files exist
    saves_dir = os.path.join(PROJECT_ROOT, "saves")
    saves_user_dir = os.path.join(saves_dir, "user")
    os.makedirs(saves_user_dir, exist_ok=True)
    scores_file = os.path.join(saves_dir, "scores.raw")
    if not os.path.exists(scores_file):
        open(scores_file, "a").close()
    atm_file = os.path.join(saves_user_dir, "automat.atm")
    if not os.path.exists(atm_file):
        open(atm_file, "a").close()

    # Index available profiles
    index_profiles()

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
    print(f" Indexed:     {', '.join(AVAILABLE_PROFILES.keys())}")
    print(f" Listening:   http://{args.host}:{args.port}")
    print(f" Static Dir:  {STATIC_DIR}")
    print(f"==================================================")

    def shutdown(sig, frame):
        print("\nShutting down server...")
        companion_manager.shutdown()
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
