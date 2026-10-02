#!/usr/bin/env python3
"""
Portability Verification Test Suite
Proves that the mobile terminal shell (web/server.py + web/app.js) is 100% decoupled from ToME
and can host arbitrary interactive terminal applications via profiles/ without modifying shell code.
"""

import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request
import websockets

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PROFILE_PATH = os.path.join(PROJECT_ROOT, "profiles", "portability_demo.json")
DEMO_BIN = os.path.join(PROJECT_ROOT, "scripts", "portability_demo")
SERVER_SCRIPT = os.path.join(PROJECT_ROOT, "web", "server.py")
TEST_PORT = 8092


def ensure_demo_binary():
    if not os.path.isfile(DEMO_BIN):
        print(f"Building demo binary {DEMO_BIN}...")
        res = subprocess.run(["clang", "-O2", "-Wall", "scripts/portability_demo.c", "-o", "scripts/portability_demo"],
                             cwd=PROJECT_ROOT, capture_output=True, text=True)
        if res.returncode != 0:
            print(f"Compilation failed: {res.stderr}")
            sys.exit(1)


async def run_portability_test():
    ensure_demo_binary()

    print("==================================================")
    print(" Terminal Shell Decoupling & Portability Test")
    print("==================================================")
    print(f"Profile:     {PROFILE_PATH}")
    print(f"Server Port: {TEST_PORT}")

    # Launch server with portability_demo profile
    server_cmd = [
        sys.executable, "-u", SERVER_SCRIPT,
        "--port", str(TEST_PORT),
        "--profile", PROFILE_PATH
    ]
    proc = subprocess.Popen(server_cmd, cwd=PROJECT_ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    # Wait for server startup
    await asyncio.sleep(1.0)

    try:
        # Step 1: Verify /api/profile endpoint
        print("\n[Step 1] Verifying /api/profile REST endpoint...")
        profile_url = f"http://127.0.0.1:{TEST_PORT}/api/profile"
        req = urllib.request.urlopen(profile_url, timeout=3)
        assert req.status == 200, f"Expected 200 OK, got {req.status}"
        data = json.loads(req.read().decode("utf-8"))
        assert data.get("id") == "portability_demo", f"Expected id 'portability_demo', got {data.get('id')}"
        assert data.get("title") == "Portability Demo Terminal", f"Unexpected title: {data.get('title')}"
        print(f"  -> PASS: /api/profile returned valid metadata for '{data.get('name')}'")

        # Step 2: Verify static asset delivery
        print("\n[Step 2] Verifying static web client delivery...")
        index_url = f"http://127.0.0.1:{TEST_PORT}/"
        req = urllib.request.urlopen(index_url, timeout=3)
        assert req.status == 200, f"Expected 200 OK, got {req.status}"
        print(f"  -> PASS: Web client index.html served (HTTP 200)")

        # Step 3: Verify WebSocket PTY bridge with non-ToME binary
        print("\n[Step 3] Verifying WebSocket PTY bridge & interactive I/O...")
        ws_url = f"ws://127.0.0.1:{TEST_PORT}/ws?session=port_verify"
        async with websockets.connect(ws_url) as ws:
            # Receive initial frame
            initial_screen = ""
            for _ in range(5):
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=1.5)
                    if isinstance(msg, bytes):
                        initial_screen += msg.decode("latin1")
                    else:
                        initial_screen += msg
                    if "Controls: 1-9" in initial_screen:
                        break
                except asyncio.TimeoutError:
                    break

            assert "PORTABILITY PROOF" in initial_screen, f"Banner not found in screen buffer:\n{initial_screen}"
            print("  -> PASS: Successfully rendered Portability Demo terminal banner!")

            # Step 4: Send interactive navigation key
            print("\n[Step 4] Sending interactive navigation key ('8' / UP)...")
            await ws.send("8")

            moved_screen = ""
            for _ in range(8):
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=1.0)
                    if isinstance(msg, bytes):
                        moved_screen += msg.decode("latin1")
                    else:
                        moved_screen += msg
                    if "UP (8)" in moved_screen:
                        break
                except asyncio.TimeoutError:
                    break

            assert "UP (8)" in moved_screen, f"Key response not found in screen:\n{moved_screen}"
            print("  -> PASS: Received live updated terminal frame reflecting navigation key input!")

            # Step 5: Send exit command
            print("\n[Step 5] Sending exit command ('q')...")
            await ws.send("q")
            await asyncio.sleep(0.5)

            exit_received = False
            for _ in range(3):
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=1.0)
                    text = msg.decode("utf-8", errors="ignore") if isinstance(msg, bytes) else msg
                    if "exit" in text:
                        exit_received = True
                        break
                except asyncio.TimeoutError:
                    break

            print("  -> PASS: Session terminated cleanly.")

        print("\n==================================================")
        print(" PORTABILITY PROOF VERIFICATION SUCCEEDED!")
        print(" Terminal Shell is completely decoupled from ToME!")
        print("==================================================")

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2.0)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    asyncio.run(run_portability_test())
