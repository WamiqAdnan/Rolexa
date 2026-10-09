# Rolexa skill (`/rolexa`)

A [Claude Code](https://claude.com/claude-code) skill, shipped alongside the Rolexa app in this repo, that hunts jobs on **LinkedIn, Indeed, Bayt and Naukri Gulf**, checks each posting against your own resumes, and applies only to the jobs you pick.

```
/rolexa
```

## What it does

1. **Finds** jobs posted since your last run, on the sites you chose, for your country and city. It searches logged out, in Claude's built-in browser, slowly, one page at a time.
2. **Checks fit** by reading every new job description against your resumes and profile: Strong, Good, Medium, Weak or Underlevel, with the main gap and the CV it would send.
3. **Shows a shortlist** grouped High / Medium / Low, numbered, with links. Nothing it has already shown you comes back.
4. **Applies** only to the jobs you name ("apply 1, 3"), in your own signed-in Chrome, in the mode you chose:
   - `list`: you get the links and apply yourself,
   - `assist` (recommended): Rolexa fills the form and attaches the right CV, **you click Submit**,
   - `auto`: Rolexa submits the jobs you picked.

   In every mode it stops and **asks you** whenever a form needs something it doesn't know, rather than guessing.

## First run

The first `/rolexa` asks you, once:

0. to confirm the [disclaimer](#disclaimer) (job sites restrict automated use),
1. the **country and city** (or cities) to search,
2. **all your resumes so far** (a folder or files). It reads them to learn your experience quickly and builds a profile you can correct,
3. **one CV for everything, or a specialized CV per role family** (frontend, backend, AI, ...). It can draft missing variants from your existing CV for your approval,
4. which **platforms**: LinkedIn, Indeed, Bayt, Naukri Gulf (only those that cover your country),
5. the **mode**: `list`, `assist` or `auto`,
6. then shows you exactly **what you need to set up yourself, and from which point Rolexa takes over**.

Your answers are saved. After that, just run `/rolexa`.

## Arguments

Arguments change one run. Add `save` to make them your new defaults.

| Example | Meaning |
|---|---|
| `/rolexa` | Saved preferences, everything since the last run |
| `/rolexa linkedin` | LinkedIn only |
| `/rolexa linkedin indeed` | Those two only |
| `/rolexa -bayt` | Saved sites except Bayt |
| `/rolexa list` | Links only: you apply yourself |
| `/rolexa assist` | Fill the forms; you click Submit (recommended) |
| `/rolexa auto` | Submit the jobs you pick |
| `/rolexa city:abu-dhabi` | Another city (in your saved country) |
| `/rolexa city:dubai,sharjah` | Several cities |
| `/rolexa city:any` | The whole country |
| `/rolexa qatar` or `country:qatar` | Another country |
| `/rolexa role:fe` | Only one of your role families |
| `/rolexa single-cv` | One CV for every job this run |
| `/rolexa 3d` / `48h` | A fixed window instead of "since last run" |
| `/rolexa older` | Include cards from before the last run |
| `/rolexa apply 2,5` | Apply to jobs 2 and 5 from the latest shortlist |
| `/rolexa apply high` | Apply to every High job from the latest shortlist |
| `/rolexa indeed list city:sharjah save` | Combine anything; `save` keeps sites, mode and city |
| `/rolexa setup cap` | Change the daily limit per site (default 8) |
| `/rolexa setup` | Redo the whole setup |
| `/rolexa setup cv sites` | Redo only those parts (`location profile roles cv sites mode checklist`) |
| `/rolexa prefs` | Show your saved preferences |
| `/rolexa help` | Show all arguments |

Rules for combining them:
- Order and case don't matter.
- Conflicts (two modes, `list` with `apply`, a site named and excluded) make Rolexa ask instead of guessing.
- A site that doesn't cover the chosen country is skipped with a note.
- `save` stores sites, mode, location and CV strategy only. Role filters, time windows and `apply` are always one-run.

## Daily limit

Rolexa applies to at most **8 jobs per site per day** (LinkedIn, Indeed, Bayt and Naukri Gulf each get 8). Before every application it checks today's count in your log, and once a site reaches its limit, that site's remaining jobs wait for tomorrow. Submissions without a confirmation page count too. Applications you make yourself outside Rolexa don't.

Setup asks whether you want a lower limit; `/rolexa setup cap` changes it later. There's no argument to raise it for one run.

## What you set up yourself

| For | You do | Rolexa does |
|---|---|---|
| Searching | Python 3.9+ and the Claude desktop app (its built-in browser searches logged out) | Reads job pages, fit-checks, writes the shortlist |
| Applying (`assist`, `auto`) | Install **Claude in Chrome** and connect it to your Claude account | Works in its own tab group in your Chrome |
| Each site | **Sign in yourself** in that Chrome | Never signs in, never types passwords, never creates accounts |
| Indeed, Bayt, Naukri Gulf | Complete your profile there and upload a CV | Swaps the profile CV to the right one before each application |
| While applying | Keep Chrome visible and stay nearby for questions | Asks in chat whenever it is unsure |

Rolexa hands the job back to you at any sign-in or register page, a company site that needs a new account, a CAPTCHA, a password field, or a payment.

## Install

```bash
git clone https://github.com/WamiqAdnan/Rolexa.git
```

```bash
mkdir -p ~/.claude/skills && cp -r Rolexa/skills/rolexa ~/.claude/skills/rolexa
```

The skill doesn't need the app: it runs on its own with Python 3.9+ and no packages.

Restart Claude Code and run `/rolexa`.

## Your data

Everything stays on your machine in `~/.rolexa/` (set `ROLEXA_HOME` to move it):

| File | Holds |
|---|---|
| `config.json` | Preferences: location, sites, mode, role families, CV paths, title skip lists, daily cap |
| `profile.md` | Your facts, built from your resumes: answers for forms and a **Do NOT claim** list |
| `seen_jobs.tsv` | Every job already checked, so it isn't shown twice |
| `last_run.tsv` | When each site was last searched |
| `applications.tsv` | Your application log (import it into any spreadsheet) |
| `runs/` | Each run's shortlist (`.md` to read, `.tsv` for applying later) |

Rolexa only claims what your resumes and profile support. Anything in the Do NOT claim list is never used.

## Limits and honesty

- **Tested end to end for the UAE** at country level, on all four sites. Other countries and city-level Bayt / Naukri Gulf pages use the same URL shapes but are unverified; Rolexa checks the first page and falls back to the country page, or skips the site and tells you.
- Bayt covers the Middle East and North Africa; Naukri Gulf covers the six GCC countries. naukri.com (India) is not supported.
- Logged-out Indeed shows page 1 only, and logged-out LinkedIn ignores the remote / hybrid filter (Rolexa reads the work type from the description).
- Job sites change their pages. If a script stops returning cards, the selectors in `scripts/collect_cards.js` and `scripts/extract_jd.js` need updating.

## Disclaimer

**Read this before using Rolexa. Setup asks you to confirm it.**

- Rolexa is an independent project. It is not affiliated with, endorsed by or connected to LinkedIn, Indeed, Bayt or Naukri Gulf. Their names are trademarks of their owners.
- **Job sites restrict automated use.** LinkedIn's User Agreement, for example, forbids using bots, scrapers or other automated means to access its service, and other sites have similar terms. Searching and applying with Rolexa may break those terms, and a site can restrict or close your account.
- Rolexa keeps that risk down but can't make automated use permitted. It searches logged out, away from your accounts. It moves at a slow, human pace, caps applications per site per day, and stops at the first CAPTCHA or warning. It never signs in for you, and in `assist` mode (recommended) you click Submit yourself.
- **You decide whether to use it, and you are responsible for following each site's terms** and for every application sent in your name. Check what Rolexa fills in before it goes out.
- Rolexa is provided as is, without warranty of any kind (see [LICENSE](../../LICENSE)).

## License

MIT. See [LICENSE](../../LICENSE).

## Layout

```
skills/rolexa/
  README.md       this file
  SKILL.md        every run: start, arguments, find, apply, report
  SETUP.md        the first-run interview
  SITES.md        per-site search rules, fit levels, CV choice
  APPLY.md        applying: modes, ask-don't-assume, per-site steps
  scripts/
    rolexa.py         preferences, argument parsing, search plan (URLs)
    registry.py       seen jobs, last runs, title filter, application log
    resume_text.py    reads .docx / .pdf / .txt resumes
    collect_cards.js  reads job cards from a results page
    extract_jd.js     reads a job description page
    capture_file_input.js  attaches a CV without the OS file picker
```
