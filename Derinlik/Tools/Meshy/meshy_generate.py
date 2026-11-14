#!/usr/bin/env python3
"""
Generate DERINLIK props with the Meshy Text-to-3D API (preview -> refine -> download).

Usage (Windows PowerShell):
    $env:MESHY_API_KEY = "msy_..."            # never commit the key
    python Tools/Meshy/meshy_generate.py --dry-run          # show what would be sent, no credits
    python Tools/Meshy/meshy_generate.py --only SM_Flashlight
    python Tools/Meshy/meshy_generate.py                    # all assets in the list

Output: SourceArt/Meshy/<AssetName>/ (model.fbx, model.glb, textures, thumbnail, task.json).
Re-running skips assets that already finished, and resumes a preview/refine task that is still running.
Standard library only (Python 3.9+).
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_BASE_URL = "https://api.meshy.ai"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
PREVIEW_KEYS = ("ai_model", "model_type", "should_remesh", "topology", "target_polycount",
                "decimation_mode", "geometry_resolution", "pose_mode", "target_formats",
                "auto_size", "origin_at", "moderation")
REFINE_KEYS = ("enable_pbr", "texture_resolution", "texture_prompt", "target_formats",
               "auto_size", "origin_at", "moderation")
TERMINAL = ("SUCCEEDED", "FAILED", "CANCELED")


class MeshyError(RuntimeError):
    pass


class MeshyClient:
    def __init__(self, api_key, base_url=DEFAULT_BASE_URL, timeout=60):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _request(self, method, path, body=None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.base_url + path, data=data, method=method)
        req.add_header("Authorization", "Bearer " + self.api_key)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read()
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as err:
                detail = err.read().decode("utf-8", "replace")[:300]
                if err.code == 429 or err.code >= 500:
                    wait = 2 ** (attempt + 1)
                    print(f"  HTTP {err.code}, retrying in {wait}s: {detail}")
                    time.sleep(wait)
                    continue
                hints = {401: "check MESHY_API_KEY", 402: "not enough credits", 404: "task not found"}
                raise MeshyError(f"HTTP {err.code} ({hints.get(err.code, 'request rejected')}): {detail}")
            except urllib.error.URLError as err:
                wait = 2 ** (attempt + 1)
                print(f"  network error, retrying in {wait}s: {err.reason}")
                time.sleep(wait)
        raise MeshyError(f"{method} {path} failed after retries")

    def balance(self):
        return self._request("GET", "/openapi/v1/balance").get("balance")

    def create_task(self, body):
        task_id = self._request("POST", "/openapi/v2/text-to-3d", body).get("result")
        if not task_id:
            raise MeshyError("create task returned no id")
        return task_id

    def get_task(self, task_id):
        return self._request("GET", f"/openapi/v2/text-to-3d/{task_id}")

    def wait(self, task_id, poll_seconds, timeout_seconds):
        start = time.time()
        last = None
        while True:
            task = self.get_task(task_id)
            status, progress = task.get("status"), task.get("progress", 0)
            if (status, progress) != last:
                print(f"  {task_id}: {status} {progress}%")
                last = (status, progress)
            if status in TERMINAL:
                if status != "SUCCEEDED":
                    msg = (task.get("task_error") or {}).get("message", "")
                    raise MeshyError(f"task {task_id} {status}: {msg}")
                return task
            if time.time() - start > timeout_seconds:
                raise MeshyError(f"task {task_id} timed out after {timeout_seconds}s")
            time.sleep(poll_seconds)


def build_bodies(defaults, asset):
    merged = {**defaults, **{k: v for k, v in asset.items() if k not in ("name", "prompt")}}
    preview = {"mode": "preview", "prompt": asset["prompt"]}
    preview.update({k: merged[k] for k in PREVIEW_KEYS if k in merged})
    refine = {"mode": "refine"}
    refine.update({k: merged[k] for k in REFINE_KEYS if k in merged})
    if len(preview["prompt"]) > 800 or len(refine.get("texture_prompt", "")) > 800:
        raise MeshyError(f"{asset['name']}: prompt longer than 800 characters")
    return preview, refine


def download(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=300) as resp, open(tmp, "wb") as out:
        while True:
            chunk = resp.read(1 << 16)
            if not chunk:
                break
            out.write(chunk)
    tmp.replace(dest)


def save_outputs(task, out_dir):
    files = []
    for fmt, url in (task.get("model_urls") or {}).items():
        files.append((url, out_dir / f"model.{fmt}"))
    for index, textures in enumerate(task.get("texture_urls") or []):
        for channel, url in textures.items():
            suffix = "" if index == 0 else f"_{index}"
            files.append((url, out_dir / "textures" / f"T_{out_dir.name}_{channel}{suffix}.png"))
    if task.get("thumbnail_url"):
        files.append((task["thumbnail_url"], out_dir / "thumbnail.png"))
    for url, dest in files:
        print(f"  downloading {dest.name}")
        download(url, dest)


def load_state(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2), encoding="utf-8")


def process(client, defaults, asset, out_root, args):
    name = asset["name"]
    out_dir = out_root / name
    state_path = out_dir / "task.json"
    state = load_state(state_path)
    if state.get("status") == "DONE" and not args.force:
        print(f"[{name}] already done, skipping (use --force to regenerate)")
        return 0

    preview_body, refine_body = build_bodies(defaults, asset)
    if args.dry_run:
        print(f"[{name}] preview: {json.dumps(preview_body)}")
        if not args.preview_only:
            print(f"[{name}] refine:  {json.dumps({**refine_body, 'preview_task_id': '<preview id>'})}")
        return 0

    if args.force:
        state = {}
    print(f"[{name}]")
    if not state.get("preview_task_id"):
        state["preview_task_id"] = client.create_task(preview_body)
        state["prompt"] = asset["prompt"]
        write_state(state_path, state)
    preview = client.wait(state["preview_task_id"], args.poll, args.timeout)
    spent = preview.get("consumed_credits", 0) or 0

    if args.preview_only:
        save_outputs(preview, out_dir)
        state["status"] = "PREVIEW_DONE"
        write_state(state_path, state)
        return spent

    if not state.get("refine_task_id"):
        state["refine_task_id"] = client.create_task({**refine_body, "preview_task_id": state["preview_task_id"]})
        write_state(state_path, state)
    refined = client.wait(state["refine_task_id"], args.poll, args.timeout)
    spent += refined.get("consumed_credits", 0) or 0

    save_outputs(refined, out_dir)
    state.update(status="DONE", consumed_credits=spent, finished_at=int(time.time()))
    write_state(state_path, state)
    return spent


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--list", default=str(Path(__file__).with_name("assets_phase1.json")))
    parser.add_argument("--out", default=str(PROJECT_ROOT / "SourceArt" / "Meshy"))
    parser.add_argument("--only", action="append", help="asset name to generate (repeatable)")
    parser.add_argument("--dry-run", action="store_true", help="print request bodies, call nothing")
    parser.add_argument("--preview-only", action="store_true", help="untextured mesh only (cheaper)")
    parser.add_argument("--force", action="store_true", help="regenerate even if already done")
    parser.add_argument("--min-balance", type=int, default=0,
                        help="stop before an asset if the credit balance is below this")
    parser.add_argument("--poll", type=float, default=5.0)
    parser.add_argument("--timeout", type=float, default=1800.0)
    parser.add_argument("--base-url", default=os.environ.get("MESHY_BASE_URL", DEFAULT_BASE_URL))
    args = parser.parse_args(argv)

    spec = json.loads(Path(args.list).read_text(encoding="utf-8"))
    defaults, assets = spec.get("defaults", {}), spec["assets"]
    if args.only:
        wanted = set(args.only)
        unknown = wanted - {a["name"] for a in assets}
        if unknown:
            parser.error(f"unknown asset(s): {', '.join(sorted(unknown))}")
        assets = [a for a in assets if a["name"] in wanted]

    client = None
    if not args.dry_run:
        api_key = os.environ.get("MESHY_API_KEY", "").strip()
        if not api_key:
            parser.error("set the MESHY_API_KEY environment variable first")
        client = MeshyClient(api_key, args.base_url)
        try:
            print(f"Credit balance: {client.balance()}")
        except MeshyError as err:
            print(f"Cannot reach Meshy: {err}")
            return 1

    out_root = Path(args.out)
    total, failed = 0, []
    for asset in assets:
        try:
            if client and args.min_balance:
                balance = client.balance()
                if balance is not None and balance < args.min_balance:
                    print(f"Balance {balance} is below --min-balance {args.min_balance}; stopping.")
                    break
            total += process(client, defaults, asset, out_root, args)
        except MeshyError as err:
            print(f"[{asset['name']}] FAILED: {err}")
            failed.append(asset["name"])
            if "HTTP 401" in str(err) or "HTTP 402" in str(err):
                break

    if client:
        try:
            balance = client.balance()
        except MeshyError:
            balance = "unknown"
        print(f"Credits consumed this run: {total}. Balance now: {balance}")
    if failed:
        print("Failed: " + ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
