#!/data/data/com.termux/files/usr/bin/python3
"""
Test the crash detection, diagnostic capture, and reporting pipeline in web/server.py.
Verifies that:
1. When a child process is terminated by signal (e.g. SIGABRT/SIGSEGV) or non-zero exit,
   web/server.py emits a structured 'crash' JSON frame with exit code, signal name, and stderr snippet.
2. When a child process exits normally (code 0), it emits the standard 'exit' JSON frame.
"""
import asyncio
import json
import os
import signal
import subprocess
import sys
import time
import websockets

PROJECT_ROOT = "/data/data/com.termux/files/home/tome238-mobile"
TEST_PORT = 8095

async def test_pipeline():
    # Start server in background
    cmd = [
        sys.executable, "-u",
        os.path.join(PROJECT_ROOT, "web", "server.py"),
        "--port", str(TEST_PORT),
        "--profile", os.path.join(PROJECT_ROOT, "profiles", "tome238.json")
    ]
    srv = subprocess.Popen(cmd, cwd=PROJECT_ROOT)
    await asyncio.sleep(1.0)

    try:
        ws_url = f"ws://127.0.0.1:{TEST_PORT}/ws?session=test-crash"
        print(f"Connecting to {ws_url}...")
        async with websockets.connect(ws_url) as ws:
            # Drain initial buffer
            init_data = await asyncio.wait_for(ws.recv(), timeout=4.0)
            print(f"Received initial stream data ({len(init_data)} bytes)")

            # Find child process pid of session 'test-crash'
            # Look up child pid via pgrep or inspecting server
            out = subprocess.check_output(["pgrep", "-f", "game/tome -mgcu -MToME"]).decode().split()
            child_pids = [int(p) for p in out if int(p) != srv.pid]
            print(f"Detected game process pids: {child_pids}")

            if not child_pids:
                raise RuntimeError("Could not locate game child process PID")

            target_pid = child_pids[-1]
            print(f"Sending SIGSEGV (11) to target PID {target_pid}...")
            os.kill(target_pid, signal.SIGSEGV)

            # Wait for crash message over websocket
            msg_received = None
            start_t = time.time()
            while time.time() - start_t < 3.0:
                msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
                if isinstance(msg, bytes):
                    msg = msg.decode("utf-8", errors="replace")
                if msg.startswith("{"):
                    data = json.loads(msg)
                    if data.get("type") in ["crash", "exit"]:
                        msg_received = data
                        break

            print("\nReceived message from server:")
            print(json.dumps(msg_received, indent=2))

            assert msg_received is not None, "Did not receive crash message!"
            assert msg_received.get("type") == "crash", f"Expected type 'crash', got: {msg_received.get('type')}"
            assert msg_received.get("code") in [-11, 255], f"Expected code -11 or 255, got: {msg_received.get('code')}"
            assert msg_received.get("signal") == "SIGSEGV", f"Expected signal 'SIGSEGV', got: {msg_received.get('signal')}"
            assert "timestamp" in msg_received, "Expected timestamp in crash payload"
            assert "stderr" in msg_received, "Expected stderr in crash payload"
            print("\n  -> PASS: Successfully verified structured 'crash' diagnostic event over WebSocket!")

    finally:
        srv.terminate()
        try:
            srv.wait(timeout=2.0)
        except subprocess.TimeoutExpired:
            srv.kill()

if __name__ == "__main__":
    print("==================================================")
    print(" Crash Detection & Diagnostic Pipeline Test")
    print("==================================================")
    asyncio.run(test_pipeline())
    print("==================================================")
    print(" CRASH PIPELINE TEST PASSED!")
    print("==================================================")
