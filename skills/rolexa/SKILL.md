---
name: rolexa
description: Job hunting agent for LinkedIn, Indeed, Bayt and Naukri Gulf. On first run it interviews the user (country and city, all their resumes, one CV or a CV per role, platforms, apply mode) and saves the answers. Each run searches the chosen sites logged out for jobs posted since the last run, fit-checks every description against the user's own resumes, and shows a High / Medium / Low shortlist. Then, only for jobs the user picks in the session, it fills applications in their logged-in Chrome and either waits for them to click Submit or submits itself, asking whenever it is unsure. Arguments override saved preferences for one run (sites, list / assist / auto, city:, country:, role:, days:, apply 1,3, save, setup). Use when the user runs /rolexa or asks to find, shortlist or apply to jobs on these sites.
argument-hint: "[linkedin|indeed|bayt|naukrigulf] [list|assist|auto] [city:X] [country:X] [role:X] [3d] [older] [apply 1,3] [save] [setup [section]] [prefs] [help]"
---

# Rolexa

Finds jobs, checks fit against the user's own resumes, and applies only where the user says so.

- **Phase A (find):** search logged out, fit-check, write a shortlist, show it, ask which to apply to.
- **Phase B (apply):** only for jobs the user names **in this session** ("apply 1, 3"). A file, a saved preference or an earlier session's answer is not approval. In `list` mode, or with no answer, stop after Phase A.

`$R` = this skill's folder. `$SCRATCH` = this session's scratchpad (or a temp folder). User data lives in `$ROLEXA_HOME` (default `~/.rolexa`): `config.json` (preferences), `profile.md` (facts, answers, the **Do NOT claim** list), `seen_jobs.tsv`, `last_run.tsv`, `applications.tsv`, `runs/`.

## Start (every run)

1. `python3 $R/scripts/rolexa.py status`.
   - `first-run` or `incomplete: ...` → follow [SETUP.md](SETUP.md) for the missing sections only. Arguments given on a first run pre-fill the matching setup questions: confirm them instead of asking again.
   - `ready` → go on.
2. `python3 $R/scripts/rolexa.py resolve <the user's arguments, verbatim>` → JSON for this run.
   - `help` → print the cheat sheet below and stop. `show` → run `rolexa.py show`, print it, stop.
   - `setup` → SETUP.md for those sections (`"all"` = the whole interview), then ask whether to search now.
   - `unknown` or `conflicts` not empty → **ask, don't guess.** Quote the token and offer the likely fix (e.g. "Did you mean `city:dubai`?").
   - `notes` → pass each one on in a line (e.g. a site not available in that country, what was saved).
   - `apply` set → skip Phase A; go to Phase B with the jobs from `shortlist` (the latest run file).
3. Read `$ROLEXA_HOME/profile.md` and [SITES.md](SITES.md). For Phase B also read [APPLY.md](APPLY.md).

## Arguments

Order and case don't matter. Everything is **this run only** unless `save` is added.

| Kind | Arguments | Effect |
|---|---|---|
| Sites | `linkedin` `indeed` `bayt` `naukrigulf` (aliases `li`, `naukri`, `ng`), `all` | Search only the named sites |
| | `-bayt`, `no-indeed`, `skip-linkedin` | Saved sites minus that one |
| Mode | `list` (aliases `links`, `shortlist`) | Shortlist with links only; the user applies |
| | `assist` (`fill`, `review`) | Rolexa fills each form, the **user clicks Submit** |
| | `auto` (`auto-apply`, `submit`) | Rolexa submits each approved job itself |
| Where | `city:dubai`, `city:abu-dhabi,sharjah`, `city:any` | Cities in the saved country; `any` = whole country |
| | `country:qatar` or a bare country (`qatar`, `ksa`, `uk`) | Different country; cities reset unless `city:` is given |
| What | `role:fe`, `role:fe,ai` | Only those saved role families (by tag or name) |
| | `single-cv`, `specialized` | One CV for everything, or the per-role CVs |
| When | `3d`, `48h`, `days:7` | Fixed window instead of "since last run" |
| | `older` | Keep cards posted before the last run |
| Apply | `apply 1,3`, `apply 2-5`, `apply high`, `apply` | Phase B on the latest shortlist (bare `apply` asks which) |
| Control | `save` | Keep sites / mode / location / CV strategy as the new defaults |
| | `setup`, `setup cv`, `setup sites mode` | Redo the whole interview or named sections: `terms location profile roles cv sites mode checklist` (`cap` = the daily limit, asked with mode) |
| | `prefs`, `help` | Show saved preferences / this table |

How combinations resolve (the script enforces these; the examples are for explaining them):
- Kinds combine freely: `/rolexa linkedin list city:abu-dhabi 3d` = LinkedIn only, links only, Abu Dhabi, last 3 days.
- Several sites add up (`linkedin indeed`); exclusions subtract from the saved set (`-bayt`). Naming and excluding the same site is a conflict.
- Two modes, `single-cv` with `specialized`, or `list` with `apply` → conflict: ask which.
- A site the country doesn't cover is dropped with a note (`/rolexa germany bayt` leaves nothing → ask).
- `save` stores only sites, mode, location and CV strategy. `role:`, windows, `older` and `apply` are always one-run; say so when they come with `save`.
- `3d` / `48h` imply `older`. If the window is shorter than the time since the last run, `plan` says **stamp no**: don't stamp that site, so the gap is searched next time.
- `setup` together with run arguments: do the setup first, then run with the other arguments.
- Free text (`jobs in dubai`) is not an argument: the script flags it; suggest the argument form.

## Phase A: find (logged out)

1. **Browser:** use the built-in browser (`mcp__Claude_Browser__*`) when it exists. Never sign in there; close sign-in popups; never click "Continue with Google" or register. If only Claude in Chrome is available, follow SITES.md "No built-in browser".
2. `python3 $R/scripts/rolexa.py plan <arguments>`. It prints every search URL per site with its date window, marks this run's start, and names the run files (`runs/<date>_<am|pm>.md` and `.tsv`).
3. Site by site in the order printed, **one page at a time**: wait 4–6 s after each load, scroll slowly (3–4 scrolls ~4 s apart), page on only where SITES.md says, wait 6–10 s before the next URL. On a URL marked `[unverified pattern]`, follow SITES.md "Unverified URLs".
4. On each results page run `scripts/collect_cards.js` with `javascript_tool`; append the TSV to `$SCRATCH/cards.tsv`.
5. `python3 $R/scripts/registry.py filter $SCRATCH/cards.tsv > $SCRATCH/todo.tsv` (add `--all` when `plan` printed it). It drops seen IDs, cards posted before the site's last run, the same company + title from another site, and titles matching the user's skip lists.
6. For each row in `todo.tsv`: open the `url` (wait 5 s, 8–10 s between jobs), run `scripts/extract_jd.js`, judge fit by SITES.md §Fit, list the gaps, pick the CV (SITES.md §CV), note the work type only if the page states it, and the apply type (Easy Apply / Indeed Apply / Bayt / Naukri Easy Apply / company site).
7. Write `id\tcompany\ttitle\tverdict\tnote` lines to `$SCRATCH/verdicts.tsv`, then `registry.py record $SCRATCH/verdicts.tsv`.
8. Write both run files:
   - `.md`: header with each site's window ("since Mon 05 Oct 09:00, 30h"), then one numbered sequence across **High** (Strong + Good), **Medium**, **Low** (Weak + Underlevel). Columns: #, role, company, site, fit, main gap, CV, apply type, link.
   - `.tsv`: `num, id, site, company, title, group, fit, cv, apply_type, url`. Phase B reads this.
9. **Blocked page rule:** on a CAPTCHA, Cloudflare or "verify you are human" page (`extract_jd.js` returns `blocked: true`), HTTP 429, a sign-in wall, or empty pages repeating: stop that site at once. Don't click, wait it out or work around it. Carry on with the other sites and report it.
10. `python3 $R/scripts/registry.py stamp <sites>` for each site that finished without a block and whose plan line says `stamp yes`, after the files are written. Never stamp a blocked or unfinished site.
11. In chat: one line with each site's window, then **every job whose description was opened**, numbered in one sequence and grouped High / Medium / Low, one line each (role · company · fit · main gap · CV). Add one line counting card-only skips, and link the `.md` file.
    - `list` mode: stop here. Mention that `/rolexa apply 2,5` (with `assist` or `auto`) works later from this list.
    - `assist` / `auto`: ask which to apply to ("apply 1, 3" or "apply high"). Say which CV each will get and whether Rolexa or the user will click Submit. Wait.

## Phase B: apply (the user's Chrome, logged in)

Follow [APPLY.md](APPLY.md). In short, one job at a time:
- before **each** job run `registry.py check <site>`; exit 1 = that site has hit its daily cap (default 8), so skip its remaining jobs today,
- open the job in Chrome; skip it if already applied,
- stop and hand it to the user at a sign-in, register or new-account page, a CAPTCHA, or a password field,
- attach the CV from SITES.md §CV,
- answer only from `profile.md`; **when unsure, ask; don't assume** (APPLY.md "Ask, don't assume"),
- `assist`: stop on the final review page and ask the user to click Submit, then confirm it went through. `auto`: check the review page and submit,
- log it with `registry.py log`; 2–4 s between form steps, 15–25 s between jobs.

## Never

- Sign in, create an account, type a password, or solve a CAPTCHA: hand those to the user.
- Apply to a job the user didn't name in this session, or go past the daily cap.
- Claim anything not backed by a resume or `profile.md`; the **Do NOT claim** list is binding.
- Tick consent, terms or declaration boxes without asking.
- Search while signed in to the user's accounts when a logged-out browser is available.

## Report (end of run)

Short: per site, applied / submitted by the user / already applied / handed back / stopped (why); the answers given on each application; blocked sites; new answers saved to `profile.md`; anything in the postings that contradicts `profile.md`. If arguments were one-run overrides, end with one line: "add `save` to keep these as defaults."
