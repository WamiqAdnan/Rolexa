// Run on a logged-out search results page: LinkedIn (search page or its jobs-guest "see more" endpoint),
// Indeed (any country site), Bayt or Naukri Gulf.
// Returns TSV: id \t title \t company \t location \t posted \t url
// IDs: LinkedIn = bare number; others are prefixed indeed: / bayt: / ng:
(() => {
  const clean = s => (s || '').replace(/[\t\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
  const abs = h => h ? new URL(h, location.origin).href.split('?')[0] : '';
  const h = location.hostname;
  let rows = [];
  if (h.includes('linkedin.com')) {
    // The search page wraps cards in a list; the see-more endpoint returns bare <li> cards.
    let cards = [...document.querySelectorAll('ul.jobs-search__results-list > li')];
    if (!cards.length) cards = [...document.querySelectorAll('li')].filter(li => li.querySelector('[data-entity-urn*="jobPosting"]'));
    rows = cards.map(li => {
      const id = (li.querySelector('[data-entity-urn]')?.getAttribute('data-entity-urn') || '').split(':').pop();
      const g = s => clean(li.querySelector(s)?.innerText);
      return id && [id, g('.base-search-card__title'), g('.base-search-card__subtitle'),
        g('.job-search-card__location'), g('time'), `https://www.linkedin.com/jobs/view/${id}/`];
    });
  } else if (h.includes('indeed.com')) {
    // Indeed mixes in decoy cards (patterned job keys that duplicate the card above). Never open those.
    const decoy = /^(0123456789abcdef|123456789abcdef0|abcdef0123456789|0f1e2d3c4b5a6978|fedcba9876543210)$/;
    const seen = new Set();
    rows = [...document.querySelectorAll('.job_seen_beacon')].map(c => {
      const a = c.querySelector('a[data-jk]'); const jk = a?.getAttribute('data-jk');
      const g = s => clean(c.querySelector(s)?.innerText);
      const k = clean(a?.innerText) + '|' + g('[data-testid="company-name"]');
      if (!jk || decoy.test(jk) || seen.has(k)) return null;
      seen.add(k);
      const easy = /easily apply|indeed apply/i.test(c.innerText) ? ' · Indeed Apply' : '';
      return ['indeed:' + jk, clean(a.innerText), g('[data-testid="company-name"]'), g('[data-testid="text-location"]'),
        (g('[data-testid="myJobsStateDate"]') || g('.date')) + easy, `https://${location.host}/viewjob?jk=${jk}`];
    });
  } else if (h.includes('bayt.com')) {
    rows = [...document.querySelectorAll('li[data-js-job][data-job-id]')].map(c => {
      const g = s => clean(c.querySelector(s)?.innerText);
      const a = c.querySelector('h2 a') || c.querySelector('a[href*="/jobs/"]');
      return ['bayt:' + c.getAttribute('data-job-id'), g('h2'), g('.job-company-location-wrapper a, .job-company-location-wrapper'),
        g('.jb-label-location'), g('.jb-footer'), abs(a?.getAttribute('href'))];
    });
  } else if (h.includes('naukrigulf.com')) {
    rows = [...document.querySelectorAll('.ng-box.srp-tuple')].map(c => {
      const a = c.querySelector('a.info-position'); const href = a?.href || '';
      const jid = (href.match(/jid-(\d+)/) || [])[1];
      const g = s => clean(c.querySelector(s)?.innerText);
      return jid && ['ng:' + jid, g('.designation-title'), g('.info-org'), g('.info-loc') + ' · ' + g('.info-exp'),
        g('.time') + (c.querySelector('.easy') ? ' · Easy Apply' : ''), href.split('?')[0]];
    });
  }
  return rows.filter(Boolean).map(r => r.join('\t')).join('\n');
})()
