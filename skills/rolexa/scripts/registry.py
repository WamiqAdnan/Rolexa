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
  registry.py log ROWS.tsv             -> adds applications to the tracker CSV. Input is tab-separated:
                                          site, company, title, location, fit, cv, mode, status, url, notes
                                          (date is added; a url already logged is skipped, unless its row was
                                          not sent, e.g. 'handed back', and is now sent: then that row is updated)
  registry.py update KEY STATUS [NOTE] -> changes one tracker row's status (interview, rejected, offer, ...).
                                          KEY = row number, the job url, or words matching one company/title
  registry.py insights [--days N]      -> quick numbers from the tracker: per site, CV, fit and mode; replies,
                                          interviews, rows waiting 14+ days, jobs handed back
  registry.py today                    -> applications logged today, per site, against the daily cap
  registry.py check SITE               -> exit 0 if SITE is under today's cap, exit 1 if it has reached it.
                                          Run before every application; exit 1 means no more on that site today

Data home: $ROLEXA_HOME or ~/.rolexa  (seen_jobs.tsv, last_run.tsv, config.json)
Tracker: config 'tracker_csv' (the user picks it at setup), else ~/.rolexa/applications.csv
Sites: linkedin, indeed, bayt, naukrigulf (aliases: li, naukri, ng)
"""
import csv, datetime, json, math, os, re, sys
from pathlib import Path

HOME = Path(os.environ.get("ROLEXA_HOME", Path.home() / ".rolexa"))
REG = HOME / "seen_jobs.tsv"
HEADER = ["id", "first_seen", "company", "title", "verdict", "note"]
STATE = HOME / "last_run.tsv"
STATE_HEADER = ["site", "last_run", "pending_start", "note"]
APPS_HEADER = ["date", "site", "company", "title", "location", "fit", "cv", "mode", "status", "url", "notes", "updated"]
LOG_FIELDS = APPS_HEADER[1:11]  # what 'log' reads, in order: site ... notes
SITES = ["linkedin", "indeed", "bayt", "naukrigulf"]
ALIAS = {"li": "linkedin", "naukri": "naukrigulf", "naukari": "naukrigulf", "ng": "naukrigulf"}
BUFFER = datetime.timedelta(hours=2)   # widens the search window for indexing lag
SLACK = datetime.timedelta(hours=12)   # 'posted' text is coarse ("1 day ago"), so only drop clearly older cards
DEFAULT_GAP = {"linkedin": 72, "indeed": 72, "bayt": 168, "naukrigulf": 168}  # hours, first run of a site
DEFAULT_CAP = 8
# Statuses that mean nothing was sent. Every other status counts toward the cap, 'unconfirmed' included:
# a submit with no confirmation page has most likely gone through.
NOT_SENT = {"handed back", "skipped", "already applied", "not submitted"}
WAITING = {"applied", "submitted by user", "unconfirmed"}          # sent, no news yet
REPLIED = {"replied", "screening", "assessment", "interview", "offer", "rejected"}
PROGRESSED = {"screening", "assessment", "interview", "offer"}
STATUSES = sorted(NOT_SENT | WAITING | REPLIED | {"no response", "withdrawn"})


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


def tracker():
    p = config().get("tracker_csv")
    return Path(os.path.expanduser(p)) if p else HOME / "applications.csv"


def read_apps(path=None):
    """(rows, header). The header keeps any columns the user added in a spreadsheet.
    Exits if the file exists but isn't a tracker, so a user's own CSV is never overwritten."""
    p = path or tracker()
    if not p.exists() or not p.read_text(encoding="utf-8-sig").strip():
        return [], list(APPS_HEADER)
    with p.open(newline="", encoding="utf-8-sig") as f:
        rd = csv.DictReader(f)
        rows, head = list(rd), list(rd.fieldnames or [])
    need = [h for h in APPS_HEADER if h not in head]
    if [h for h in ("date", "site", "status", "url") if h not in head]:
        sys.exit(f"{p} exists but isn't a Rolexa tracker (no {', '.join(need)} columns). "
                 "Pick another file: rolexa.py set tracker_csv /path/to/file.csv")
    return rows, head + need


def write_apps(rows, head, path=None):
    p = path or tracker()
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", newline="", encoding="utf-8-sig") as f:  # BOM so Excel reads non-English names right
        w = csv.DictWriter(f, fieldnames=head, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k) or "" for k in head})


DATE_FORMATS = ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%d.%m.%Y")


def days_of(text):
    """Every date the text could mean. A spreadsheet may rewrite 2026-10-09 as 09/10/2026 or 10/9/2026,
    so the daily cap counts a row as today if any reading of it is today."""
    t = (text or "").strip().split(" ")[0].split("T")[0]
    out = []
    for fmt in DATE_FORMATS:
        try:
            out.append(datetime.datetime.strptime(t, fmt).date())
        except ValueError:
            pass
    return out


def date_order(rows):
    """'dm' or 'md' when the file's slash dates show it (a first part over 12 means day first), else None.
    A spreadsheet saves every date in the same locale format, so one clear row settles the rest."""
    dm = md = 0
    for r in rows:
        m = re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})[/.-]\d{4}", (r.get("date") or "").strip().split(" ")[0])
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            dm, md = dm + (a > 12), md + (b > 12)
    return "dm" if dm > md else "md" if md > dm else None


def day_of(text, order=None):
    """One date for the text: ISO as is; slash dates in the file's order; if still unclear,
    the latest reading that isn't in the future."""
    d = days_of(text)
    if len(d) < 2:
        return d[0] if d else None
    t = (text or "").strip().split(" ")[0]
    if order and re.fullmatch(r"\d{1,2}[/.-]\d{1,2}[/.-]\d{4}", t):
        a, b, y = map(int, re.split(r"[/.-]", t))
        try:
            return datetime.date(y, b, a) if order == "dm" else datetime.date(y, a, b)
        except ValueError:
            pass
    past = [x for x in d if x <= datetime.date.today()]
    return max(past) if past else min(d)


def status_of(r):
    return (r.get("status") or "").strip().lower()


def today_counts(rows=None):
    today = datetime.date.today()
    counts = {s: 0 for s in SITES}
    for r in read_apps()[0] if rows is None else rows:
        if today in days_of(r.get("date")) and status_of(r) not in NOT_SENT:
            counts[r.get("site", "")] = counts.get(r.get("site", ""), 0) + 1
    return counts


def find_row(rows, key):
    """Index of the row KEY points at: a 1-based row number, a url, or words found in one company + title."""
    if key.isdigit() and 1 <= int(key) <= len(rows):
        return int(key) - 1
    hits = [i for i, r in enumerate(rows) if r.get("url") == key]
    if not hits:
        words = key.lower().split()
        hits = [i for i, r in enumerate(rows)
                if all(w in f"{r.get('company', '')} {r.get('title', '')}".lower() for w in words)]
    if len(hits) == 1:
        return hits[0]
    if not hits:
        sys.exit(f"no tracker row matches '{key}'")
    lines = "\n".join(f"  {i + 1}\t{rows[i].get('date')}\t{rows[i].get('company')}\t{rows[i].get('title')}\t"
                      f"{rows[i].get('status')}" for i in hits)
    sys.exit(f"'{key}' matches {len(hits)} rows; use the row number:\n{lines}")


def insights(rows, days=None):
    today, order = datetime.date.today(), date_order(rows)

    def when(r):
        return day_of(r.get("date"), order) or today
    if days:
        rows = [r for r in rows if when(r) >= today - datetime.timedelta(days=days)]
    sent = [r for r in rows if status_of(r) not in NOT_SENT]
    if not rows:
        return "The tracker is empty: nothing logged yet."
    week = today - datetime.timedelta(days=today.weekday())
    out = [f"Tracker: {tracker()}" + (f" (last {days} days)" if days else ""),
           f"Sent: {len(sent)} · this week: {sum(1 for r in sent if when(r) >= week)}"
           f" · today: {sum(1 for r in sent if today in days_of(r.get('date')))}"]
    count = {}
    for r in rows:
        count[status_of(r) or "(blank)"] = count.get(status_of(r) or "(blank)", 0) + 1
    out.append("By status: " + " · ".join(f"{k} {v}" for k, v in sorted(count.items(), key=lambda kv: -kv[1])))
    replied = sum(1 for r in sent if status_of(r) in REPLIED)
    prog = sum(1 for r in sent if status_of(r) in PROGRESSED)
    if sent:
        out.append(f"Replies: {replied}/{len(sent)} ({replied * 100 // len(sent)}%) · "
                   f"past screening or further: {prog}/{len(sent)} ({prog * 100 // len(sent)}%)")
    for col in ("site", "cv", "fit", "mode"):
        groups = {}
        for r in sent:
            groups.setdefault((r.get(col) or "-").strip() or "-", []).append(r)
        if len(groups) < 2 and col != "site":
            continue
        out.append(f"\nBy {col}:  sent · replied · interview+")
        for g, rs in sorted(groups.items(), key=lambda kv: -len(kv[1])):
            rep_, pro = sum(status_of(r) in REPLIED for r in rs), sum(status_of(r) in PROGRESSED for r in rs)
            name = Path(g).name if col == "cv" else g
            out.append(f"  {name[:30]:<30} {len(rs):>4} · {rep_:>3} · {pro:>3}"
                       + (f"  ({pro * 100 // len(rs)}%)" if len(rs) >= 5 else ""))
    stale = [r for r in sent if status_of(r) in WAITING
             and when(r) <= today - datetime.timedelta(days=14)]
    if stale:
        out.append(f"\nNo news after 14+ days: {len(stale)} (follow up, or mark them 'no response')")
        out += [f"  {r.get('date')} · {r.get('company')} · {r.get('title')}" for r in stale[:8]]
        if len(stale) > 8:
            out.append(f"  ... and {len(stale) - 8} more")
    todo = [r for r in rows if status_of(r) == "handed back"]
    if todo:
        out.append(f"\nHanded back to you, not sent yet: {len(todo)}")
        out += [f"  {r.get('company')} · {r.get('title')} · {r.get('url')}" for r in todo[:8]]
    return "\n".join(out)


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
        rows, head = read_apps()
        at = {r.get("url"): r for r in rows if r.get("url")}
        added = changed = 0
        for row in read_tsv(sys.argv[2]):
            r = dict(zip(LOG_FIELDS, row + [""] * (len(LOG_FIELDS) - len(row))))
            r["site"] = ALIAS.get(r["site"].lower(), r["site"].lower())
            old = at.get(r["url"]) if r["url"] else None
            if old and status_of(old) in NOT_SENT and r["status"].strip().lower() not in NOT_SENT:
                old.update({k: v for k, v in r.items() if v}, date=today, updated=today)
                changed += 1
                continue
            if old:
                print(f"[registry] already in the tracker, skipped: {r['url']}", file=sys.stderr)
                continue
            rows.append(dict(date=today, updated=today, **r))
            at[r["url"]] = rows[-1]
            added += 1
        write_apps(rows, head)
        print(f"[registry] tracker: {added} added, {changed} updated -> {tracker()}", file=sys.stderr)
        cap = daily_cap()
        for site, n in today_counts(rows).items():
            if n > cap:  # logging never drops a record: it was sent, so it is kept, but this should not happen
                print(f"[registry] WARNING {site} is over today's cap ({n}/{cap}): 'check' was skipped", file=sys.stderr)
    elif cmd == "today":
        cap = daily_cap()
        for site, n in today_counts().items():
            print(f"{site}\t{n}/{cap}" + ("\tCAP REACHED" if n >= cap else ""))
    elif cmd == "update":
        if len(sys.argv) < 4:
            sys.exit(f"usage: update KEY STATUS [NOTE]; statuses: {', '.join(STATUSES)}")
        rows, head = read_apps()
        i, status = find_row(rows, sys.argv[2]), sys.argv[3].strip().lower().replace("_", " ")
        if status not in STATUSES:
            print(f"[registry] note: '{status}' isn't a usual status ({', '.join(STATUSES)}); saved anyway",
                  file=sys.stderr)
        r = rows[i]
        before = r.get("status")
        note = " ".join(sys.argv[4:]).strip()
        r.update(status=status, updated=today)
        if note:
            r["notes"] = f"{r.get('notes')}; {note}" if r.get("notes") else note
        write_apps(rows, head)
        print(f"row {i + 1}: {r.get('company')} · {r.get('title')}: {before} -> {status}")
    elif cmd == "insights":
        days = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else None
        print(insights(read_apps()[0], days))
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
