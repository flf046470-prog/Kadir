#!/usr/bin/env python3
"""
Run Python inside the open DERINLIK Unreal Editor from a terminal (or from a local Claude Code session).

Uses the engine's own remote_execution.py (Python Editor Script Plugin). The project enables it in
Config/DefaultEngine.ini, bound to 127.0.0.1 only. Open the project in the editor first.

    python Tools/Unreal/ue_remote.py --ping
    python Tools/Unreal/ue_remote.py --code "import unreal; print(unreal.SystemLibrary.get_engine_version())"
    python Tools/Unreal/ue_remote.py --file Tools/Unreal/import_meshy_assets.py

Set UE_ROOT if the engine is not under C:/Program Files/Epic Games/UE_5.x.
"""
import argparse
import glob
import importlib.util
import os
import sys
import time

REL_MODULE = os.path.join("Engine", "Plugins", "Experimental", "PythonScriptPlugin", "Content", "Python", "remote_execution.py")


def find_remote_execution():
    roots = [os.environ["UE_ROOT"]] if os.environ.get("UE_ROOT") else []
    roots += sorted(glob.glob(r"C:\Program Files\Epic Games\UE_5*"), reverse=True)
    for root in roots:
        path = os.path.join(root, REL_MODULE)
        if os.path.isfile(path):
            return path
    return None


def load_module(path):
    spec = importlib.util.spec_from_file_location("remote_execution", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def connect(rx, timeout):
    config = rx.RemoteExecutionConfig()
    if hasattr(config, "multicast_bind_address"):
        config.multicast_bind_address = "127.0.0.1"   # must match the editor's bind address
    remote = rx.RemoteExecution(config)
    remote.start()
    deadline = time.time() + timeout
    while time.time() < deadline and not remote.remote_nodes:
        time.sleep(0.25)
    nodes = remote.remote_nodes
    if not nodes:
        remote.stop()
        return None, None
    # Prefer the editor that has this project open when several are running.
    node = next((n for n in nodes if "Derinlik" in str(n.get("project_name", ""))), nodes[0])
    remote.open_command_connection(node["node_id"])
    return remote, node


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--ping", action="store_true", help="find the editor and print its engine version")
    group.add_argument("--code", help="Python source to run in the editor")
    group.add_argument("--file", help="Python file to run in the editor")
    parser.add_argument("--timeout", type=float, default=8.0, help="seconds to wait for the editor")
    args = parser.parse_args(argv)

    module_path = find_remote_execution()
    if not module_path:
        print("remote_execution.py not found. Set UE_ROOT to your engine folder (e.g. C:\\Program Files\\Epic Games\\UE_5.6).")
        return 2
    rx = load_module(module_path)

    remote, node = connect(rx, args.timeout)
    if remote is None:
        print("No Unreal Editor found. Open Derinlik.uproject, wait until the editor is fully loaded, then retry. "
              "If it still fails: Edit > Project Settings > Plugins > Python > Enable Remote Execution must be on.")
        return 3

    try:
        if args.ping:
            command = "import unreal; print('Connected to', unreal.SystemLibrary.get_engine_version())"
        elif args.code:
            command = args.code
        else:
            command = os.path.abspath(args.file)
            if not os.path.isfile(command):
                print(f"File not found: {command}")
                return 2
        result = remote.run_command(command, unattended=True, exec_mode=rx.MODE_EXEC_FILE)
    finally:
        remote.stop()

    for entry in result.get("output", []) or []:
        print(f"[{entry.get('type', 'info')}] {str(entry.get('output', '')).rstrip()}")
    if result.get("result") not in (None, "None", ""):
        print(f"[result] {result['result']}")
    if not result.get("success"):
        print("Command failed in the editor (see output above).")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
