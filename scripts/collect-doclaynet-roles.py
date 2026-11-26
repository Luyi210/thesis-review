#!/usr/bin/env python3
"""Collect IBM DocLayNet role labels and digital cells without downloading page images."""

import argparse
import json
import math
import random
import re
import struct
import threading
import time
import zipfile
import zlib
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


URL = (
    "https://codait-cos-dax.s3.us.cloud-object-storage.appdomain.cloud/"
    "dax-doclaynet/1.0.0/DocLayNet_{}.zip"
)
SIZES = {"core": 30012083650, "extra": 8008878198}
SPLITS = ("train", "val", "test")
CHUNK = 8 * 1024 * 1024
SCIENCE = "scientific_articles"
HEADER = struct.Struct("<4s5H3I2H")


class Budget:
    def __init__(self, bytes_limit, requests_limit):
        self.bytes_limit = bytes_limit
        self.requests_limit = requests_limit
        self.requested = 0
        self.requests = 0
        self.downloaded = 0
        self.lock = threading.Lock()

    def reserve(self, size):
        with self.lock:
            if self.requested + size > self.bytes_limit or self.requests >= self.requests_limit:
                raise RuntimeError("HTTP range request budget exhausted")
            self.requested += size
            self.requests += 1

    def received(self, size):
        with self.lock:
            self.downloaded += size


class Archive:
    def __init__(self, name, budget):
        self.url = URL.format(name)
        self.size = SIZES[name]
        self.budget = budget
        self.etag = None
        self.position = 0
        self.range(0, 1)

    def range(self, start, stop):
        if not 0 <= start < stop <= self.size:
            raise ValueError(f"Invalid archive range {start}:{stop}")
        length = stop - start
        headers = {"Accept-Encoding": "identity", "Range": f"bytes={start}-{stop - 1}"}
        if self.etag:
            headers["If-Match"] = self.etag
        for attempt in range(3):
            self.budget.reserve(length)
            try:
                with urlopen(Request(self.url, headers=headers), timeout=40) as response:
                    expected = f"bytes {start}-{stop - 1}/{self.size}"
                    if response.status != 206 or response.headers.get("Content-Range") != expected:
                        raise RuntimeError(f"Archive server did not honor verified byte range {expected}")
                    etag = response.headers.get("ETag")
                    if not etag or self.etag not in (None, etag):
                        raise RuntimeError("Archive ETag changed or was omitted")
                    body = response.read(length + 1)
                    if len(body) != length:
                        raise IOError(f"Received {len(body)} bytes, expected {length}")
                    self.etag = etag
                    self.budget.received(length)
                    return body
            except HTTPError as error:
                if error.code not in (408, 429, 500, 502, 503, 504) or attempt == 2:
                    raise
            except (OSError, URLError):
                if attempt == 2:
                    raise
            time.sleep(0.5 * (attempt + 1))

    def seek(self, offset, whence=0):
        self.position = {0: 0, 1: self.position, 2: self.size}[whence] + offset
        if self.position < 0:
            raise OSError("Negative archive seek")
        return self.position

    def tell(self):
        return self.position

    def seekable(self):
        return True

    def read(self, size=-1):
        stop = self.size if size < 0 else min(self.size, self.position + size)
        chunks = [
            self.range(start, min(stop, start + CHUNK))
            for start in range(self.position, stop, CHUNK)
        ]
        self.position = stop
        return b"".join(chunks)

    def member(self, info):
        """Read one small JSON member in one request when the ZIP headers agree."""
        if info.file_size > 2 * 1024 * 1024 or info.compress_type not in (0, 8):
            raise ValueError(f"Unsupported digital-cell member {info.filename}")
        start = info.header_offset
        guessed = HEADER.size + len(info.filename.encode("utf-8")) + len(info.extra)
        raw = self.range(start, min(self.size, start + guessed + info.compress_size))
        magic, _, flags, method, *_, name_size, extra_size = HEADER.unpack_from(raw)
        if magic != b"PK\x03\x04" or flags & 1 or method != info.compress_type:
            raise ValueError(f"Unexpected local header for {info.filename}")
        payload_start = HEADER.size + name_size + extra_size
        stop = payload_start + info.compress_size
        if stop > len(raw):
            raw += self.range(start + len(raw), start + stop)
        if raw[HEADER.size : HEADER.size + name_size].decode("utf-8") != info.filename:
            raise ValueError(f"Local ZIP member disagrees with directory for {info.filename}")
        payload = raw[payload_start:stop]
        if method == 8:
            inflater = zlib.decompressobj(-15)
            payload = inflater.decompress(payload, info.file_size + 1)
            if not inflater.eof:
                raise ValueError(f"Incomplete deflate stream for {info.filename}")
        if len(payload) != info.file_size or zlib.crc32(payload) != info.CRC:
            raise ValueError(f"CRC or size mismatch for {info.filename}")
        return payload


def bbox_xyxy(value, width, height):
    if not isinstance(value, list) or len(value) != 4:
        return
    if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in value):
        return
    x, y, w, h = value
    x1, y1 = max(0, x), max(0, y)
    x2, y2 = min(width, x + w), min(height, y + h)
    if x2 > x1 and y2 > y1:
        return [x1, y1, x2, y2]


def sidecar_name(image):
    return f"JSON/{Path(image['file_name']).stem}.json"


def sample(coco, members, count, rng, max_per_doc):
    roles = {role["id"]: role["name"] for role in coco["categories"]}
    images = {}
    identities = set()
    for page in coco["images"]:
        identity = (page["doc_name"], page["page_no"])
        if identity in identities or page.get("precedence", 0) != 0:
            continue
        if (page["width"], page["height"]) != (1025, 1025) or sidecar_name(page) not in members:
            continue
        identities.add(identity)
        images[page["id"]] = page

    annotations = defaultdict(list)
    page_roles = defaultdict(set)
    rare = {"Caption", "Footnote", "Formula", "Page-footer", "Page-header", "Title", "Table"}
    for box in coco["annotations"]:
        if box["image_id"] not in images or box.get("precedence", 0) != 0:
            continue
        bounds = bbox_xyxy(box["bbox"], 1025, 1025)
        if bounds:
            role = roles[box["category_id"]]
            annotations[box["image_id"]].append({"bbox": bounds, "role": role})
            if role in rare:
                page_roles[box["image_id"]].add(role)

    buckets = defaultdict(list)
    for image_id, page in images.items():
        if image_id in annotations:
            buckets[page["doc_category"]].append(page)
    for pages in buckets.values():
        pages.sort(key=lambda p: rng.random() + min(len(page_roles[p["id"]]), 3) * 0.09,
                   reverse=True)
    seen = Counter()
    cursors = Counter()

    def take(category):
        pages = buckets[category]
        while cursors[category] < len(pages):
            page = pages[cursors[category]]
            cursors[category] += 1
            if seen[page["doc_name"]] < max_per_doc:
                seen[page["doc_name"]] += 1
                return page, annotations[page["id"]]

    others = sorted(buckets.keys() - {SCIENCE})
    for index in range(count):
        preferred = [SCIENCE, *others] if index % 20 < 13 else [*others, SCIENCE]
        for category in preferred:
            selected = take(category)
            if selected:
                yield selected
                if category in others:
                    others.remove(category)
                    others.append(category)
                break
        else:
            return


def build_row(job, split, extra, members):
    page, annotations = job
    name = sidecar_name(page)
    content = json.loads(extra.member(members[name]))
    metadata = content["metadata"]
    expected = (Path(page["file_name"]).stem, page["doc_name"], page["page_no"], 1025, 1025)
    actual = tuple(
        metadata[key] for key in ("page_hash", "original_filename", "page_no", "coco_width", "coco_height")
    )
    if actual != expected:
        raise ValueError(f"Digital-cell metadata disagrees with COCO for {name}")
    cells = []
    for item in content["cells"]:
        bounds = bbox_xyxy(item["bbox"], 1025, 1025)
        text = item.get("text")
        if not bounds or not isinstance(text, str) or not text.strip():
            continue
        font = item.get("font")
        if isinstance(font, dict):
            font = font.get("name")
        cells.append({"bbox": bounds, "text": text, "font": font if isinstance(font, str) else ""})
    return {
        "split": split, "doc": page["doc_name"], "page": page["page_no"],
        "width": 1025, "height": 1025, "cells": cells, "annotations": annotations,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--pages", type=int, default=3200)
    parser.add_argument("--workers", type=int, default=20)
    parser.add_argument("--seed", type=int, default=2718)
    parser.add_argument("--max-per-doc", type=int, default=4)
    parser.add_argument("--max-mib", type=int, default=256)
    parser.add_argument("--max-requests", type=int, default=8000)
    args = parser.parse_args()
    if not 3 <= args.pages <= 5000 or not 1 <= args.workers <= 32 or args.max_per_doc < 1:
        parser.error("Specify 3–5000 pages, 1–32 workers, and at least one page per document")
    out = args.out
    partial = out.with_suffix(out.suffix + ".partial")
    provenance = out.with_suffix(".provenance.json")
    if out.exists() or partial.exists() or provenance.exists():
        parser.error("Output path already exists")
    out.parent.mkdir(parents=True, exist_ok=True)
    budget = Budget(args.max_mib * 1024 * 1024, args.max_requests)
    with ThreadPoolExecutor(max_workers=2) as pool:
        core, extra = pool.map(lambda name: Archive(name, budget), ("core", "extra"))
        core_zip, extra_zip = pool.map(zipfile.ZipFile, (core, extra))
    print("Verified archive directories; collecting COCO and matching digital cells only.", flush=True)
    members = {
        x.filename: x for x in extra_zip.infolist()
        if re.fullmatch(r"JSON/[0-9a-f]{64}\.json", x.filename)
    }
    extra_zip.close()
    per_small_split = max(1, args.pages // 8)
    goals = (args.pages - 2 * per_small_split, per_small_split, per_small_split)
    counts = {}
    roles = {}
    categories = {}
    coco_hashes = {}
    split_docs = {}
    rng = random.Random(args.seed)
    with core_zip, partial.open("x", encoding="utf-8") as output, ThreadPoolExecutor(args.workers) as pool:
        for split, goal in zip(SPLITS, goals):
            raw = core_zip.read(f"COCO/{split}.json")
            coco_hashes[split] = sha256(raw).hexdigest()
            coco = json.loads(raw)
            del raw
            jobs = list(sample(coco, members, min(goal + max(24, goal // 5), goal * 3), rng, args.max_per_doc))
            del coco
            count = 0
            roles[split] = Counter()
            categories[split] = Counter()
            split_docs[split] = set()
            for offset in range(0, len(jobs), 4 * args.workers):
                batch = jobs[offset : offset + 4 * args.workers]
                rows = pool.map(lambda job: build_row(job, split, extra, members), batch)
                for job, row in zip(batch, rows):
                    if not row["cells"] or count >= goal:
                        continue
                    output.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
                    count += 1
                    split_docs[split].add(row["doc"])
                    categories[split][job[0]["doc_category"]] += 1
                    roles[split].update(box["role"] for box in row["annotations"])
                output.flush()
                if count and (count >= goal or count % 400 < 4 * args.workers):
                    print(f"{split}: {count}/{goal} pages", flush=True)
                if count >= goal:
                    break
            if count != goal:
                raise RuntimeError(f"{split}: wanted {goal} usable pages, received {count}")
            counts[split] = count
    if any(split_docs[a] & split_docs[b] for a, b in (("train", "val"), ("train", "test"), ("val", "test"))):
        raise RuntimeError("Original document names overlap across output splits")
    details = {
        "dataset": "IBM DocLayNet 1.0.0", "seed": args.seed, "max_pages_per_document": args.max_per_doc,
        "coordinate_system": "1025 × 1025, top-left; converted xywh to xyxy and clipped to page",
        "selection": "primary annotations only; document cap; 65% scientific articles where available; category rotation",
        "sources": {name: {"url": archive.url, "size": archive.size, "etag": archive.etag}
                    for name, archive in (("core", core), ("extra", extra))},
        "coco_json_sha256": coco_hashes, "pages": counts, "roles": roles, "categories": categories,
        "documents": {split: len(docs) for split, docs in split_docs.items()},
        "ranges": {"requests": budget.requests, "requested_bytes": budget.requested,
                   "verified_bytes": budget.downloaded, "max_requests": args.max_requests, "max_mib": args.max_mib},
    }
    provenance.write_text(json.dumps(details, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    partial.rename(out)
    print(f"Collected {sum(counts.values())} pages at {out}; see {provenance}", flush=True)


if __name__ == "__main__":
    main()
