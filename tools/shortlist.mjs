import assert from 'node:assert/strict';
const URL = 'https://wqdoifhpeslhhlcfhzdq.supabase.co';
const KEY = 'sb_publishable_GdGmHZ0bqB835LzHw6Wuag_cPBRr_b2';

// Read flags and IDs only. Never persist passwords, tokens or private notes.
export async function loadShortlist({ password = process.env.HH_PASSWORD, fetchImpl = fetch } = {}) {
  assert(password, 'HH_PASSWORD is missing; cannot read hidden posts and favorites. Collection skipped.');
  const auth = await fetchImpl(URL + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'mariami@house-hunt.local', password }), signal: AbortSignal.timeout(30000)
  });
  assert(auth.ok, 'House Hunt sign-in failed; collection skipped.');
  const token = (await auth.json()).access_token;
  assert(typeof token === 'string' && token, 'House Hunt sign-in returned no token.');
  const hidden = new Set(), favorites = new Set();
  for (let offset = 0; offset < 100000; offset += 1000) {
    const response = await fetchImpl(URL + '/rest/v1/shortlist?select=listing_id,favorite,hidden&order=listing_id.asc&limit=1000&offset=' + offset, {
      headers: { apikey: KEY, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000)
    });
    assert(response.ok, 'Cannot read shared listing choices; collection skipped.');
    const rows = await response.json();
    assert(Array.isArray(rows), 'Shared listing choices changed format.');
    for (const row of rows) {
      assert(typeof row.listing_id === 'string' && typeof row.hidden === 'boolean' && typeof row.favorite === 'boolean', 'Invalid shared listing choice.');
      if (row.hidden) hidden.add(row.listing_id);
      else if (row.favorite) favorites.add(row.listing_id);
    }
    if (rows.length < 1000) return { hidden, favorites };
  }
  throw Error('Shared listing choices exceeded the read limit; collection skipped.');
}

export function planListingChecks(previous, freshIds, choices, now, ageHours, limit, capacity = Infinity) {
  const last = p => { const t = Date.parse(p.last_checked_at ?? p.retrieved_at ?? ''); return Number.isFinite(t) ? t : -Infinity; };
  const fresh = [...new Set(freshIds)].filter(id => !choices.hidden.has(id));
  const due = previous.filter(p => !choices.hidden.has(p.id) && choices.favorites.has(p.id) && now - last(p) >= ageHours * 3600000)
    .sort((a, b) => last(a) - last(b) || a.id.localeCompare(b.id)).map(p => p.id);
  const candidates = [...fresh, ...due.filter(id => !fresh.includes(id)).slice(0, Math.max(0, limit))].slice(0, Math.max(0, capacity));
  return { candidates, fresh, due, deferred: due.filter(id => !candidates.includes(id)).length };
}
