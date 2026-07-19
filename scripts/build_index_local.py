#!/usr/bin/env python3
"""Local full cover-index builder -> upload to Vercel Blob."""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ENV_LOCAL = ROOT / ".env.local"
OUT_JSON = ROOT / "cover-index.full.json"
PROGRESS_JSON = ROOT / "cover-index.progress.json"

BASE = "https://www.piupiuchan.top"
PKG = "io.piupiu.chat"
SIG = "0290F67FD446FD51D54B8188880523EAFD74CB469CC58A880EE24333ED7AF004"
INDEX_PATH = "fzsm/cover-index.json"

PAGE_SIZE = 50
LIST_WORKERS = 8
IMG_WORKERS = 20
SAVE_EVERY = 100


def load_token() -> str:
    tok = os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip()
    if tok:
        return tok
    if ENV_LOCAL.exists():
        for line in ENV_LOCAL.read_text(encoding="utf-8").splitlines():
            if line.startswith("BLOB_READ_WRITE_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("BLOB_READ_WRITE_TOKEN missing (.env.local or env)")


def http_json(method: str, url: str, body: dict | None = None, headers: dict | None = None, timeout: int = 60):
    data = None
    h = {"User-Agent": "fzsm-local-indexer/1.0", "Accept": "application/json"}
    if headers:
        h.update(headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        if not raw:
            return None
        return json.loads(raw.decode("utf-8"))


def http_bytes(url: str, timeout: int = 45) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "fzsm-local-indexer/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def integrity() -> dict:
    return {
        "app_platform": "android",
        "app_package_name": PKG,
        "app_signature_sha256": SIG,
    }


def list_page(page: int, page_size: int = PAGE_SIZE) -> dict:
    body = {
        "action": "list",
        "page": page,
        "page_size": page_size,
        "sort": "最新",
        "tag": "",
        "search": "",
        "device_id": "local-index-bot",
        **integrity(),
    }
    data = http_json("POST", f"{BASE}/role_market.php", body=body, timeout=60)
    if not data or data.get("status") != "success":
        raise RuntimeError((data or {}).get("message") or f"list page {page} failed")
    return data.get("data") or {}


def proxy_image(url: str) -> str:
    if not url:
        return ""
    r = str(url).strip()
    if not r or r.startswith("data:") or "/proxy_image.php" in r:
        return r
    b64 = base64.b64encode(r.encode("utf-8")).decode("ascii")
    return f"{BASE}/proxy_image.php?url={urllib.parse.quote(b64)}"


def image_features(img_bytes: bytes) -> tuple[str, str, list[int]]:
    im = Image.open(BytesIO(img_bytes)).convert("RGB").resize((32, 32), Image.BILINEAR)
    px = list(im.getdata())  # 1024 RGB tuples

    # 8x8 grayscale block averages (4x4 each)
    gray8 = []
    for by in range(8):
        for bx in range(8):
            s = 0.0
            n = 0
            for y in range(4):
                for x in range(4):
                    gy = by * 4 + y
                    gx = bx * 4 + x
                    r, g, b = px[gy * 32 + gx]
                    s += 0.299 * r + 0.587 * g + 0.114 * b
                    n += 1
            gray8.append(s / n)
    avg = sum(gray8) / 64.0
    bits = [1 if v >= avg else 0 for v in gray8]
    out = bytearray(8)
    for i, bit in enumerate(bits):
        if bit:
            out[i >> 3] |= 1 << (7 - (i & 7))
    ahash = base64.b64encode(bytes(out)).decode("ascii")
    luma = base64.b64encode(bytes(max(0, min(255, round(v))) for v in gray8)).decode("ascii")

    # 9x8 horizontal difference hash: captures edges and layout rather than palette.
    dbits: list[int] = []
    for y in range(8):
        py = (y * 32) // 8
        for x in range(8):
            lx = (x * 32) // 9
            rx = ((x + 1) * 32) // 9
            lr, lg, lb = px[py * 32 + lx]
            rr, rg, rb = px[py * 32 + rx]
            lv = 0.299 * lr + 0.587 * lg + 0.114 * lb
            rv = 0.299 * rr + 0.587 * rg + 0.114 * rb
            dbits.append(1 if lv >= rv else 0)
    dout = bytearray(8)
    for i, bit in enumerate(dbits):
        if bit:
            dout[i >> 3] |= 1 << (7 - (i & 7))
    dhash = base64.b64encode(bytes(dout)).decode("ascii")

    colors: list[int] = []
    for cy in range(4):
        for cx in range(4):
            sr = sg = sb = 0
            n = 0
            for y in range(8):
                for x in range(8):
                    gy = cy * 8 + y
                    gx = cx * 8 + x
                    r, g, b = px[gy * 32 + gx]
                    sr += r
                    sg += g
                    sb += b
                    n += 1
            colors.extend([round(sr / n), round(sg / n), round(sb / n)])
    return ahash, dhash, luma, colors


def fetch_existing_index(token: str) -> dict:
    # try public production API first
    try:
        data = http_json("GET", "https://fzsm.vercel.app/api/cover-index", timeout=90)
        idx = ((data or {}).get("data") or {}).get("index")
        if idx and isinstance(idx.get("items"), list):
            print(f"loaded cloud index via API: {len(idx['items'])} items")
            return idx
    except Exception as e:
        print("api index load failed:", e)

    # try blob list
    try:
        url = "https://vercel.com/api/blob?limit=20&prefix=" + urllib.parse.quote(INDEX_PATH)
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "x-api-version": "7",
                "User-Agent": "fzsm-local-indexer/1.0",
            },
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            listing = json.loads(resp.read().decode())
        blobs = listing.get("blobs") or []
        file = next((b for b in blobs if b.get("pathname") == INDEX_PATH), None) or (blobs[0] if blobs else None)
        if file and file.get("url"):
            raw = http_bytes(file["url"], timeout=120)
            idx = json.loads(raw.decode("utf-8"))
            if isinstance(idx.get("items"), list):
                print(f"loaded cloud index via blob: {len(idx['items'])} items")
                return idx
    except Exception as e:
        print("blob index load failed:", e)

    if PROGRESS_JSON.exists():
        idx = json.loads(PROGRESS_JSON.read_text(encoding="utf-8"))
        print(f"loaded local progress: {len(idx.get('items') or [])} items")
        return idx
    if OUT_JSON.exists():
        idx = json.loads(OUT_JSON.read_text(encoding="utf-8"))
        print(f"loaded local full file: {len(idx.get('items') or [])} items")
        return idx
    return {"v": 1, "updatedAt": 0, "crawl": {}, "items": []}


def upload_blob(token: str, payload: dict) -> str:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    # Vercel Blob put REST
    q = urllib.parse.urlencode(
        {
            "pathname": INDEX_PATH,
            "addRandomSuffix": "false",
            "allowOverwrite": "true",
            "access": "public",
            "contentType": "application/json; charset=utf-8",
        }
    )
    url = f"https://vercel.com/api/blob?{q}"
    req = urllib.request.Request(
        url,
        data=body,
        method="PUT",
        headers={
            "Authorization": f"Bearer {token}",
            "x-api-version": "7",
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "fzsm-local-indexer/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read().decode())
    return data.get("url") or data.get("downloadUrl") or str(data)


def build_role_list() -> tuple[list[dict], int]:
    first = list_page(1, PAGE_SIZE)
    total_pages = int(first.get("total_pages") or first.get("totalPages") or 1)
    total = int(first.get("total") or 0)
    print(f"market total={total} pages={total_pages} page_size={PAGE_SIZE}")

    pages = {1: first}
    def fetch_one(p: int):
        for attempt in range(4):
            try:
                return p, list_page(p, PAGE_SIZE)
            except Exception as e:
                if attempt == 3:
                    raise
                time.sleep(0.6 * (attempt + 1))
        return p, {}

    with ThreadPoolExecutor(max_workers=LIST_WORKERS) as ex:
        futs = [ex.submit(fetch_one, p) for p in range(2, total_pages + 1)]
        done = 1
        for fut in as_completed(futs):
            p, data = fut.result()
            pages[p] = data
            done += 1
            if done % 20 == 0 or done == total_pages:
                print(f"  list pages {done}/{total_pages}")

    roles = []
    seen = set()
    for p in range(1, total_pages + 1):
        data = pages.get(p) or {}
        items = data.get("items") or []
        for role in items:
            rid = role.get("id")
            if rid is None:
                continue
            key = str(rid)
            if key in seen:
                continue
            seen.add(key)
            cover = role.get("cover_url") or role.get("image") or ""
            roles.append(
                {
                    "id": rid,
                    "name": role.get("name") or "",
                    "cover": cover,
                    "image": proxy_image(cover),
                    "views": role.get("view_count") if role.get("view_count") is not None else role.get("views") or 0,
                    "likes": role.get("like_count") if role.get("like_count") is not None else role.get("likes") or 0,
                }
            )
    print(f"unique roles: {len(roles)}")
    return roles, total_pages


def process_role(role: dict) -> dict | None:
    img_url = role.get("image") or ""
    if not img_url:
        return None
    last_err = None
    for attempt in range(3):
        try:
            img_bytes = http_bytes(img_url, timeout=45)
            ahash, dhash, luma, colors = image_features(img_bytes)
            return {
                "id": role["id"],
                "name": role.get("name") or "",
                "image": img_url,
                "ahash": ahash,
                "dhash": dhash,
                "luma": luma,
                "colors": colors,
                "views": role.get("views") or 0,
                "likes": role.get("likes") or 0,
                "updatedAt": int(time.time() * 1000),
            }
        except Exception as e:
            last_err = e
            time.sleep(0.3 * (attempt + 1))
    print(f"  fail id={role.get('id')}: {last_err}")
    return None


def main():
    token = load_token()
    existing = fetch_existing_index(token)
    items_map = {}
    for it in existing.get("items") or []:
        if it and it.get("id") is not None and it.get("ahash"):
            items_map[str(it["id"])] = it

    roles, total_pages = build_role_list()

    need = []
    for role in roles:
        old = items_map.get(str(role["id"]))
        if old and old.get("image") == role["image"] and old.get("ahash") and old.get("dhash") and old.get("luma"):
            continue
        need.append(role)
    print(f"need features: {len(need)} (already have {len(items_map)})")

    done = 0
    ok = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=IMG_WORKERS) as ex:
        futs = {ex.submit(process_role, r): r for r in need}
        for fut in as_completed(futs):
            rec = fut.result()
            done += 1
            if rec:
                items_map[str(rec["id"])] = rec
                ok += 1
            if done % 50 == 0 or done == len(need):
                elapsed = time.time() - t0
                rate = done / elapsed if elapsed > 0 else 0
                print(f"  feats {done}/{len(need)} ok={ok} rate={rate:.1f}/s total_items={len(items_map)}")
            if done % SAVE_EVERY == 0:
                payload = {
                    "v": 1,
                    "updatedAt": int(time.time() * 1000),
                    "crawl": {
                        "nextPage": 1,
                        "totalPages": total_pages,
                        "done": False,
                        "lastRunAt": int(time.time() * 1000),
                        "mode": "local-full",
                        "note": "progress save",
                    },
                    "items": list(items_map.values()),
                }
                PROGRESS_JSON.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    payload = {
        "v": 1,
        "updatedAt": int(time.time() * 1000),
        "crawl": {
            "nextPage": 1,
            "totalPages": total_pages,
            "done": True,
            "lastRunAt": int(time.time() * 1000),
            "mode": "local-full",
            "lastAdded": ok,
            "lastScannedRoles": len(roles),
            "lastError": None,
        },
        "items": list(items_map.values()),
    }
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    PROGRESS_JSON.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT_JSON} items={len(payload['items'])}")

    print("uploading to Vercel Blob…")
    url = upload_blob(token, payload)
    print("uploaded:", url)
    print("DONE count=", len(payload["items"]))


if __name__ == "__main__":
    main()
