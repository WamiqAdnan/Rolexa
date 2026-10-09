#!/usr/bin/env python3
"""Prints the text of every resume under the given files or folders, newest first, so a profile can be built quickly.

  resume_text.py PATH... [--max N]  -> '=== <path> · modified YYYY-MM-DD · <words> words ===' then the text

.docx, .txt and .md are read directly (no dependencies). .pdf uses pdftotext when installed; otherwise the
file is listed with '[read with the Read tool]'. Word lock files (~$...) are skipped; a file whose text matches
an earlier one is listed as a duplicate. --max caps the characters printed per file (default 12000).
"""
import datetime, hashlib, html, re, shutil, subprocess, sys, zipfile
from pathlib import Path

EXT = {".docx", ".pdf", ".txt", ".md"}


def docx_text(p):
    with zipfile.ZipFile(p) as z:
        xml = z.read("word/document.xml").decode("utf8", "replace")
    xml = re.sub(r"<w:tab/>", "\t", xml)
    xml = re.sub(r"<w:br[^>]*/>", "\n", xml)
    xml = re.sub(r"</w:p>", "\n", xml)
    return html.unescape(re.sub(r"<[^>]+>", "", xml))


def pdf_text(p):
    if not shutil.which("pdftotext"):
        return None
    out = subprocess.run(["pdftotext", "-layout", str(p), "-"], capture_output=True, text=True)
    return out.stdout if out.returncode == 0 else None


def files(paths):
    for a in paths:
        p = Path(a).expanduser()
        if p.is_dir():
            yield from (f for f in p.rglob("*") if f.is_file() and f.suffix.lower() in EXT)
        elif p.is_file():
            yield p
        else:
            print(f"=== {p} · not found ===\n", file=sys.stderr)


def main():
    args, cap = sys.argv[1:], 12000
    if "--max" in args:
        i = args.index("--max")
        cap, args = int(args[i + 1]), args[:i] + args[i + 2:]
    if not args:
        sys.exit(__doc__)
    found = sorted({f.resolve() for f in files(args) if not f.name.startswith("~$")},
                   key=lambda f: f.stat().st_mtime, reverse=True)
    seen = {}
    for f in found:
        when = datetime.date.fromtimestamp(f.stat().st_mtime).isoformat()
        ext = f.suffix.lower()
        try:
            text = docx_text(f) if ext == ".docx" else pdf_text(f) if ext == ".pdf" else f.read_text(errors="replace")
        except (zipfile.BadZipFile, KeyError, OSError) as e:
            print(f"=== {f} · modified {when} · unreadable: {e} ===\n")
            continue
        if text is None:
            print(f"=== {f} · modified {when} · [read with the Read tool] ===\n")
            continue
        text = re.sub(r"\n\s*\n+", "\n", text).strip()
        h = hashlib.sha1(re.sub(r"\s+", " ", text).encode()).hexdigest()
        if h in seen:
            print(f"=== {f} · modified {when} · same text as {seen[h]} ===\n")
            continue
        seen[h] = f
        print(f"=== {f} · modified {when} · {len(text.split())} words ===")
        print(text[:cap] + ("\n[... cut at --max]" if len(text) > cap else ""))
        print()
    print(f"[resume_text] {len(found)} file(s), {len(seen)} distinct", file=sys.stderr)


if __name__ == "__main__":
    main()
