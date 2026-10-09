# Rolexa: applying (Phase B)

Runs only for jobs the user named **in this session**, in their own Chrome via Claude in Chrome (`mcp__claude-in-chrome__*`). Load those tools in one `ToolSearch` call. If no browser is connected, retry `list_connected_browsers` once (the connection can drop for a moment), then follow "Chrome not connected" at the end of this file.

## Before the first job

1. Read the run's `.tsv` (`resolve` gives `shortlist` for `apply` runs). Turn the selection into rows: numbers, ranges, or `high` / `medium` / `low` / `all` (the groups in the file).
2. If the selection came from an argument (`/rolexa apply 2,5`) rather than a reply to the shortlist just shown, list the jobs once (number, role, company, CV, who submits) and wait for a "yes".
3. `python3 $R/scripts/registry.py today`: if more jobs are approved for a site than it has left today, say which ones wait for tomorrow (the last ones in the order below).
4. Order: group Indeed, Bayt and Naukri Gulf jobs by CV (see "One saved CV per site"), so each CV is uploaded once.

## For each job, one at a time

1. **Daily cap:** `python3 $R/scripts/registry.py check <site>`, with the site the job was found on. Exit 1 means that site is done for today: skip its remaining jobs, tell the user, carry on with the other sites. Run it before **every** job, not once per run, so jobs logged meanwhile (by the user in `assist`, or another session) count. Never reorder, re-label or skip logging to get around it.
2. Open the job URL in a new tab in the MCP tab group. If the page shows the user already applied ("Applied", "Application submitted"), skip it and log it as `already applied`.
3. Sign-in page, register page, a company site that needs a new account, a password field, a CAPTCHA or "verify you are human": **stop this job and hand it to the user** with the link, and log it as `handed back` (the note says why) so it shows in the tracker as a to-do. A CAPTCHA or an "unusual activity" / restriction warning stops the **whole run**.
4. Fill the form step by step, 2–4 s between steps:
   - contact fields: check them against `profile.md` "Contact"; fix any that differ,
   - CV: attach the job's CV from the shortlist (see "Uploading a CV"),
   - questions: answer from `profile.md` only. Numeric "years" fields take a bare whole number (years since the skill's start date, rounded down),
   - leave optional extras such as "Mark as top choice" off.
5. Anything you are not sure of: **"Ask, don't assume"** below. Keep the tab open while waiting.
6. The review page: check the CV name and every answer against what you meant to send.
7. Submit, by mode:
   - **assist**: don't click Submit. Say: "Job N is filled and on the review page in Chrome: <role> at <company>, CV <file>. Check it and click Submit, then tell me 'done' (or 'skip')." Wait. On "done", look at the page for the confirmation ("Application sent", "Applied") and log status `submitted by user`. If no confirmation shows, say so and log `unconfirmed`. On "skip", log nothing.
   - **auto**: click Submit, wait for the confirmation, log status `applied`. No confirmation → screenshot, tell the user, log `unconfirmed`.
8. Log: write this job's line, tab-separated, `site, company, title, location, fit, cv, mode, status, url, notes`, to a fresh `$SCRATCH/applied.tsv` and run `registry.py log $SCRATCH/applied.tsv`. `fit` is the shortlist verdict (Strong, Good, ...); `notes` holds the work type and anything worth remembering (questions asked, salary given). The tracker skips a URL it already has, except a `handed back` row that is now sent, which it updates.
9. Close the tab, wait 15–25 s, next job.

At the end, add a short outcome table (job, status, CV, answers given) to the run's `.md` file.

## Ask, don't assume

Pause the job and ask in chat whenever:
- a question's answer isn't in `profile.md` (facts or "Learned answers"),
- an answer would need stretching: a skill they have only near (e.g. "years of Kubernetes" when the profile has Docker), a rounded-up number, a "yes" that is only partly true,
- a dropdown or radio has no option that matches the profile exactly,
- the form asks for a cover letter, a "why this company", or any free text: draft it from the profile and the description, show it, enter it only once approved,
- the form asks about salary in a different currency or period than the profile, or the posting's range doesn't overlap the user's,
- the form asks about gender, ethnicity, disability, veteran status, religion, nationality or age: ask, and offer "prefer not to say" where the form has it,
- there is a consent, terms, declaration or "I certify" checkbox,
- the job turns out different from the shortlist (another city, contract instead of permanent, much more senior, closed),
- it is unclear which CV fits, or the site would send a different CV than intended.

How to ask: quote the exact question and its options, say what you would answer and why (or that the profile has nothing), and wait. One message per job; batch that job's open questions together.

After the answer:
- fill it in and continue,
- if it is a fact about the user that will come up again (not job-specific), add it to `profile.md` → "Learned answers" as `question · answer · date`, and list it in the final report so the user can correct it,
- never reuse a job-specific answer (a cover letter, "why us") on another job.

## Uploading a CV

Sites often create the file input only when the upload button is clicked, which would open the OS file picker. Instead:
1. Run `scripts/capture_file_input.js` with `javascript_tool`. It intercepts that click.
2. `find` the upload button ("Upload resume", "Upload CV") and click it. No picker opens.
3. `find` the hidden `type=file` input and call `file_upload` with its ref and the CV's absolute path.
4. Run `window.__rolexaRestoreClick()`.
5. Check the uploaded file is listed and selected.

If the form already shows a file input, skip steps 1, 2 and 4.

## Per site

**LinkedIn Easy Apply.** Multi-step modal. Upload the CV on the resume step (it goes to the top of the list; make sure it is the selected one). "Apply" (not Easy Apply) leads to a company site: treat it as one (below). If the modal opens in a tab that isn't in front and doesn't respond, bring the tab to the front and retry once.

**Indeed Apply.** Multi-step form. Upload the CV if the resume step has a file input; otherwise swap the profile CV first (below). Indeed often asks screening questions listed in the description: answer from `profile.md`, ask for the rest.

**Bayt "Apply".** Sends the CV on the Bayt profile: swap it first (below). A cover-letter or question page may appear: same rules.

**Naukri Gulf "Easy Apply".** Sends the profile CV: swap it first (below). It may show a short questionnaire.
- The CV upload is on the profile's CV page. Naukri Gulf renames uploads, so the file name can't confirm which CV is on. Rely on the "uploaded successfully" message.
- **The tab must be visible, or the Apply buttons do nothing.** The page runs its apply step in `requestAnimationFrame`, which Chrome doesn't fire in hidden tabs. Check `document.visibilityState`; if not `"visible"`, ask the user to bring the Chrome window to the front (not minimized, not behind a full-screen app), then click with a real `computer` click. Don't shim browser functions or call the page's apply code from injected JS. If it still does nothing, hand the job over and say which CV is on the profile.

**"Apply on company site"** (any source). A company portal. Continue only if it needs no new account; a portal that needs one goes back to the user. The cap counts it against the site where the job was found.

## One saved CV per site (Indeed, Bayt, Naukri Gulf)

These sites keep one CV on the profile and send that one.
1. Group the site's approved jobs by CV and apply to all jobs for one CV before switching.
2. Before each job: if the apply flow has its own file input, upload there; otherwise replace the profile CV with the job's CV, then apply.
3. On the review step, check the CV named there is the intended one.
4. The swap is part of the approved application; never swap a profile CV for a job the user didn't approve. The profile keeps whichever CV was used last; mention that in the report.

## Pace and limits

- 2–4 s between form steps, 15–25 s between jobs.
- Daily cap per site: `daily_cap` in `config.json` (default 8), enforced by `registry.py check` before each job.
  - Counted from today's rows in the tracker CSV for that site, including rows dated in a spreadsheet's own format. Every status counts except `handed back`, `skipped`, `already applied` and `not submitted`; `unconfirmed` counts, since a submit without a confirmation page has most likely gone through.
  - A company-site application counts against the site where the job was found.
  - Applications the user makes on their own count only once they're logged (mode `manual`): offer to log them when they mention one.
- Stop the whole run on a CAPTCHA, a human-verification page, or an "unusual activity" or restriction warning, and tell the user.

## Chrome not connected

Tell the user to check that Chrome is open, the Claude in Chrome extension is installed and signed in to the same Claude account as this session, and then try again. Offer to finish the run in `list` mode meanwhile.
