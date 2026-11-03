import test from 'node:test';
import assert from 'node:assert/strict';
import policy from '../rental-policy.js';
const now = Date.parse('2026-11-04T12:00:00+04:00');
test('source renewal counts but a local fetch cannot make an old listing recent', () => {
  assert.equal(policy.rejection({published_at:'2026-10-20T12:00:00+04:00',listing_date:'2026-11-04T12:00:00+04:00'},now),null);
  assert.match(policy.rejection({published_at:'2026-10-20T12:00:00+04:00',retrieved_at:'2026-11-04T12:00:00+04:00'},now),/older/);
  assert.equal(policy.rejection({published_at:'2026-11-01T12:00:00+04:00'},now),null);
  assert.match(policy.rejection({published_at:'2026-11-01T11:59:59+04:00'},now),/older/);
  assert.equal(policy.rejection({listing_date:'2026-11-04T12:00:00+04:00'},now),null);
  assert.match(policy.rejection({retrieved_at:'2026-11-04T12:00:00+04:00'},now),/not confirmed/);
  assert.equal(policy.rejection({created_at:'2026-11-04 10:00:00'},now),null);
});
test('rejects daily offers even when source marks monthly; permits daily-life text', () => {
  for(const description of ['ქირავდება ბინა დღიურად','დღიური ქირა 100 ლარი','daily rental','100 GEL per night','сдается посуточно']) assert.equal(policy.dailyRental({description,transaction:'rent_monthly'}),true);
  for(const description of ['ყოველდღიური ცხოვრებისთვის','არ ქირავდება დღიურად','დღიურად არ ქირავდება','not available for daily rent','не сдаётся посуточно']) assert.equal(policy.dailyRental({description}),false,description);
  assert(policy.dailyRental({url:'https://www.myhome.ge/udzravi-qoneba/qiravdeba-dghiurad-bina-1/'}));
});
test('search cards without creation dates still get a detail check if their update is recent', () => {
  assert.equal(policy.searchRejection({last_updated:'2026-11-04 11:00:00'},now),null);
  assert.match(policy.searchRejection({last_updated:'2026-10-29 11:00:00'},now),/older/);
  assert.equal(policy.rejection({last_updated:'2026-11-04 11:00:00',created_at:'2026-10-29 11:00:00'},now),null);
});
