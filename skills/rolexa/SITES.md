# Rolexa: searching and fit

All four sites are searched **logged out**. `rolexa.py plan` builds every URL; this file explains them and what to do when one misbehaves. `collect_cards.js` and `extract_jd.js` detect the site themselves.

Job IDs: LinkedIn is a bare number; the others are `indeed:<jk>`, `bayt:<id>`, `ng:<jid>`. The same company + title on two sites is checked once (`dup-of:<id>`).

## Date window: since each site's last run

`last_run.tsv` holds one row per site. `plan` turns the time since the last run (+2 h buffer) into each site's filter:

| Site | Filter | Values |
|---|---|---|
| LinkedIn | `f_TPR=r<seconds>` | any number of seconds, capped at 30 days |
| Indeed | `fromage=` | 1 / 3 / 7 / 14 days: the smallest that covers the gap |
| Bayt | `jb_last_modification_date_interval` | `3` = 24 h, `2` = 7 days, `1` = 30 days |
| Naukri Gulf | `freshness=` | 7 / 15 / 30 days (7 is the shortest) |

- A site's first run looks back 3 days (LinkedIn, Indeed) or 7 days (Bayt, Naukri Gulf).
- The coarse filters return older cards; `registry.py filter` drops cards whose posted text ("3 hours ago", "25 Sep") is before the last run, with 12 h slack. Unreadable dates are kept.
- If the gap is longer than a site's widest filter, `plan` warns: older postings can't be reached logged out.

## LinkedIn

- URL: `/jobs/search/?keywords=<role keywords ORed>&location=<City, Country>&f_TPR=r<seconds>`. The logged-out search accepts Boolean (`OR`, quotes, `AND`, parentheses).
- It **ignores the work-type filter**: read Remote / Hybrid / On-site from the description.
- Lists longer than about 60 cards: scrolling stops loading and `&start=` is ignored. Load the see-more endpoint one page at a time, at the same pace: `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=<q>&location=<loc>&f_TPR=r<seconds>&start=60` (then 70, 80, … up to the count in the page header). `collect_cards.js` reads those bare cards directly.

## Indeed

- URL: `https://<country>.indeed.com/jobs?q=(a or "b c" or d)&l=<city or country>&fromage=<days>&sort=date`. Inside parentheses Indeed accepts lowercase `or`. `plan` batches all role keywords into queries of 9 terms.
- **Page 1 only.** Logged out, "Next page" leads to a sign-in wall. For more coverage use narrower roles (`role:`), never paging.
- Logged-out cards often show no posted date, so the last-run cutoff can't act on Indeed; the registry still stops repeats.
- Job page: `/viewjob?jk=<jk>`. `applyType` is `Indeed Apply` (applies on Indeed) or `Apply on company site`. Descriptions often list the application questions (e.g. current salary): note them on the shortlist.
- Cards with patterned keys (`0123456789abcdef` and similar) are decoys; `collect_cards.js` drops them. Never open one.

## Bayt

- URL: `https://www.bayt.com/en/<country>/jobs/<slug>-jobs/?<date filter>&options%5Bsort%5D%5B%5D=d` (sorted newest first). With a city: `<slug>-jobs-in-<city>/`.
- One keyword per slug, no Boolean. Page 1 (30 cards, newest first) usually reaches past the window; page on only if the last card is still inside it.
- Apply button: "Apply" (on Bayt, needs the user's Bayt login) or "Apply on company site".

## Naukri Gulf

- URL: `https://www.naukrigulf.com/<slug>-jobs-in-<city or country>?sort=date&freshness=<days>`.
- One keyword per slug. Avoid vague slugs like `ai-engineer`: it matched electrical and substation jobs.
- Cards show `Easy Apply`, the posted time and the experience band ("5 - 10 Years"); a band starting far above the user's years is Weak.
- `workType` comes from the page title (On-site / Remote / Hybrid).

## Unverified URLs

The URL patterns were tested end to end for the UAE at country level. `plan` marks the rest `[unverified pattern]` (other countries' Indeed/Bayt/Naukri Gulf, and city pages on Bayt/Naukri Gulf). On the first such URL per site:

1. Load it and check: right site, right country, the results look like job cards, `collect_cards.js` returns rows.
2. If it 404s, redirects to a home page, or returns no cards while the site clearly has jobs: try the **country-level** URL for that site (drop `-in-<city>`) and judge the city from each card's location.
3. If that fails too, skip the site for this run and tell the user which URL failed. Don't guess other URL shapes.

## No built-in browser

The Claude desktop app's built-in browser keeps searching away from the user's signed-in accounts. Without it (e.g. the terminal CLI), ask before searching with Claude in Chrome, because that browser is signed in:
- LinkedIn: use only the jobs-guest see-more endpoint above, starting at `&start=0`. It returns guest cards even when signed in.
- Indeed, Bayt, Naukri Gulf: the signed-in pages may differ. If `collect_cards.js` returns nothing, stop that site and say so.
- Keep the same pace, or slower. This path is less tested.

## Blocked page rule

Stop a site at the first sign of a block: CAPTCHA, Cloudflare, "verify you are human" (`extract_jd.js` returns `blocked: true`), HTTP 429, a sign-in wall, or empty pages repeating. Don't click, wait it out, or work around it. Skip the rest of that site this run, don't stamp it, and tell the user.

## Fit

Judge against the description's **must-haves**, not its title, using only `profile.md` and the resumes.

| Fit | Meaning |
|---|---|
| **Strong** | Every must-have is backed by the profile; gaps are nice-to-haves only. |
| **Good** | One real but non-core gap. |
| **Medium** | A must-have is missing, but the core work matches. |
| **Weak** | The core stack or domain is missing. Typical signals: a main language or framework the profile lacks; required years well above theirs (about 3+ more); a required language, licence, clearance or citizenship they lack; a location or on-site rule they ruled out. |
| **Underlevel** | Clearly junior for their experience, or a posted salary below their floor in `profile.md`. |

- Name the main gap in a few words ("needs Kubernetes", "8+ yrs", "Arabic required").
- Never count a **Do NOT claim** item as a match.
- When a highlight in `profile.md` fits the role, mention it in the note; it helps the user decide.

## CV

- `cv_strategy: single` → `default_cv` for every job.
- `cv_strategy: specialized` → the CV of the role family that best matches the **description** (not just the title); a job that fits no family gets `default_cv`. If two families fit equally, say so on the shortlist and use the one closer to the must-haves.
- Write the CV's file name on the shortlist, so the user sees what each job will get before approving.
