import { arr, obj, str, strArr, strEnum } from "../anthropic";

/**
 * JSON schema for CV extraction.
 *
 * Every scalar is a plain string with "" meaning "not stated in this CV".
 * Structured outputs don't support numeric constraints, and nullable unions add
 * nothing here — "" is unambiguous and keeps the schema inside the supported
 * subset.
 */
export const CV_EXTRACTION_SCHEMA = obj({
  personal: obj({
    fullName: str("Exactly as written on the CV. \"\" if absent."),
    email: str(),
    phone: str(),
    location: str("City and/or country as written."),
    headline: str("The professional headline/title line under the name, if any."),
    summary: str("The personal statement / profile paragraph, verbatim."),
    links: strArr("LinkedIn, portfolio, GitHub URLs as written."),
  }),
  totalYearsExperience: str(
    "Total years of experience ONLY if the CV states it explicitly (e.g. " +
      "'7+ years'). Return the number as a string, e.g. \"7\". Do NOT compute " +
      "it from employment dates. \"\" if the CV does not state it.",
  ),
  totalYearsEvidence: str(
    "The phrase the years figure was taken from, verbatim. \"\" if none.",
  ),
  experience: arr(
    obj({
      jobTitle: str("Verbatim job title."),
      company: str(),
      location: str(),
      industry: str("Only if stated or unmistakable from the employer. \"\" otherwise."),
      startDate: str("YYYY-MM or YYYY. \"\" if not stated."),
      endDate: str("YYYY-MM, YYYY, or 'Present'. \"\" if not stated."),
      responsibilities: strArr("Duty bullets, lightly cleaned but not reworded."),
      achievements: strArr(
        "Bullets describing a result or outcome, including any metrics, verbatim.",
      ),
      technologies: strArr("Tools/technologies named within this role."),
    }),
  ),
  skills: arr(
    obj({
      name: str("The skill exactly as written on the CV."),
      kind: strEnum(
        ["technical", "software", "tool", "platform", "programming", "methodology", "soft"],
        "Best-fit category for this skill.",
      ),
    }),
  ),
  education: arr(
    obj({
      degree: str("e.g. BSc, MSc, MBA, High School Diploma."),
      field: str(),
      institution: str(),
      location: str(),
      startDate: str(),
      endDate: str(),
      grade: str("Classification / GPA as written."),
    }),
  ),
  certifications: arr(
    obj({
      name: str(),
      issuer: str("Issuing organisation. \"\" if not stated."),
      issueDate: str(),
      expiryDate: str(),
    }),
  ),
  projects: arr(
    obj({
      name: str(),
      description: str(),
      role: str(),
      technologies: strArr(),
      outcomes: strArr("Stated results, verbatim."),
    }),
  ),
  languages: arr(
    obj({
      language: str(),
      proficiency: str("As written, e.g. 'Native', 'Fluent', 'B2'. \"\" if not stated."),
    }),
  ),
  licences: strArr("Driving licences, professional licences, work permits."),
  awards: strArr(),
  publications: strArr(),
  industries: strArr("Industries this person has worked in, per this CV."),
  targetRoles: strArr(
    "Roles this CV is clearly aimed at, from the headline or summary only. " +
      "Empty if the CV does not say.",
  ),
  additional: strArr("Anything else relevant that has no home above."),
});

export const CV_EXTRACTION_SYSTEM = `You extract structured data from CVs/resumes.

You are a transcriber, not an author. The single rule that overrides everything
else: record only what the document actually says.

- Never infer, upgrade, round or embellish. If a CV says "assisted with
  reporting", do not record "owned reporting".
- Never invent employers, dates, degrees, certifications, metrics or skills.
- Never calculate a value the CV does not state. In particular, do NOT derive
  totalYearsExperience from employment dates — leave it "" unless the CV writes
  the figure out.
- Copy achievement bullets and their metrics verbatim; they are evidence.
- If a field is absent, return "" (or an empty array). An empty field is a
  correct answer; a plausible guess is not.
- Keep the author's own wording for job titles and skills. Normalisation happens
  downstream and needs the original spelling.

Return only the JSON object described by the schema.`;

/* ------------------------------------------------------------------ */
/* Job requirements                                                    */
/* ------------------------------------------------------------------ */

export const JOB_REQUIREMENTS_SCHEMA = obj({
  title: str("The job title as advertised."),
  company: str(),
  location: str(),
  seniority: str("Entry / Junior / Mid / Senior / Lead / Manager / Executive, or \"\"."),
  requirements: arr(
    obj({
      label: str("Short canonical name for the requirement, e.g. 'Power BI', 'SQL'."),
      kind: strEnum(
        ["SKILL", "TOOL", "ROLE", "EXPERIENCE", "EDUCATION", "CERTIFICATION", "LANGUAGE", "SOFT", "OTHER"],
        "What sort of requirement this is.",
      ),
      importance: strEnum(
        ["MUST", "NICE"],
        "MUST for essential/required items, NICE for desirable/preferred/bonus.",
      ),
      quote: str("The phrase from the advert this came from, verbatim."),
    }),
  ),
});

export const JOB_REQUIREMENTS_SYSTEM = `You read job adverts and list what the employer is actually asking for.

- One entry per distinct requirement. Split compound lines: "SQL and Python"
  becomes two entries.
- 'label' should be the shortest name a recruiter would recognise ("Power BI",
  not "experience building Power BI dashboards").
- Mark MUST for anything under essential/required/must-have, and for anything
  phrased as a hard condition. Mark NICE for desirable/preferred/bonus/plus.
- Include soft skills and years-of-experience/education requirements — they are
  requirements too.
- Skip perks, salary, company boilerplate and equal-opportunity statements.
- Aim for 8–25 requirements. Do not pad the list.

Return only the JSON object described by the schema.`;

/* ------------------------------------------------------------------ */
/* CV tailoring                                                        */
/* ------------------------------------------------------------------ */

export const TAILOR_SCHEMA = obj({
  markdown: str("The complete tailored CV in Markdown."),
  changesMade: strArr(
    "One line per change, concrete and specific, e.g. 'Moved the SQL " +
      "experience above the Excel experience'.",
  ),
  notAdded: strArr(
    "Requirements from the job you deliberately did NOT add, each with the " +
      "reason, e.g. 'AWS - no supporting evidence in any uploaded CV'.",
  ),
});

export const TAILOR_SYSTEM = `You tailor an existing CV to a specific job advert.

You may re-order, re-group, re-emphasise and re-word. You may pull in
experience, skills or achievements that appear in the EVIDENCE section, because
those come from the candidate's own other CVs.

You may not create anything else. Specifically, never write:
- an employer, job title, date or duration that is not in the source material
- a qualification, degree, certification or licence that is not in it
- a metric, percentage, headcount, budget or timeframe that is not in it
- a skill with no supporting evidence
- a claim of seniority, ownership or scope beyond what the source says

Re-wording must preserve the fact. "Supported the migration" may become
"contributed to the migration"; it may not become "led the migration".

If the job asks for something the candidate cannot evidence, leave it out and
record it in notAdded with the reason. An honest gap is the correct output.

Write the CV in clean Markdown: '# Name' as the first line, then contact
details, then a short summary, then sections with '## ' headings. Keep it
readable as plain text.

Return only the JSON object described by the schema.`;
