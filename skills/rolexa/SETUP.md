# Rolexa setup (first run, or `setup <section>`)

Run only the sections `status` / `resolve` listed. Ask one section at a time, and use `AskUserQuestion` for the choice questions when it is available. Save each section as soon as it is answered (`rolexa.py set ...`), so a setup cut short resumes where it stopped. Arguments given with the first run (e.g. `/rolexa linkedin list city:dubai`) pre-fill answers: show them and ask to confirm.

Open with two lines: what Rolexa does (finds jobs since the last run, fit-checks them against your resumes, applies only to jobs you pick), and that setup takes about five minutes and is asked once.

## 0. terms (before anything else)

Show this, then wait for a clear yes ("I understand", "yes", "ok"):

> Before we start:
> - Rolexa isn't affiliated with LinkedIn, Indeed, Bayt or Naukri Gulf.
> - These sites restrict automated use (LinkedIn's User Agreement forbids bots and scrapers, for example). Searching and applying with Rolexa may break their terms, and a site can restrict your account. Rolexa keeps the risk down (logged-out search, slow pace, a daily limit, stops at any CAPTCHA, never signs in) but can't remove it.
> - You're responsible for following each site's terms and for every application sent in your name. The full disclaimer is in the README.
>
> Reply "I understand" to continue.

- A yes: `rolexa.py set terms_accepted "<today, YYYY-MM-DD>"`, then go on.
- A no, or a question you can't settle: stop setup. Rolexa doesn't search or apply without it. Answer questions plainly; don't play the risk down.
- An argument on the first run doesn't count as a yes; ask anyway.

## 1. tracker (application CSV)

Ask: **"Do you want me to keep a CSV of every job you apply to, so you can see quick insights (replies per site, which CV gets interviews, what's waiting on a follow-up)?"** Offer to keep it in the folder you're running from (their repo), as `rolexa-applications.csv`, or at a path they name.

- **Yes:** `rolexa.py set tracker_csv rolexa-applications.csv` (a relative path is taken from the current folder and saved as an absolute one), or their path.
  - If the file already exists and isn't a Rolexa tracker, `registry.py` refuses to touch it: ask for another name.
  - If the folder is a git repository, ask whether the CSV should be committed (fine for a private repo) or kept out of git (for a public one; it lists the companies they applied to). Out of git: add the file name to that repo's `.gitignore`.
  - Mention it opens in Excel, Numbers or Google Sheets, and that they can add their own columns: Rolexa keeps them.
- **No:** `rolexa.py set tracker_csv ~/.rolexa/applications.csv` (or the same file under `$ROLEXA_HOME` if that is set). Say that Rolexa still keeps this private copy, because the daily limit is counted from it, and that `/rolexa insights` works on it too.
- `setup tracker` comes back here later. If they move the tracker, move the old file to the new path rather than starting an empty one.

## 2. location

Ask: **which country, and which city or cities?** ("anywhere in the country" is fine.)

- Run `rolexa.py countries` to see which sites cover that country. A country not on the list gets LinkedIn only, unless the user knows their Indeed country site (then `location.indeed_host`).
- Save: `rolexa.py set location '{"country":"United Arab Emirates","cities":["Dubai"]}'` (the code is filled in automatically; `"cities": []` = whole country).
- Ask whether remote roles based elsewhere are of interest. If yes, note it in `profile.md`; fit checks then don't mark remote roles down for location.

## 3. profile (all resumes)

Ask: **"Point me to every resume you've made so far: a folder or the files (.docx, .pdf, .txt). Older versions help too: they often hold roles, numbers and skills the latest one dropped."**

1. `python3 $R/scripts/resume_text.py <paths>` prints them newest first and marks duplicates. PDFs it can't read: open them with the Read tool.
2. Build `$ROLEXA_HOME/profile.md` from the template below. Rules:
   - The newest resume wins on dates and titles. Where resumes disagree, list the conflict and ask.
   - Copy metrics exactly as written. Don't round, merge or invent.
   - A skill's start date is the start of the first role that shows it.
3. Show a short summary (years of experience, main stack, last three roles, the conflicts) and ask for corrections.
4. Ask what resumes can't answer, in one message:
   - contact details exactly as they should appear on forms (email, phone with country code),
   - right to work in the chosen country, visa type, and whether sponsorship is needed,
   - notice period / earliest start,
   - expected salary (range, currency, per month or year); current salary only if they want it given on forms (otherwise forms that ask will be paused and asked about),
   - languages and level,
   - the lowest salary worth applying for (sets "Underlevel"),
   - **anything they don't want claimed**, even if a resume mentions it (old skills, side projects, client names).
5. Save `profile.md`.

### profile.md template

```markdown
# Profile
Built from: <files> on <date>. Newest resume wins. Rolexa answers forms only from this file.

## Contact (as entered on forms)
## Summary (one line: years, level, main stack)
## Roles (title · company · location · start–end)
## Skills with start dates  <!-- "years of X" = whole years since the date, rounded down -->
## Highlights to cite (exact wording and numbers from the resumes)
## Work authorization (country, visa, sponsorship needed?)
## Notice period / start date
## Salary (expected range; current if they chose to share; floor for Underlevel)
## Languages
## Location preferences (cities, remote, relocation)
## Do NOT claim
## Learned answers  <!-- added during applications: question · answer · date -->
```

## 4. roles (what to search for)

From the profile, propose 3–8 **role families** with search keywords. Show them as a table and ask the user to add, drop or rename:

| tag | name | keywords (LinkedIn / Indeed) | slugs (Bayt / Naukri Gulf) |
|---|---|---|---|
| FE | Frontend | Frontend, Front-End, React, Next.js | frontend-developer, react-developer |
| BE | Backend | Backend, Back-End, Node.js | backend-developer |

- Keywords: job-title words or core stack words that appear in titles. Plain words, no Boolean. LinkedIn ORs them per role; Indeed batches all of them. A role that needs Boolean logic can carry its own `linkedin_query`.
- Slugs: one lowercase hyphenated job title each, as it would appear in a Bayt or Naukri Gulf URL (`software-engineer`, `python-developer`).
- Propose title skip lists from what the profile **lacks**, and confirm:
  - `title_skip`: other stacks or fields, always skipped (`java`, `.net`, `c#`, `data scien*`, `qa`, `devops`, `sales`). Whole words; a trailing `*` matches word starts. `java` does not catch "JavaScript".
  - `level_skip`: levels that don't fit (`manager`, `director`, `head of`, `intern`, `internship`, `junior`), skipped **unless** the title also matches `level_keep` (`engineer`, `developer`), since some employers use "Manager" as a grade for hands-on roles.
- Save: `rolexa.py set roles '[{"tag":"FE","name":"Frontend","keywords":[...],"slugs":[...]}]'`, then `set title_skip '[...]'`, `set level_skip '[...]'`, `set level_keep '[...]'`.

## 5. cv (one CV or one per role)

Ask: **"Do you want a specialized CV for each role family, or one CV for everything?"**

- **Single:** ask which file. `set cv_strategy single`, `set default_cv "/abs/path.docx"`.
- **Specialized:** map each role tag to a file from the resumes they gave. Also pick a `default_cv` for jobs that fit no family. Save each with `set roles` (add `"cv": "/abs/path"` per role), `set cv_strategy specialized`, `set default_cv ...`.
  - A family with no matching CV: offer to draft one. Copy their closest CV and change **only** the headline, the summary and the order of skills to suit the family, using facts already in `profile.md`. Edit the text in place and keep the formatting (use a docx skill if one is installed). Show each draft; it is used only after the user approves it. Never add a skill, metric or claim.
- Paths must be absolute and the files must exist (`status` checks). Prefer .pdf or .docx: both upload everywhere.

## 6. sites

Ask (multi-select) which platforms to use: **LinkedIn, Indeed, Bayt, Naukri Gulf**. Offer only the ones `rolexa.py countries` lists for their country, and say why any are missing (Bayt covers the Middle East and North Africa, Naukri Gulf covers only the six GCC countries; naukri.com for India is not supported). Save: `set sites '["linkedin","indeed"]'`.

## 7. mode

Ask: **"When you approve jobs from the shortlist, what should I do?"**

| Mode | What happens |
|---|---|
| `list` | I only give you the filtered list with links. You apply yourself. |
| `assist` (recommended) | I fill each application and attach the right CV, then stop on the final page. **You click Submit**, tell me, and I move on. |
| `auto` | I fill and submit each job you approved. I still stop and ask whenever I'm unsure. Fastest, and the most exposed under the sites' terms. |

In every mode you choose the jobs from each shortlist; nothing is applied to without that. Save: `set mode assist`.

For `assist` and `auto`, then ask about the **daily limit**: "I apply to at most 8 jobs per site per day, so the sites don't flag your account. Want it lower?" Fewer is safer; offer 3, 5 or 8. Save: `set daily_cap 5`. If they want more than 8, say once that a higher pace makes a restriction more likely, and save what they choose. In `list` mode skip the question: the default 8 applies if they apply through Rolexa later. `setup cap` returns here.

## 8. checklist (what the user must set up, and up to what point)

Show this, cut to their mode and sites, then `set checklist_shown true`:

**You set up once; Rolexa takes over from there:**

| Needed for | You do | Rolexa does |
|---|---|---|
| Searching (all modes) | Python 3.9+. The Claude desktop app (its built-in browser searches logged out, away from your accounts). | Opens and reads the job pages, fit-checks, writes the shortlist. |
| Applying (`assist`, `auto`) | Install **Claude in Chrome** and connect it to the same Claude account. | Opens job pages in a tab group of its own in your Chrome. |
| Each site you picked | **Sign in to it in that Chrome yourself** and stay signed in. | Never signs in, never types a password, never creates an account. |
| LinkedIn | Email and phone on your profile (Easy Apply reads them). | Uploads the right CV, answers the questions. |
| Indeed / Bayt / Naukri Gulf | A complete profile with a CV uploaded: these sites refuse applications from an incomplete profile, and Bayt and Naukri Gulf send the CV saved on the profile. | Swaps the profile CV to the right one before each application. |
| While applying | Keep the Chrome window open and visible (not minimized): some apply buttons don't respond in a hidden tab. Stay nearby for questions. | Asks in chat whenever a form needs something not in your profile. |

**Rolexa stops and hands the job back at:** a sign-in or register page, a company site that needs a new account, a CAPTCHA or "verify you are human", a password field, or anything that asks for payment.

For `list` mode only the first row applies.

## 9. finish

1. `rolexa.py status` must say `ready`; fix anything it lists.
2. Tell the user, briefly:
   - their preferences are saved in `~/.rolexa/config.json` and `profile.md`, and they can edit them there,
   - **from now on they just run `/rolexa`**,
   - to change something for one run, pass it as an argument; add `save` to keep it. Show 4–5 examples that fit their setup:
     - `/rolexa linkedin`: search LinkedIn only
     - `/rolexa list`: links only, I'll apply myself
     - `/rolexa auto`: submit the jobs I pick
     - `/rolexa city:abu-dhabi save`: switch city for good
     - `/rolexa apply 2,4`: apply to jobs from the last list
     - `/rolexa setup cv`: redo one part of setup
     - `/rolexa insights`: quick numbers from the tracker
     - `/rolexa help`: all arguments
3. Ask whether to run the first search now.
