#!/usr/bin/env python3
"""Preferences, arguments and the search plan for the rolexa skill.

  rolexa.py status            -> 'first-run', 'incomplete: <sections>' or 'ready', with a one-line summary
  rolexa.py show              -> the saved preferences, readable
  rolexa.py set KEY VALUE     -> set one preference; KEY may be dotted (location.cities), VALUE is JSON or a plain string
  rolexa.py resolve ARGS...   -> merges this run's arguments with the saved preferences; prints the run as JSON.
                                 'save' in ARGS writes the overrides back as the new defaults
  rolexa.py plan ARGS...      -> resolve, mark this run's start for each site, print every search URL to open
  rolexa.py countries         -> known countries and which sites cover them
  rolexa.py latest            -> the newest shortlist (runs/*.tsv)

ARGS can be passed as separate words or as one quoted string; order and case don't matter.
Data home: $ROLEXA_HOME or ~/.rolexa
"""
import datetime, glob, json, os, re, shlex, sys
from pathlib import Path
from urllib.parse import quote, quote_plus

sys.path.insert(0, str(Path(__file__).resolve().parent))
import registry  # noqa: E402

HOME = registry.HOME
CONFIG = HOME / "config.json"
PROFILE = HOME / "profile.md"
RUNS = HOME / "runs"
SITES = registry.SITES

# code: (name, aliases, Indeed host, Bayt country slug, Naukri Gulf country slug). None = site doesn't cover it.
COUNTRIES = {
    "ae": ("United Arab Emirates", ["uae", "emirates"], "ae.indeed.com", "uae", "uae"),
    "sa": ("Saudi Arabia", ["ksa", "saudi"], "sa.indeed.com", "saudi-arabia", "saudi-arabia"),
    "qa": ("Qatar", [], "qa.indeed.com", "qatar", "qatar"),
    "kw": ("Kuwait", [], "kw.indeed.com", "kuwait", "kuwait"),
    "bh": ("Bahrain", [], "bh.indeed.com", "bahrain", "bahrain"),
    "om": ("Oman", [], "om.indeed.com", "oman", "oman"),
    "eg": ("Egypt", [], "eg.indeed.com", "egypt", None),
    "jo": ("Jordan", [], None, "jordan", None),
    "lb": ("Lebanon", [], None, "lebanon", None),
    "pk": ("Pakistan", [], "pk.indeed.com", None, None),
    "in": ("India", [], "in.indeed.com", None, None),
    "gb": ("United Kingdom", ["uk", "britain", "england"], "uk.indeed.com", None, None),
    "ie": ("Ireland", [], "ie.indeed.com", None, None),
    "us": ("United States", ["usa", "america"], "www.indeed.com", None, None),
    "ca": ("Canada", [], "ca.indeed.com", None, None),
    "au": ("Australia", [], "au.indeed.com", None, None),
    "de": ("Germany", [], "de.indeed.com", None, None),
    "nl": ("Netherlands", ["holland"], "nl.indeed.com", None, None),
    "sg": ("Singapore", [], "sg.indeed.com", None, None),
}
VERIFIED = {"ae"}  # URL patterns tested end to end; elsewhere they follow the same shape but are unchecked

MODES = {"list": "list", "links": "list", "list-only": "list", "links-only": "list", "shortlist": "list",
         "assist": "assist", "fill": "assist", "prefill": "assist", "review": "assist", "semi": "assist", "semi-auto": "assist",
         "manual-submit": "assist",
         "auto": "auto", "autoapply": "auto", "auto-apply": "auto", "submit": "auto", "auto-submit": "auto"}
CV = {"single": "single", "single-cv": "single", "one-cv": "single", "same-cv": "single",
      "specialized": "specialized", "specialised": "specialized", "multi-cv": "specialized", "per-role": "specialized",
      "per-role-cv": "specialized", "tailored": "specialized"}
SECTIONS = ["terms", "tracker", "location", "profile", "roles", "cv", "sites", "mode", "checklist"]
SECTION_ALIAS = {"resume": "profile", "resumes": "profile", "experience": "profile", "cvs": "cv", "platforms": "sites",
                 "city": "location", "country": "location", "apply-mode": "mode", "role": "roles", "targets": "roles",
                 "cap": "mode", "limit": "mode", "daily-cap": "mode", "disclaimer": "terms", "tos": "terms",
                 "csv": "tracker", "tracking": "tracker"}
GROUPS = {"high", "medium", "low", "all"}


def load():
    return json.loads(CONFIG.read_text()) if CONFIG.exists() else {}


def save(cfg):
    HOME.mkdir(parents=True, exist_ok=True)
    cfg["updated"] = datetime.datetime.now().astimezone().replace(microsecond=0).isoformat()
    CONFIG.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")


def country_code(text, codes=True):
    """Country code from a name, alias or (when codes) a two-letter code. Bare words skip codes: 'in' is not India."""
    t = (text or "").strip().lower().replace("-", " ").replace("_", " ")
    for code, (name, aliases, *_) in COUNTRIES.items():
        if t in (name.lower(), *aliases) or (codes and t == code):
            return code
    return None


def available(site, loc):
    """Whether a site covers the location. Unknown countries: LinkedIn, plus Indeed if location.indeed_host is set."""
    code = loc.get("code")
    row = COUNTRIES.get(code)
    if site == "linkedin":
        return True
    if site == "indeed":
        return bool(loc.get("indeed_host") or (row and row[2]))
    return bool(row and row[3 if site == "bayt" else 4])


def missing_sections(cfg):
    miss = [] if cfg.get("terms_accepted") else ["terms"]
    t = cfg.get("tracker_csv")
    if not t or not Path(os.path.expanduser(t)).parent.is_dir():
        miss.append("tracker")
    loc = cfg.get("location") or {}
    if not loc.get("country"):
        miss.append("location")
    if not (PROFILE.exists() and PROFILE.read_text().strip()):
        miss.append("profile")
    roles = cfg.get("roles") or []
    if not roles or not all(r.get("keywords") for r in roles):
        miss.append("roles")
    strat, default = cfg.get("cv_strategy"), cfg.get("default_cv")
    if strat not in ("single", "specialized"):
        miss.append("cv")
    else:
        need = [default] if strat == "single" else [r.get("cv") or default for r in roles]
        if not need or not all(p and Path(os.path.expanduser(p)).exists() for p in need):
            miss.append("cv")
    if not cfg.get("sites"):
        miss.append("sites")
    if cfg.get("mode") not in ("list", "assist", "auto"):
        miss.append("mode")
    if not cfg.get("checklist_shown"):
        miss.append("checklist")
    return miss


def summary(cfg):
    loc = cfg.get("location") or {}
    where = ", ".join(loc.get("cities") or ["anywhere"]) + f" ({loc.get('country', '?')})"
    roles = ", ".join(r.get("tag", "?") for r in cfg.get("roles") or []) or "?"
    return (f"location {where} · sites {', '.join(cfg.get('sites') or ['?'])} · mode {cfg.get('mode', '?')} · "
            f"cv {cfg.get('cv_strategy', '?')} · roles {roles} · daily cap {registry.daily_cap()}/site")


def numbers(text):
    out = []
    for part in filter(None, re.split(r"[,\s]+", text)):
        if part in GROUPS:
            out.append(part)
        elif re.fullmatch(r"\d+-\d+", part):
            a, b = map(int, part.split("-"))
            out += list(range(min(a, b), max(a, b) + 1))
        elif part.isdigit():
            out.append(int(part))
        else:
            return None
    return out


def tokens(argv):
    text = " ".join(argv)
    try:
        toks = shlex.split(text)
    except ValueError:
        toks = text.split()
    # 'city: dubai' and 'apply 1, 3' arrive split; join a dangling key and comma lists back together.
    out = []
    for t in toks:
        if out and (out[-1].endswith(":") or out[-1].endswith(",") or t.startswith(",")):
            out[-1] += t
        else:
            out.append(t)
    # 'linkedin,indeed' -> two words; 'city:a,b' and 'apply 1,3' keep their lists.
    words = []
    for t in out:
        words += [t] if ":" in t or re.fullmatch(r"[\d,\-]+", t) else t.split(",")
    return [t.strip().strip(",") for t in words if t.strip().strip(",")]


def resolve(argv, cfg=None):
    cfg = load() if cfg is None else cfg
    r = dict(first_run=not cfg, missing=missing_sections(cfg), setup=None, show=False, help=False, save=False,
             insights=False,
             apply=None, older=False, hours=None, unknown=[], conflicts=[], notes=[], overrides={})
    inc, exc, modes, cvs, role_q = [], [], [], [], []
    loc = dict(cfg.get("location") or {})
    toks, i = tokens(argv), 0
    while i < len(toks):
        raw = toks[i]
        t = raw.lower()
        key, _, val = t.partition(":") if ":" in t else (t, "", "")
        nxt = toks[i + 1].lower() if i + 1 < len(toks) else ""
        i += 1
        if t in ("setup", "reset", "onboard", "init"):
            secs = []
            while i < len(toks) and SECTION_ALIAS.get(toks[i].lower(), toks[i].lower()) in SECTIONS:
                secs.append(SECTION_ALIAS.get(toks[i].lower(), toks[i].lower()))
                i += 1
            r["setup"] = secs or "all"
        elif t in ("insights", "stats", "report", "progress"):
            r["insights"] = True
        elif t in ("show", "prefs", "preferences", "settings", "config", "status"):
            r["show"] = True
        elif t in ("help", "?", "args", "usage", "--help", "-h"):
            r["help"] = True
        elif t in ("save", "remember", "default", "--save"):
            r["save"] = True
        elif t in ("older", "all-dates", "include-old", "--all"):
            r["older"] = True
        elif key == "apply" or t == "apply":
            spec = val if val else ""
            while not val and i < len(toks) and numbers(toks[i].lower()) is not None:
                spec += "," + toks[i].lower()
                i += 1
            nums = numbers(spec)
            if spec and nums is None:
                r["unknown"].append(raw)
            else:
                r["apply"] = nums or "ask"
        elif t in MODES:
            modes.append(MODES[t])
        elif t in CV:
            cvs.append(CV[t])
        elif t in ("all", "all-sites", "every", "everywhere-online"):
            inc += SITES
        elif registry.ALIAS.get(t, t) in SITES:
            inc.append(registry.ALIAS.get(t, t))
        elif re.fullmatch(r"(-|!|no-|skip-|not-|without-)(\w+)", t) and \
                registry.ALIAS.get(re.sub(r"^(-|!|no-|skip-|not-|without-)", "", t),
                                   re.sub(r"^(-|!|no-|skip-|not-|without-)", "", t)) in SITES:
            s = re.sub(r"^(-|!|no-|skip-|not-|without-)", "", t)
            exc.append(registry.ALIAS.get(s, s))
        elif key in ("city", "cities", "in") and val:
            cities = [c.strip().replace("-", " ").replace("_", " ").title() for c in re.split(r"[,|]", raw.split(":", 1)[1])]
            cities = [c for c in cities if c]
            loc["cities"] = [] if [c.lower() for c in cities] in (["any"], ["all"], ["anywhere"]) else cities
            r["overrides"]["cities"] = loc["cities"]
        elif t in ("anywhere", "any-city", "whole-country", "nationwide"):
            loc["cities"] = []
            r["overrides"]["cities"] = []
        elif (key == "country" and val) or country_code(t, codes=False):
            code = country_code(val if key == "country" else t)
            if not code:
                r["unknown"].append(raw)
                r["notes"].append(f"'{raw.split(':', 1)[1]}' is not a known country: run 'rolexa.py countries'; "
                                  "for another country use 'setup location' (LinkedIn only)")
            elif code != loc.get("code"):
                loc.update(country=COUNTRIES[code][0], code=code)
                loc.pop("indeed_host", None)
                r["overrides"]["country"] = loc["country"]
        elif key in ("role", "roles") and val:
            role_q += [v for v in re.split(r"[,|]", val) if v]
        elif key in ("days", "day", "d") and re.fullmatch(r"\d+(\.\d+)?", val):
            r["hours"] = float(val) * 24
        elif re.fullmatch(r"(\d+(?:\.\d+)?)(d|day|days)", t):
            r["hours"] = float(re.match(r"\d+(?:\.\d+)?", t).group()) * 24
        elif re.fullmatch(r"(\d+)(h|hr|hrs|hour|hours)", t):
            r["hours"] = float(re.match(r"\d+", t).group())
        elif key in ("hours", "h") and val.isdigit():
            r["hours"] = float(val)
        else:
            r["unknown"].append(raw)
            if nxt and t in ("in", "at", "for", "only", "just", "and", "with"):
                r["notes"].append(f"free text '{raw} {toks[i] if i < len(toks) else ''}' isn't an argument: "
                                  "use city:<name>, country:<name>, role:<tag>, a site name or a mode")

    if "country" in r["overrides"] and "cities" not in r["overrides"]:
        loc["cities"] = []
        r["notes"].append(f"country changed to {loc['country']}: searching the whole country (add city:<name> to narrow)")
    # sites
    base = list(dict.fromkeys(inc)) or list(cfg.get("sites") or SITES)
    both = sorted(set(inc) & set(exc))
    if both:
        r["conflicts"].append(f"site both named and excluded: {', '.join(both)}")
    sites = [s for s in base if s not in exc]
    gone = [s for s in sites if loc.get("country") and not available(s, loc)]
    if gone:
        r["notes"].append(f"not available in {loc.get('country', 'this country')}: {', '.join(gone)}")
    sites = [s for s in sites if s not in gone]
    if not sites:
        r["conflicts"].append("no sites left to search")
    if inc or exc:
        r["overrides"]["sites"] = sites
    # mode
    if len(set(modes)) > 1:
        r["conflicts"].append(f"more than one mode: {', '.join(dict.fromkeys(modes))}")
    mode = modes[-1] if modes else cfg.get("mode")
    if modes:
        r["overrides"]["mode"] = mode
    if r["apply"] is not None and mode == "list":
        r["conflicts"].append("'apply' with mode list: pick assist or auto for this apply")
    # cv
    if len(set(cvs)) > 1:
        r["conflicts"].append("both single and specialized CV named")
    cv = cvs[-1] if cvs else cfg.get("cv_strategy")
    if cvs:
        r["overrides"]["cv_strategy"] = cv
    if cv == "single" and not cfg.get("default_cv") and cfg:
        r["conflicts"].append("single CV asked for, but no default_cv is saved: run 'setup cv'")
    # roles
    roles = cfg.get("roles") or []
    if role_q:
        pick = [x for x in roles if any(q == x.get("tag", "").lower() or q in x.get("name", "").lower() for q in role_q)]
        miss = [q for q in role_q if not any(q == x.get("tag", "").lower() or q in x.get("name", "").lower() for x in roles)]
        if miss:
            r["conflicts"].append(f"unknown role(s): {', '.join(miss)}; saved roles: "
                                  f"{', '.join(x.get('tag', '') + '=' + x.get('name', '') for x in roles)}")
        roles = pick
        r["notes"].append("role: applies to this run only; use 'setup roles' to change the saved targets")
    if r["hours"] is not None:
        r["older"] = True
    r.update(sites=sites, mode=mode, cv_strategy=cv, location=loc, roles=[x.get("tag") for x in roles])
    if r["apply"] is not None:
        r["shortlist"] = latest()
        if not r["shortlist"]:
            r["conflicts"].append("'apply' given but there is no shortlist yet: run a search first")
    # save
    one_run = [k for k, on in (("apply", r["apply"] is not None), ("role:", bool(role_q)),
                               ("days/hours", r["hours"] is not None), ("older", r["older"] and r["hours"] is None)) if on]
    if r["save"]:
        if r["conflicts"] or r["unknown"]:
            r["notes"].append("not saved: resolve the conflicts / unknown arguments first")
        elif not r["overrides"]:
            r["notes"].append("'save' given but nothing to save (save keeps sites, mode, city/country and cv strategy)")
        else:
            ov = r["overrides"]
            for k in ("sites", "mode", "cv_strategy"):
                if k in ov:
                    cfg[k] = ov[k]
            if "cities" in ov or "country" in ov:
                cfg["location"] = loc
            save(cfg)
            r["notes"].append(f"saved as default: {', '.join(ov)}")
        if one_run:
            r["notes"].append(f"not saved (this run only): {', '.join(one_run)}")
    return r


def loc_text(loc, city=None):
    return f"{city}, {loc['country']}" if city else loc.get("country", "")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def term(k):
    return f'"{k}"' if re.search(r"[^A-Za-z0-9]", k) else k


def urls(site, roles, loc, w):
    """(tag, url, verified) for every search page of one site."""
    code, row = loc.get("code"), COUNTRIES.get(loc.get("code"))
    cities = loc.get("cities") or [None]
    ok = code in VERIFIED
    out = []
    if site == "linkedin":
        for x in roles:
            q = x.get("linkedin_query") or " OR ".join(term(k) for k in x["keywords"])
            for c in cities:
                out.append((f"LI-{x['tag']}" + (f"@{c}" if c else ""),
                            f"https://www.linkedin.com/jobs/search/?keywords={quote(q)}&location={quote(loc_text(loc, c))}"
                            f"&f_TPR={w['value']}", True))
    elif site == "indeed":
        host = loc.get("indeed_host") or row[2]
        kws = list(dict.fromkeys(k.lower() for x in roles for k in x["keywords"]))
        for n in range(0, len(kws), 9):
            q = "(" + " or ".join(term(k) for k in kws[n:n + 9]) + ")"
            for c in cities:
                out.append((f"IN-{n // 9 + 1}" + (f"@{c}" if c else ""),
                            f"https://{host}/jobs?q={quote_plus(q)}&l={quote_plus(c or loc['country'])}"
                            f"&fromage={w['value']}&sort=date", ok))
    else:
        slugs = list(dict.fromkeys(s for x in roles for s in (x.get("slugs") or [slug(x["keywords"][0])])))
        place = row[3] if site == "bayt" else row[4]
        for s in slugs:
            for c in cities:
                if site == "bayt":
                    path = f"{s}-jobs-in-{slug(c)}" if c else f"{s}-jobs"
                    u = (f"https://www.bayt.com/en/{place}/jobs/{path}/?{w['param']}={w['value']}"
                         "&options%5Bsort%5D%5B%5D=d")
                else:
                    u = f"https://www.naukrigulf.com/{s}-jobs-in-{slug(c) if c else place}?sort=date&freshness={w['value']}"
                out.append((f"{'BY' if site == 'bayt' else 'NG'}-{s}" + (f"@{c}" if c else ""), u, ok and not c))
    return out


def plan(argv):
    cfg = load()
    r = resolve(argv, cfg)
    if r["missing"] or r["conflicts"] or r["unknown"]:
        print(json.dumps({k: r[k] for k in ("missing", "conflicts", "unknown", "notes")}, indent=2))
        sys.exit("plan stopped: finish setup / fix the arguments first")
    roles = [x for x in cfg.get("roles", []) if x.get("tag") in r["roles"]]
    t = registry.now()
    stem = RUNS / f"{t:%Y-%m-%d}_{'am' if t.hour < 12 else 'pm'}"
    print(f"run: {', '.join(r['sites'])} · mode {r['mode']} · {', '.join(r['location'].get('cities') or ['anywhere'])} "
          f"({r['location']['country']}) · cv {r['cv_strategy']} · roles {', '.join(r['roles'])}")
    print(f"files: {stem}.md (shortlist) and {stem}.tsv (machine list)")
    print(f"filter: registry.py filter CARDS.tsv{' --all' if r['older'] else ''}")
    for n in r["notes"]:
        print(f"note: {n}")
    for site, (lr, gap, w) in registry.since(r["sites"]).items():
        stamp = "yes"
        if r["hours"] is not None:
            want = datetime.timedelta(hours=r["hours"])
            w = registry.window(site, want - registry.BUFFER)
            if lr and gap > want:
                stamp = "no (the days:/hours: window doesn't reach back to the last run)"
        when = f"last run {lr:%a %d %b %H:%M} ({registry.fmt(gap)} ago)" if lr else "first run"
        warn = f" ! wider than the site's longest filter ({w['wide']}): older postings not covered" if w["wide"] else ""
        print(f"\n{site} · {when} · window {w['param'].split('%5b')[0]}={w['value']} ({w['label']}) · stamp {stamp}{warn}")
        for tag, u, ok in urls(site, roles, r["location"], w):
            print(f"  {tag}\t{u}" + ("" if ok else "\t[unverified pattern: if it 404s, redirects or is empty, see SITES.md]"))


def latest():
    files = sorted(glob.glob(str(RUNS / "*.tsv")))
    return files[-1] if files else None


def show():
    cfg = load()
    if not cfg:
        print("no preferences yet (first run)")
        return
    print(summary(cfg))
    print(f"\ndata home: {HOME}\nprofile:   {PROFILE}{'' if PROFILE.exists() else ' (missing)'}")
    print(f"default CV: {cfg.get('default_cv', '-')}")
    for x in cfg.get("roles") or []:
        print(f"  {x.get('tag')}: {x.get('name')} · {', '.join(x.get('keywords', []))} · cv {x.get('cv') or '(default)'}")
    for k in ("title_skip", "level_skip", "level_keep"):
        print(f"{k}: {', '.join(cfg.get(k) or []) or '-'}")
    seen, apps = len(registry.load()), len(registry.read_apps()[0])
    print(f"\ntracker: {registry.tracker()} ({apps} rows)")
    print(f"seen jobs: {seen} · latest shortlist: {latest() or '-'}")
    miss = missing_sections(cfg)
    if miss:
        print(f"incomplete: {', '.join(miss)}")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "status":
        cfg = load()
        miss = missing_sections(cfg)
        print("first-run" if not cfg else (f"incomplete: {', '.join(miss)}" if miss else "ready"))
        if cfg:
            print(summary(cfg))
    elif cmd == "show":
        show()
    elif cmd == "set":
        if len(args) < 2:
            sys.exit("usage: set KEY VALUE")
        cfg, path, raw = load(), args[0].split("."), " ".join(args[1:])
        try:
            val = json.loads(raw)
        except json.JSONDecodeError:
            val = raw
        node = cfg
        for p in path[:-1]:
            node = node.setdefault(p, {})
        if args[0] == "tracker_csv" and isinstance(val, str):
            val = str(Path(os.path.expanduser(val)).resolve())  # relative = the folder the agent runs in
        node[path[-1]] = val
        loc = cfg.get("location")
        if path[0] == "location" and isinstance(loc, dict) and loc.get("country"):
            code = country_code(loc["country"])
            if code:  # 'uae' -> 'United Arab Emirates', so LinkedIn gets a location it knows
                loc.update(code=code, country=COUNTRIES[code][0])
            else:
                loc.setdefault("code", None)
                print(f"note: '{loc['country']}' is not in the country list: LinkedIn only "
                      "(set location.indeed_host for Indeed)")
        cfg.setdefault("created", datetime.date.today().isoformat())
        save(cfg)
        print(f"set {args[0]} = {json.dumps(val, ensure_ascii=False)}")
    elif cmd == "resolve":
        print(json.dumps(resolve(args), indent=2, ensure_ascii=False))
    elif cmd == "plan":
        plan(args)
    elif cmd == "countries":
        print("code\tcountry\tsites")
        for code, (name, *_rest) in COUNTRIES.items():
            loc = {"code": code, "country": name}
            have = [s for s in SITES if available(s, loc)]
            print(f"{code}\t{name}\t{', '.join(have)}" + ("" if code in VERIFIED else "\t(non-LinkedIn URLs unverified)"))
        print("other countries: LinkedIn only (set location.indeed_host to add Indeed)")
    elif cmd == "latest":
        print(latest() or "none")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
