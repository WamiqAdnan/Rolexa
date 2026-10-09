#!/usr/bin/env python3
"""Seen jobs, per-site last runs and the application log for the rolexa skill.

  registry.py filter CARDS.tsv [--all] -> prints unseen, non-skipped rows (id,title,company,location,posted,url).
                                          Title skips (config title_skip / level_skip) are recorded as 'title-skip';
                                          the same company+title already seen on another site as 'dup-of:<id>';
                                          cards posted before their site's last run are dropped unrecorded
                                          (--all keeps them)
  registry.py record VERDICTS.tsv      -> upserts rows: id, company, title, verdict, note
  registry.py show [N]                 -> last N registry rows
  registry.py since [SITE...]          -> per site: last run and the URL date filter covering the gap since;
                                          marks now as this run's start (pending until stamped)
  registry.py stamp SITE...            -> this run's start becomes the last run for those sites
  registry.py log ROWS.tsv             -> appends applications: site, company, title, location, cv, mode, status, url, notes
                                          (date is added; a url already logged is skipped)
  registry.py today                    -> applications logged today, per site, against the daily cap
  registry.py check SITE               -> exit 0 if SITE is under today's cap, exit 1 if it has reached it.
                                          Run before every application; exit 1 means no more on that site today

Data home: $ROLEXA_HOME or ~/.rolexa  (seen_jobs.tsv, last_run.tsv, applications.tsv, config.json)
Sites: linkedin, indeed, bayt, naukrigulf (aliases: li, naukri, ng)
"""
import csv, datetime, json, math, os, re, sys
from pathlib import Path

HOME = Path(os.environ.get("ROLEXA_HOME", Path.home() / ".rolexa"))
REG = HOME / "seen_jobs.tsv"
HEADER = ["id", "first_seen", "company", "title", "verdict", "note"]
STATE = HOME / "last_run.tsv"
STATE_HEADER = ["site", "last_run", "pending_start", "note"]
APPS = HOME / "applications.tsv"
APPS_HEADER = ["date", "site", "company", "title", "location", "cv", "mode", "status", "url", "notes"]
SITES = ["linkedin", "indeed", "bayt", "naukrigulf"]
ALIAS = {"li": "linkedin", "naukri": "naukrigulf", "naukari": "naukrigulf", "ng": "naukrigulf"}
BUFFER = datetime.timedelta(hours=2)   # widens the search window for indexing lag
SLACK = datetime.timedelta(hours=12)   # 'posted' text is coarse ("1 day ago"), so only drop clearly older cards
DEFAULT_GAP = {"linkedin": 72, "indeed": 72, "bayt": 168, "naukrigulf": 168}  # hours, first run of a site
DEFAULT_CAP = 8
# Statuses that mean nothing was sent. Every other status counts toward the cap, 'unconfirmed' included:
# a submit with no confirmation page has most likely gone through.
NOT_SENT = {"handed back", "skipped", "already applied", "not submitted"}


def config():
    p = HOME / "config.json"
    return json.loads(p.read_text()) if p.exists() else {}


def phrase_re(phrases):
    """Plain phrases -> one case-insensitive regex. Whole words; a trailing * makes the last word a prefix
    ('data scien*' matches 'Data Scientist'). 'java' does not match 'JavaScript'."""
    parts = []
    for p in phrases or []:
        star, p = p.strip().endswith("*"), p.strip().rstrip("*").strip()
        if p:
            parts.append(r"(?<![a-z0-9])" + r"\s+".join(map(re.escape, p.split())) + ("" if star else r"(?![a-z0-9])"))
    return re.compile("|".join(parts), re.I) if parts else None


def skipper():
    """title_skip always drops. level_skip (e.g. manager, intern) drops unless the title also matches
    level_keep (e.g. engineer, developer): some employers use 'Manager' as a grade for hands-on roles."""
    c = config()
    hard, level, keep = phrase_re(c.get("title_skip")), phrase_re(c.get("level_skip")), phrase_re(c.get("level_keep"))

    def skip(title):
        if hard and hard.search(title):
            return True
        return bool(level and level.search(title) and not (keep and keep.search(title)))
    return skip


def key(company, title):
    """Cross-site identity: first two words of the company + the whole title, alphanumerics only."""
    c = re.findall(r"[a-z0-9]+", (company or "").lower())[:2]
    t = re.findall(r"[a-z0-9]+", (title or "").lower())
    return " ".join(c) + "|" + " ".join(t)


def now():
    return datetime.datetime.now().astimezone().replace(microsecond=0)


def read_dicts(path):
    if not path.exists():
        return []
    with path.open(newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def write_dicts(path, header, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header, delimiter="\t")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in header})


def load_state():
    st = {r["site"]: r for r in read_dicts(STATE)}
    for site in SITES:
        st.setdefault(site, {"site": site})
    return st


def save_state(st):
    write_dicts(STATE, STATE_HEADER, [st[s] for s in SITES])


def last_run(st, site):
    v = st[site].get("last_run")
    return datetime.datetime.fromisoformat(v) if v else None


def parse_sites(args):
    sites = [ALIAS.get(a.lower(), a.lower()) for a in args]
    bad = [a for a in sites if a not in SITES]
    if bad:
        sys.exit(f"unknown site(s): {', '.join(bad)}; use {', '.join(SITES)}")
    return sites or SITES


def site_of(jid):
    return {"indeed": "indeed", "bayt": "bayt", "ng": "naukrigulf"}.get(jid.split(":")[0], "linkedin")


def window(site, gap):
    """URL date filter covering `gap` (+ buffer) since the last run; with no record, DEFAULT_GAP.
    Returns dict(param, value, label, wide): wide is set when the gap is longer than the site's widest filter."""
    h = (DEFAULT_GAP[site] if gap is None else (gap + BUFFER).total_seconds() / 3600)
    wide = ""
    if site == "linkedin":
        sec = max(math.ceil(h), 1) * 3600
        if sec > 2592000:
            sec, wide = 2592000, "30 days"
        return dict(param="f_TPR", value=f"r{sec}", label=fmt_h(sec / 3600), wide=wide)
    if site == "indeed":
        d = next((x for x in (1, 3, 7, 14) if x * 24 >= h), None)
        if d is None:
            d, wide = 14, "14 days"
        return dict(param="fromage", value=str(d), label=f"{d} days" if d > 1 else "24h", wide=wide)
    if site == "bayt":
        v, label = next(((v, l) for v, l, lim in ((3, "24h", 24), (2, "7 days", 168), (1, "30 days", 720)) if h <= lim), (None, None))
        if v is None:
            v, label, wide = 1, "30 days", "30 days"
        return dict(param="filters%5bjb_last_modification_date_interval%5d%5b%5d", value=str(v), label=label, wide=wide)
    d = next((x for x in (7, 15, 30) if x * 24 >= h), None)
    if d is None:
        d, wide = 30, "30 days"
    return dict(param="freshness", value=str(d), label=f"{d} days", wide=wide)


def window_text(site, gap):
    w = window(site, gap)
    out = f"{w['param']}={w['value']} ({w['label']})"
    if w["wide"]:
        out += f" ! gap is longer than the widest filter ({w['wide']}); older postings are not covered"
    return out


MONTHS = {m: i for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split(), 1)}
UNIT = {"m": 60, "h": 3600, "d": 86400, "w": 604800, "mo": 2592000}
REL = re.compile(r"(\d+)\+?\s*(mo(?:nths?|s)?|min(?:ute)?s?|h(?:ou)?rs?|hours?|h|days?|d|w(?:ee)?ks?|weeks?|w)\b", re.I)
DATE = re.compile(r"\b(\d{1,2})\s+([a-z]{3})|\b([a-z]{3})[a-z]*\s+(\d{1,2})\b", re.I)


def min_age(posted, ref):
    """Youngest the card can be, from text like '3 hours ago', 'Posted 30+ days ago', 'Yesterday', '25 Sep'.
    None when unreadable (the card is kept). Indeed's 'Employer active ...' is not a posting date."""
    p = (posted or "").lower()
    if not p or "active" in p:
        return None
    midnight = ref.replace(hour=0, minute=0, second=0)
    if re.search(r"just posted|just now|moments? ago|\btoday\b", p):
        return datetime.timedelta(0)
    if "yesterday" in p:
        return ref - midnight
    m = REL.search(p)
    if m:
        u = m.group(2).lower()
        u = "mo" if u.startswith("mo") else "m" if u.startswith("min") else u[0]
        return datetime.timedelta(seconds=int(m.group(1)) * UNIT[u])
    m = DATE.search(p)
    if m:
        day, mon = (m.group(1), m.group(2)) if m.group(1) else (m.group(4), m.group(3))
        if mon.lower()[:3] in MONTHS:
            try:
                d = midnight.replace(month=MONTHS[mon.lower()[:3]], day=int(day))
            except ValueError:
                return None
            if d > midnight:
                d = d.replace(year=d.year - 1)
            return max(ref - (d + datetime.timedelta(days=1)), datetime.timedelta(0))
    return None


def fmt_h(h):
    return f"{h:.0f}h" if h < 48 else f"{h / 24:.1f} days".replace(".0 days", " days")


def fmt(gap):
    return fmt_h(gap.total_seconds() / 3600)


def load():
    return {r["id"]: r for r in read_dicts(REG)}


def read_tsv(path):
    with open(path, newline="") as f:
        return [line.rstrip("\n").split("\t") for line in f if line.strip()]


def since(sites, mark=True):
    """Per site: (last_run, gap, window dict). Marks now as each site's pending start."""
    st, t = load_state(), now()
    out = {}
    for site in sites:
        lr = last_run(st, site)
        gap = t - lr if lr else None
        out[site] = (lr, gap, window(site, gap))
        if mark:
            st[site]["pending_start"] = t.isoformat()
    if mark:
        save_state(st)
    return out


def daily_cap():
    try:
        return max(1, int(config().get("daily_cap", DEFAULT_CAP)))
    except (TypeError, ValueError):
        return DEFAULT_CAP


def today_counts(rows=None):
    today = datetime.date.today().isoformat()
    counts = {s: 0 for s in SITES}
    for r in read_dicts(APPS) if rows is None else rows:
        if r.get("date") == today and r.get("status", "").strip().lower() not in NOT_SENT:
            counts[r.get("site", "")] = counts.get(r.get("site", ""), 0) + 1
    return counts


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd, today = sys.argv[1], datetime.date.today().isoformat()
    reg = load()
    if cmd == "filter":
        out, skipped, seen, xdup, old, dup = [], 0, 0, 0, 0, set()
        keys = {key(r.get("company"), r.get("title")): r["id"] for r in reg.values() if r.get("verdict") != "title-skip"}
        st, ref, skip = load_state(), now(), skipper()
        for row in read_tsv(sys.argv[2]):
            jid, title = row[0], (row[1] if len(row) > 1 else "")
            company = row[2] if len(row) > 2 else ""
            if jid in reg or jid in dup:
                seen += 1
                continue
            dup.add(jid)
            lr, age = last_run(st, site_of(jid)), min_age(row[4] if len(row) > 4 else "", ref)
            if "--all" not in sys.argv and lr and age is not None and age > ref - lr + SLACK:
                old += 1
                continue
            k = key(company, title)
            if k in keys and keys[k] != jid:
                reg[jid] = dict(id=jid, first_seen=today, company=company, title=title, verdict=f"dup-of:{keys[k]}")
                xdup += 1
                continue
            keys[k] = jid
            if skip(title):
                reg[jid] = dict(id=jid, first_seen=today, company=company, title=title, verdict="title-skip")
                skipped += 1
            else:
                out.append("\t".join(row))
        write_dicts(REG, HEADER, reg.values())
        print("\n".join(out))
        print(f"[registry] new to check: {len(out)} | title-skipped: {skipped} | same job on another site: {xdup} | "
              f"already seen: {seen} | posted before last run: {old}", file=sys.stderr)
    elif cmd == "record":
        n = 0
        for row in read_tsv(sys.argv[2]):
            row += [""] * (5 - len(row))
            jid, company, title, verdict, note = row[:5]
            prev = reg.get(jid, {})
            reg[jid] = dict(id=jid, first_seen=prev.get("first_seen", today), company=company or prev.get("company", ""),
                            title=title or prev.get("title", ""), verdict=verdict, note=note)
            n += 1
        write_dicts(REG, HEADER, reg.values())
        print(f"[registry] recorded {n}", file=sys.stderr)
    elif cmd == "show":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        for r in list(reg.values())[-n:]:
            print("\t".join(r.get(k, "") for k in HEADER))
    elif cmd == "since":
        for site, (lr, gap, _) in since(parse_sites(sys.argv[2:])).items():
            when = f"last run {lr:%a %d %b %H:%M} ({fmt(gap)} ago)" if lr else "first run: default window"
            print(f"{site}\t{when}\t{window_text(site, gap)}")
    elif cmd == "stamp":
        if len(sys.argv) < 3:
            sys.exit("stamp needs the sites that finished without a block, e.g. 'stamp linkedin indeed'")
        st = load_state()
        for site in parse_sites(sys.argv[2:]):
            if not st[site].get("pending_start"):
                print(f"[registry] {site}: no pending start (run 'since' or 'rolexa.py plan' first); not stamped", file=sys.stderr)
                continue
            st[site].update(last_run=st[site]["pending_start"], pending_start="", note="")
            print(f"[registry] {site}: last run = {st[site]['last_run']}", file=sys.stderr)
        save_state(st)
    elif cmd == "log":
        rows = read_dicts(APPS)
        logged = {r.get("url") for r in rows}
        added = 0
        for row in read_tsv(sys.argv[2]):
            r = dict(zip(APPS_HEADER[1:], row + [""] * (len(APPS_HEADER) - 1 - len(row))))
            r["site"] = ALIAS.get(r["site"].lower(), r["site"].lower())
            if r["url"] and r["url"] in logged:
                print(f"[registry] already logged, skipped: {r['url']}", file=sys.stderr)
                continue
            rows.append(dict(date=today, **r))
            logged.add(r["url"])
            added += 1
        write_dicts(APPS, APPS_HEADER, rows)
        print(f"[registry] logged {added} -> {APPS}", file=sys.stderr)
        cap = daily_cap()
        for site, n in today_counts(rows).items():
            if n > cap:  # logging never drops a record: it was sent, so it is kept, but this should not happen
                print(f"[registry] WARNING {site} is over today's cap ({n}/{cap}): 'check' was skipped", file=sys.stderr)
    elif cmd == "today":
        cap = daily_cap()
        for site, n in today_counts().items():
            print(f"{site}\t{n}/{cap}" + ("\tCAP REACHED" if n >= cap else ""))
    elif cmd == "check":
        if len(sys.argv) < 3:
            sys.exit("check needs one site, e.g. 'check linkedin'")
        site, cap = parse_sites(sys.argv[2:3])[0], daily_cap()
        n = today_counts()[site]
        if n >= cap:
            print(f"{site}\t{n}/{cap}\tCAP REACHED: no more {site} applications today")
            sys.exit(1)
        print(f"{site}\t{n}/{cap}\tok: {cap - n} left today")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
