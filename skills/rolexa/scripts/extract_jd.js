// Run on a logged-out job page: LinkedIn (/jobs/view/), Indeed (any country site, viewjob), Bayt or Naukri Gulf.
// Returns the fields needed for a fit check.
(() => {
  window.scrollBy(0, 600);
  const g = s => document.querySelector(s)?.innerText.trim().replace(/\s+/g, ' ') || '';
  const h = location.hostname;
  let r = {};
  if (h.includes('linkedin.com')) {
    r = { title: g('.top-card-layout__title'), company: g('.topcard__org-name-link'), location: g('.topcard__flavor--bullet'),
      applicants: g('.num-applicants__caption'),
      criteria: [...document.querySelectorAll('.description__job-criteria-item')].map(e => e.innerText.replace(/\s+/g, ' ').trim()).join(' | '),
      description: g('.show-more-less-html__markup') };
  } else if (h.includes('indeed.com')) {
    r = { title: g('[data-testid="vj-job-title"]'), companyAndLocation: g('[data-testid="company-info-metadata"]'),
      applyType: document.querySelector('[data-testid="viewjob-indeed-apply"]') ? 'Indeed Apply' : g('[data-testid="primary-apply-action"]'),
      description: g('[data-testid="viewjob-job-content"]') };
  } else if (h.includes('bayt.com')) {
    const hd = [...document.querySelectorAll('h2,h3')].find(x => /job description/i.test(x.innerText));
    r = { title: g('h1'), pageTitle: document.title,
      apply: [...document.querySelectorAll('#applyLink_1, #apply_1, a[href*="register-j"]')].map(a => a.innerText.trim())[0] || '',
      description: (hd?.closest('.card-content')?.innerText || '').replace(/\s+/g, ' ').trim() };
  } else if (h.includes('naukrigulf.com')) {
    r = { title: g('.jd-header .info-position') || g('h1'), company: g('.jd-header .info-org'),
      workType: (document.title.match(/\b(On-site|Remote|Hybrid)\b/i) || [])[1] || '',
      apply: [...document.querySelectorAll('button,a')].map(b => b.innerText.trim()).find(t => /apply/i.test(t)) || '',
      candidateProfile: g('.candidate-profile'), description: g('.job-description') };
  }
  const d = r.description || '';
  r.workTypeMentions = [...new Set((d.match(/\b(fully remote|remote|hybrid|on-?site|in-office|in person)\b/gi) || []).map(x => x.toLowerCase()))];
  r.description = d.slice(0, 6000);
  r.blocked = !!document.querySelector('#challenge-form, .cf-browser-verification, iframe[src*="challenges"], #cf-challenge-running');
  return r;
})()
