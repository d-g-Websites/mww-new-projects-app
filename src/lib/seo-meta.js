// <title> and meta description for generated pages, sized to what Google
// shows in a result: about 60 characters of title and 155 of description.
// No imports on purpose — scripts run these against the static site too.

export const TITLE_MAX = 60;
export const DESC_MAX  = 155;

const STREET_SUFFIX = {
  Street: 'St', Avenue: 'Ave', Road: 'Rd', Drive: 'Dr', Lane: 'Ln', Court: 'Ct',
  Boulevard: 'Blvd', Place: 'Pl', Circle: 'Cir', Terrace: 'Ter', Parkway: 'Pkwy',
  Highway: 'Hwy', Trail: 'Trl', Square: 'Sq',
};
const DIRECTION = {
  North: 'N', South: 'S', East: 'E', West: 'W',
  Northeast: 'NE', Northwest: 'NW', Southeast: 'SE', Southwest: 'SW',
};

function parseDate(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

// "Nov 6, 2026"
export function shortDate(isoDate) {
  const d = parseDate(isoDate);
  if (!d) return isoDate || '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// "11/6/26"
function numericDate(isoDate) {
  const d = parseDate(isoDate);
  if (!d) return isoDate || '';
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(-2)}`;
}

// "West Argyle Street" → "W Argyle St", "River Oaks Circle East" →
// "River Oaks Cir E". A direction that is the street's whole name
// ("North Avenue") is left alone.
export function abbreviateStreet(street) {
  const w = String(street).trim().split(/\s+/);
  let end = w.length - 1;
  if (end > 1 && DIRECTION[w[end]]) { w[end] = DIRECTION[w[end]]; end--; }
  if (end > 0 && STREET_SUFFIX[w[end]]) { w[end] = STREET_SUFFIX[w[end]]; end--; }
  if (end > 0 && DIRECTION[w[0]]) w[0] = DIRECTION[w[0]];
  return w.join(' ');
}

// <title> for a project page: service, street, city and the exact job
// date, so no two projects share one (the old "<Service> in <City>, IL —
// <Month Year> Project" repeated for every job in a city that month).
// `twinsBefore` is how many earlier projects share the same service,
// street, city and date; those get "(Job 2)", "(Job 3)"...
// The forms are tried longest first and the first that fits TITLE_MAX wins.
export function buildSeoTitle({ serviceLabel, cityName, street, date, twinsBefore = 0 }) {
  const job   = twinsBefore > 0 ? ` (Job ${twinsBefore + 1})` : '';
  const long  = date ? ` — ${shortDate(date)}` : '';
  const brief = date ? ` — ${numericDate(date)}` : '';
  const forms = [];
  if (street) {
    const abbr = abbreviateStreet(street);
    forms.push(
      `${serviceLabel} on ${street}, ${cityName}${long}${job}`,
      `${serviceLabel} on ${abbr}, ${cityName}${long}${job}`,
      `${serviceLabel} on ${abbr}, ${cityName}${brief}${job}`,
      `${serviceLabel}, ${abbr}, ${cityName}${brief.replace(' —', '')}${job}`,
    );
    // Last resort for a very long street: drop its trailing words.
    const words = abbr.split(' ');
    for (let n = words.length - 1; n >= 1; n--) {
      forms.push(`${serviceLabel}, ${words.slice(0, n).join(' ')}, ${cityName}${brief.replace(' —', '')}${job}`);
    }
  } else {
    forms.push(
      `${serviceLabel} in ${cityName}, IL${long}${job}`,
      `${serviceLabel} in ${cityName}${long}${job}`,
    );
  }
  forms.push(`${serviceLabel} in ${cityName}${brief}${job}`);
  return forms.find(t => t.length <= TITLE_MAX) || forms[forms.length - 1];
}

// Meta description for a project page. `homeType` and `metric` arrive
// ready to print ("2-story house", "24 windows cleaned").
export function buildSeoDescription({ serviceLabel, homeType, cityName, street, metric, date, twinsBefore = 0 }) {
  const stats = metric ? `${metric}. ` : '';
  const twin  = twinsBefore > 0 ? ` (job ${twinsBefore + 1} that day)` : '';
  const done  = `Completed ${shortDate(date)}${twin} by My Window Washing.`;
  const forms = [
    street && `${serviceLabel} at a ${homeType} on ${street} in ${cityName}, IL. ${stats}${done}`,
    `${serviceLabel} at a ${homeType} in ${cityName}, IL. ${stats}${done}`,
  ].filter(Boolean);
  const fit = forms.find(d => d.length <= DESC_MAX);
  return fit || forms[forms.length - 1].slice(0, DESC_MAX - 3).trimEnd() + '...';
}

// <title> for an archive page: when a long city name pushes it past
// TITLE_MAX, "Completed" goes first, then the brand suffix.
export function fitArchiveTitle(title) {
  if (title.length <= TITLE_MAX) return title;
  const short = title.replace(/^Completed Projects in /, 'Projects in ');
  return short.length <= TITLE_MAX ? short : short.replace(/ \| My Window Washing$/, '');
}
