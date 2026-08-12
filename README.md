# Rolexa

A private CV library with a **Master Professional Profile** built by combining every CV you
upload — then job matching that scores you twice: once on what you can actually evidence, and
once on how well the CV you'd send communicates it.

No CV is treated as the source of truth. Nothing is invented.

---

## Run it

```bash
cp .env.example .env
npm install
npm run setup
npm run dev
```

Then open <http://localhost:3000>.

`npm run setup` generates the Prisma client and creates `prisma/dev.db`. Uploaded files live in
`uploads/`; both are gitignored, so the library stays on your machine.

### Optional: add a model

CV extraction, job-requirement reading and CV tailoring read better with a model behind them.
Rolexa takes either of two, and works without both.

```bash
# .env — Claude, if you have a key
ANTHROPIC_API_KEY=sk-ant-...
```

`claude-opus-5` by default; override with `ANTHROPIC_MODEL`.

```bash
# .env — or a local model, no key and no network
OLLAMA_MODEL=qwen3:8b
```

Needs [Ollama](https://ollama.com) running (`ollama serve`) with the model pulled
(`ollama pull qwen3:8b`). Point `OLLAMA_HOST` elsewhere if it isn't on `localhost:11434`.
Generation is minutes rather than seconds and the results are weaker than Claude's, but the
whole pipeline runs offline.

A key wins when both are set. With neither, Rolexa falls back to deterministic parsers —
everything still works end to end, extraction is just less accurate on unusual layouts and
tailoring is limited to re-ordering rather than re-wording. Each CV shows which path produced
it, and **Re-extract** re-runs a CV after you configure one.

---

## How it works

```
Upload CVs  →  Extract per CV  →  Master Professional Profile  →  Search terms
   (1)             (2)                     (3)                          (4)
                                                                            ↓
                                          Fetch jobs from every board  ←  ┘
                                                (5)
                                                 ↓
                              Tailor  ←  Score a job twice  ←  Merge duplicates
                                (7)            (6)
```

### 1. CV Library — `/cvs`

Upload PDF, DOCX or TXT. Store as many versions as you keep: by job title, industry, country or
seniority level. Each CV records its file name, upload date, a name you can change at any time,
an optional target role and industry, its parsed text, its extracted data and its processing
status. The original file is never modified.

### 2. Per-CV extraction

Each CV is read on its own: personal details, employment history with dates and bullets, skills,
education, certifications, projects, languages, licences, awards and publications.

The extractor is a transcriber, not an author. It records only what the document says, and an
absent field stays empty rather than being guessed. One example of the guard: a stated
years-of-experience figure is only kept if the phrase it came from actually appears in the CV —
if the model computed it from employment dates instead of reading it, it's dropped.

### 3. Master Professional Profile — `/profile`

Facts from every CV are merged into one profile. Terminology is unified, facts are not:

- **"PowerBI", "Microsoft Power BI" and "Power BI"** become one skill — and each source keeps the
  spelling it used, visible on hover.
- **"Data Analyst" and "BI Analyst" at the same employer** are recognised as one job described two
  ways. Both titles are retained.
- **Job titles are grouped into role families** (analytics, project delivery, data engineering…) so
  transferable experience can be spotted without claiming a title you never held.

Every attribute carries its evidence — which CVs it came from and how each one worded it — plus a
confidence indicator:

| | Meaning |
|---|---|
| 🟢 **Confirmed** | Backed by more than one CV, or confirmed by you. With a single CV in the library, anything clearly stated counts as confirmed. |
| 🟡 **Needs review** | Appears in one CV only. |
| 🔴 **Conflicting** | Your CVs disagree. |

Conflicts are never resolved silently. When two CVs claim different years of experience, different
start dates for the same role, or a different location, the profile flags it and asks you to pick.
A CV that simply omits a value is treated as silence, not disagreement — only two CVs *stating
different things* is a conflict.

Your decisions (resolve / confirm / not applicable) are keyed to the fact itself, so they survive
every later upload and rebuild.

### 4. Search terms — `/search`

Everything you'd type into a job board, derived from the profile:

- **Job titles** — the ones you've held (base form, seniority stripped, because that casts a
  wider net), your stated target roles, and sibling titles from the same role family. Held titles
  are marked ✓ and on by default; transferable suggestions are off by default and labelled as
  such. Compound headlines like "Project Manager – Data & Analytics" are reduced to the searchable
  title.
- **Seniority** — only levels your evidence supports. "Lead" and "Manager" need management
  experience on a CV, not just years served. If your CVs disagree on total years, the timeline is
  used instead and the page says so.
- **Skill keywords** — strongest first, by confidence then source count. Soft skills are excluded
  (they return noise), and near-universal terms like Excel and Reporting stay in the list but
  aren't switched on, because ANDing them excludes nothing.
- **Locations** — where your CVs say you are, plus everywhere you've worked, plus Remote. A
  location conflict is an asset here: each variant is a search worth running. Near-duplicates
  ("Dubai" / "Dubai, UAE") are merged.

You get two query forms. **Broad** ORs the titles — the widest useful net, and where to start.
**Focused** also requires one of the keywords, which cuts volume hard. Both are offered as boolean
(works on LinkedIn, Indeed and most ATS searches) and as plain text, with copy buttons and deep
links into LinkedIn, Indeed, Google Jobs and Glassdoor.

Country domains vary, so treat the links as templates — add your own boards by appending to
`JOB_BOARDS` in [src/lib/search-profile.ts](src/lib/search-profile.ts).

### 5. Fetching jobs — `/jobs`

Save a search — keywords, optional location, optional remote-only — and **Refresh** runs it
against every configured board. Everything found is scored on arrival, so the list comes back
ranked by fit rather than by date.

**Sources.** Three remote boards work with no key at all: Remotive, RemoteOK and We Work
Remotely. Two more widen the net:

| Source | Key | Covers |
|---|---|---|
| **JSearch** (RapidAPI) | `RAPIDAPI_KEY` | The Google Jobs index — which carries **LinkedIn, Indeed and Glassdoor** postings. Worldwide, including the Gulf. |
| **Adzuna** | `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` | UK / EU / US / IN. Set `ADZUNA_COUNTRY`. No UAE index. |

There is deliberately no LinkedIn or Indeed scraper. Both block automated access, and LinkedIn
bans the account whose session a scraper borrows — so a scraper works right up until it silently
doesn't, on their schedule rather than yours. JSearch reaches the same postings through Google
Jobs, which is the supported route. Adding a board is one file in
[src/lib/sources/](src/lib/sources/) plus a line in its `index.ts`; nothing downstream changes.

**One advert, several portals.** The same job posted to four boards is one row, not four. This
reuses the profile's evidence pattern: a canonical job with a source per portal, each keeping that
portal's own title and link, shown as badges on the row.

The bar for merging is high on purpose. Employer and role must agree *and* a second signal must
agree — same location, or substantially the same advert text. Employer plus title alone isn't
enough, because a large employer genuinely does run two different "Data Analyst" openings in two
cities. A false merge hides a job you never see; a missed merge shows a duplicate you can ignore.
When the evidence is thin they stay apart. Where one portal truncated its description and another
carries the full text, the fuller version wins and the job is re-scored against it.

**Tracking.** Every job carries where you are with it — New, Shortlisted, Applied, Interviewing,
Offer, Rejected, Discarded — filterable at the top of the list, with the applied date stamped
automatically. A `minMatch` on a saved search files anything below that score under Discarded
rather than deleting it, so it isn't re-fetched and re-scored on the next refresh.

Refresh scores at most 25 new jobs per run; the rest stay queued and can be analysed from their
own page. With a model configured each score is a model call, so the cap is there to stop a wide
search quietly costing money — or, on a local model, quietly costing an afternoon.

### 6. Job matching

Requirements are extracted and split into essential and desirable, then compared against the
**whole profile** first — not against one CV. Adverts you paste in by hand go through exactly the
same path as fetched ones.

Two scores come out, and the gap between them is the point:

- **Professional Match** — how well you actually fit, from your combined profile.
- **CV Match** — how well the recommended CV communicates that fit.

> Professional Match 83% · CV Match 68% → *you're qualified, but this CV isn't saying so.*

Rolexa then recommends the best CV in your library for this job, scores every other CV against it,
and shows a requirement-by-requirement comparison of Master Profile vs recommended CV. Every row in
the list names that CV and its score — *Send: Data Analyst CV — communicates 68% of what this job
asks for* — so you can see which one to send without opening the job.

Gap analysis splits requirements four ways, because the right action differs:

| Bucket | What it means |
|---|---|
| ✅ **You have it** | Evidenced and clearly stated in the CV. |
| ⚠️ **Not emphasised** | Your profile supports it; this CV barely mentions it. This is what tailoring fixes. |
| ❌ **No evidence** | Not supported by any uploaded CV. Don't add it. |
| ❓ **Unclear** | Ambiguous, conflicting, or only a transferable match. Verify it. |

Qualification requirements match by level, so a BSc in Statistics satisfies "bachelor's degree in a
quantitative discipline", and a Master's satisfies a bachelor's ask. Where a years-of-experience
requirement can only be met by a figure derived from your employment timeline, the match is
reported as **Unclear** with a note — a derived number never becomes a stated fact.

### 7. Tailoring

**Tailor CV for this job** starts from an existing CV, compares it with the advert, and re-orders,
re-groups and re-emphasises. It may pull in skills, languages and certifications that appear in
your *other* CVs — with attribution — because you wrote those about yourself.

It may not create anything else: no employer, date, qualification, metric or skill that isn't in
your source material, and no upgrade of scope ("supported the migration" may become "contributed
to", never "led").

Every generated CV reports:

- **Changes made** — each one specific ("Added Tableau (from Data Analyst CV) — this job asks for it").
- **Information intentionally NOT added** — with the reason ("AWS — no supporting evidence found in
  any uploaded CV").
- **Warnings** — a post-generation audit against the union of your CVs. It flags figures,
  years-of-experience claims and credentials that appear in the output but in none of your source
  documents, and it flags any unresolved profile conflict the CV has silently taken a side on.

### CV versions

Generated CVs become versions under the CV they came from. The original is never overwritten.

```
CV Library
├── Data Analyst CV
│   ├── Original
│   └── Senior Data Analyst @ Gulf Commerce Bank - 2026-08-08
├── Technical CV
│   └── Original
└── Project Manager CV
    └── Original
```

---

## Project layout

```
prisma/schema.prisma        Cv, CvVersion, Job, JobSource, SavedSearch,
                            Attribute, AttributeSource
src/lib/
  types.ts                 Shared shapes
  normalize.ts             Skill dictionary, role families, degree levels
  extract/text.ts          PDF / DOCX / TXT → plain text
  extract/schema.ts        JSON schemas + system prompts
  extract/rules.ts         Deterministic CV parser (no-API-key path)
  extract/index.ts         Extraction orchestration + evidence check
  master-profile.ts        Aggregation, conflict detection, confidence
  search-profile.ts        Search titles, keywords, locations, query building
  sources/                 One adapter per job board, behind one interface
    index.ts               Registry + availability
    http.ts                Fetch, HTML→text, salary and date helpers
  job-dedupe.ts            Recognising one advert posted to several portals
  job-fetch.ts             Refresh: fetch, merge, score on arrival
  job-match.ts             Requirement extraction, scoring, gap analysis
  tailor.ts                Tailoring + fabrication audit
  pipeline.ts              Background processing
  anthropic.ts             Claude client + provider choice (structured, streaming)
  ollama.ts                Local-model provider behind the same contract
src/app/                   Pages and API routes
```

## Scripts

| Command | Does |
|---|---|
| `npm run setup` | Generate the Prisma client and create the database |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run db:studio` | Browse the database |

## Notes

- SQLite + local disk, single user, no auth — it's designed to run on your own machine.
- CV processing runs in the background; the library and job pages poll while work is in flight.
- Deleting a CV removes its file, its versions and its contribution to the profile.
- Deleting a saved search keeps the jobs it found — some of those are applications by then.
- Refresh is manual. There's no scheduler: on a machine that sleeps, a cron job mostly teaches you
  that it didn't run. Point one at `POST /api/searches/refresh` if you want one.
