"""Set a new version: python scripts/bump_version.py 1.3.0 "What changed"

Updates the footer version and ?v= cache-busting in public/*.html, and adds a CHANGELOG entry.
Use MAJOR for a redesign, MINOR for new features, PATCH for fixes and wording.
"""
import datetime, pathlib, re, sys

if len(sys.argv) < 3 or not re.fullmatch(r"\d+\.\d+\.\d+", sys.argv[1]):
    sys.exit(__doc__)
ver, note = sys.argv[1], " ".join(sys.argv[2:])
root = pathlib.Path(__file__).resolve().parent.parent

for page in (root / "public").glob("*.html"):
    s = page.read_text(encoding="utf-8")
    s = re.sub(r"\?v=\d+\.\d+\.\d+", f"?v={ver}", s)
    s = re.sub(r'(<a class="ver"[^>]*>)v\d+\.\d+\.\d+', rf"\g<1>v{ver}", s)
    page.write_text(s, encoding="utf-8")

log = root / "CHANGELOG.md"
text = log.read_text(encoding="utf-8")
if f"## {ver} " not in text:
    text = text.replace("# Changelog\n", f"# Changelog\n\n## {ver} — {datetime.date.today()}\n- {note}\n", 1)
    log.write_text(text, encoding="utf-8")
print(f"Version set to {ver}. Commit, push, then Deploy HEAD in cPanel.")
