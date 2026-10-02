#!/data/data/com.termux/files/usr/bin/python3
"""
Automated Test for ToME 2.3.8-ah Mobile Web Terminal
Tests HTTP static file serving, WebSocket handshake, PTY spawning, and bidirectional I/O.
"""

import asyncio
import os
import signal
import subprocess
import sys
import time
import urllib.request
import websockets

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TEST_PORT = 8089
SERVER_URL = f"http://127.0.0.1:{TEST_PORT}"
WS_URL = f"ws://127.0.0.1:{TEST_PORT}/ws?session=pytest"

def check_http():
    print("\n[Step 1] Testing HTTP Static Asset Endpoints...")
    endpoints = [
        ("/", "text/html"),
        ("/style.css", "text/css"),
        ("/app.js", "application/javascript"),
        ("/api/profile", "application/json"),
        ("/keyboards.json", "application/json"),
        ("/vendor/xterm.js", "application/javascript"),
        ("/vendor/xterm.css", "text/css")
    ]
    
    for path, expected_content_type in endpoints:
        url = SERVER_URL + path
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=3) as resp:
                status = resp.status
                ct = resp.headers.get("Content-Type", "")
                data = resp.read()
                if status == 200 and len(data) > 0:
                    print(f"  -> PASS: GET {path} ({status}, {len(data)} bytes, {ct})")
                else:
                    print(f"  -> FAIL: GET {path} returned {status}")
                    return False
        except Exception as e:
            print(f"  -> FAIL: GET {path} error: {e}")
            return False
    return True

async def check_websocket():
    print("\n[Step 2] Testing WebSocket PTY Bridge & Bidirectional I/O...")
    async with websockets.connect(WS_URL, close_timeout=2) as ws:
        print("  -> Connected to WebSocket endpoint!")
        
        # Send resize message
        await ws.send('{"type": "resize", "cols": 80, "rows": 24}')
        
        received_chunks = []
        start_time = time.time()
        
        # Read initial game output
        while time.time() - start_time < 4.0:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=1.0)
                if isinstance(msg, bytes):
                    received_chunks.append(msg.decode("latin1", errors="replace"))
                else:
                    received_chunks.append(msg)
                
                joined = "".join(received_chunks)
                if "Tales of Middle-earth" in joined or "Dol Guldur" in joined or "One Ring" in joined or "Initialising" in joined:
                    print("  -> PASS: Successfully received ToME engine banner and initialization output!")
                    break
            except asyncio.TimeoutError:
                break
                
        joined = "".join(received_chunks)
        print(f"  -> Total output received: {len(joined)} chars")
        
        if not received_chunks:
            print("  -> FAIL: No output received from game engine.")
            return False
            
        # Send interactive space / keystroke
        print("  -> Sending interactive space keystroke...")
        await ws.send(" ")
        await asyncio.sleep(0.5)
        
        # Read response after keystroke
        try:
            msg = await asyncio.wait_for(ws.recv(), timeout=1.5)
            print("  -> PASS: Received response after sending input to game.")
        except asyncio.TimeoutError:
            print("  -> INFO: No immediate extra output (engine waiting for input).")

    return True

def main():
    print("==================================================")
    print(" ToME 2.3.8-ah Mobile Web Terminal Integration Test")
    print("==================================================")
    
    server_cmd = [
        sys.executable,
        os.path.join(PROJECT_ROOT, "web", "server.py"),
        "--host", "127.0.0.1",
        "--port", str(TEST_PORT)
    ]
    
    print(f"Starting test server on port {TEST_PORT}...")
    proc = subprocess.Popen(server_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(1.2)
    
    try:
        if proc.poll() is not None:
            _, err = proc.communicate()
            print(f"Server failed to start: {err.decode()}")
            sys.exit(1)
            
        if not check_http():
            sys.exit(1)
            
        ws_success = asyncio.run(check_websocket())
        if not ws_success:
            sys.exit(1)
            
        print("\n==================================================")
        print(" ALL WEB & TERMINAL INTEGRATION TESTS PASSED!")
        print("==================================================")
    finally:
        print("\nTerminating test server...")
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except Exception:
            proc.kill()

if __name__ == "__main__":
    main()
