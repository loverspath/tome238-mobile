#!/usr/bin/env python3
"""
tomenet_acc.py - TomeNET Account Binary Parser, Validator & Admin Helper
Parses tomenet.acc records (struct account, 336 bytes), validates trial accounts,
and configures admin privileges.
"""

import os
import sys
import time
import struct
import fcntl
import argparse
import json
from pathlib import Path

# --- Struct account layout (336 bytes on 64-bit Linux/Android) ---
ACCOUNT_SIZE = 336
OFFSET_ID = 0
OFFSET_FLAGS = 4
OFFSET_NAME = 8
OFFSET_NORM = 38
OFFSET_PASS = 68

# Account flags from account.h
ACC_TRIAL = 0x00000001
ACC_ADMIN = 0x00000002
ACC_MULTI = 0x00000004
ACC_NOSCORE = 0x00000008
ACC_BANNED = 0x00004000
ACC_DELD = 0x00008000

DEFAULT_ACC_PATH = Path(__file__).resolve().parent.parent / "ref_repos" / "tomenet" / "lib" / "save" / "tomenet.acc"


def get_acc_path(custom_path=None):
    if custom_path:
        return Path(custom_path)
    return DEFAULT_ACC_PATH


def read_accounts(acc_path=None):
    p = get_acc_path(acc_path)
    if not p.exists():
        return []

    accounts = []
    with open(p, "rb") as f:
        fcntl.flock(f, fcntl.LOCK_SH)
        try:
            raw = f.read()
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)

    num_records = len(raw) // ACCOUNT_SIZE
    for idx in range(num_records):
        chunk = raw[idx * ACCOUNT_SIZE : (idx + 1) * ACCOUNT_SIZE]
        acc_id = struct.unpack_from("<I", chunk, OFFSET_ID)[0]
        flags = struct.unpack_from("<I", chunk, OFFSET_FLAGS)[0]
        name = chunk[OFFSET_NAME:OFFSET_NORM].split(b"\x00")[0].decode("latin1", errors="ignore")
        name_norm = chunk[OFFSET_NORM:OFFSET_PASS].split(b"\x00")[0].decode("latin1", errors="ignore")
        passwd = chunk[OFFSET_PASS : OFFSET_PASS + 20].split(b"\x00")[0].decode("latin1", errors="ignore")

        accounts.append({
            "index": idx,
            "id": acc_id,
            "name": name,
            "name_norm": name_norm,
            "flags": flags,
            "is_trial": bool(flags & ACC_TRIAL),
            "is_admin": bool(flags & ACC_ADMIN),
            "is_banned": bool(flags & ACC_BANNED),
            "is_deleted": bool(flags & ACC_DELD),
        })

    return accounts


def validate_accounts(acc_path=None, target_name=None):
    """
    Clears the ACC_TRIAL flag (0x01) for target_name (or all trial accounts if target_name is None).
    Returns list of validated account names.
    """
    p = get_acc_path(acc_path)
    if not p.exists():
        return []

    validated = []
    with open(p, "r+b") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            raw = bytearray(f.read())
            num_records = len(raw) // ACCOUNT_SIZE
            for idx in range(num_records):
                chunk = raw[idx * ACCOUNT_SIZE : (idx + 1) * ACCOUNT_SIZE]
                flags = struct.unpack_from("<I", chunk, OFFSET_FLAGS)[0]
                name = chunk[OFFSET_NAME:OFFSET_NORM].split(b"\x00")[0].decode("latin1", errors="ignore")

                if flags & ACC_TRIAL:
                    if target_name is None or name.lower() == target_name.lower():
                        new_flags = flags & (~ACC_TRIAL)
                        struct.pack_into("<I", raw, idx * ACCOUNT_SIZE + OFFSET_FLAGS, new_flags)
                        validated.append(name)

            if validated:
                f.seek(0)
                f.write(raw)
                f.flush()
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)

    return validated


def set_admin_flag(acc_path=None, target_name=None, is_admin=True):
    """
    Sets or unsets ACC_ADMIN flag (0x02) for target_name.
    """
    if not target_name:
        return False

    p = get_acc_path(acc_path)
    if not p.exists():
        return False

    updated = False
    with open(p, "r+b") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            raw = bytearray(f.read())
            num_records = len(raw) // ACCOUNT_SIZE
            for idx in range(num_records):
                chunk = raw[idx * ACCOUNT_SIZE : (idx + 1) * ACCOUNT_SIZE]
                flags = struct.unpack_from("<I", chunk, OFFSET_FLAGS)[0]
                name = chunk[OFFSET_NAME:OFFSET_NORM].split(b"\x00")[0].decode("latin1", errors="ignore")

                if name.lower() == target_name.lower():
                    if is_admin:
                        new_flags = (flags | ACC_ADMIN) & (~ACC_TRIAL)
                    else:
                        new_flags = flags & (~ACC_ADMIN)
                    struct.pack_into("<I", raw, idx * ACCOUNT_SIZE + OFFSET_FLAGS, new_flags)
                    updated = True
                    break

            if updated:
                f.seek(0)
                f.write(raw)
                f.flush()
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)

    return updated


def watch_and_auto_validate(acc_path=None, interval=1.0):
    p = get_acc_path(acc_path)
    print(f"[*] Watching {p} for unvalidated trial accounts (Ctrl+C to stop)...")
    while True:
        try:
            val = validate_accounts(p)
            if val:
                for name in val:
                    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Auto-validated account: '{name}' (ACC_TRIAL cleared)")
            time.sleep(interval)
        except KeyboardInterrupt:
            print("\n[*] Stopped watcher.")
            break
        except Exception as e:
            time.sleep(interval)


def main():
    parser = argparse.ArgumentParser(description="TomeNET Account Management & Auto-Validation Tool")
    parser.add_argument("--path", "-p", default=None, help="Custom path to tomenet.acc")
    parser.add_argument("--list", "-l", action="store_true", help="List all accounts")
    parser.add_argument("--validate", "-v", nargs="?", const="", help="Validate trial account (or all if omitted)")
    parser.add_argument("--admin", "-a", help="Grant ACC_ADMIN flag to specified account name")
    parser.add_argument("--watch", "-w", action="store_true", help="Watch and automatically validate new accounts")
    parser.add_argument("--json", "-j", action="store_true", help="Output in JSON format")

    args = parser.parse_args()
    acc_path = get_acc_path(args.path)

    if args.watch:
        watch_and_auto_validate(acc_path)
        return

    if args.validate is not None:
        target = args.validate if args.validate.strip() else None
        res = validate_accounts(acc_path, target)
        if res:
            print(f"[+] Successfully validated account(s): {', '.join(res)}")
        else:
            print("[-] No trial accounts required validation.")
        return

    if args.admin:
        ok = set_admin_flag(acc_path, args.admin, is_admin=True)
        if ok:
            print(f"[+] Granted ACC_ADMIN privileges to account '{args.admin}'.")
        else:
            print(f"[-] Account '{args.admin}' not found.")
        return

    # Default action: list accounts
    accounts = read_accounts(acc_path)
    if args.json:
        print(json.dumps(accounts, indent=2))
    else:
        print(f"=== TomeNET Accounts ({len(accounts)} total in {acc_path.name}) ===")
        if not accounts:
            print("(No accounts registered yet)")
        for a in accounts:
            status_tags = []
            if a["is_trial"]:
                status_tags.append("TRIAL (Unvalidated)")
            if a["is_admin"]:
                status_tags.append("ADMIN")
            if a["is_banned"]:
                status_tags.append("BANNED")
            tag_str = f"[{', '.join(status_tags)}]" if status_tags else "[Active]"
            print(f"ID #{a['id']:04d} | Name: {a['name']:<18} | Flags: 0x{a['flags']:08x} {tag_str}")


if __name__ == "__main__":
    main()
