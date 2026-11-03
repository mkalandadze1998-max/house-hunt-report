(function (root) {
  const publicationTime = p => {
    let value = p.published_at ?? p.created_at;
    if (typeof value !== 'string' || !value.trim()) return NaN;
    value = value.trim().replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)) value += '+04:00';
    return Date.parse(value);
  };
  const dailyRental = p => {
    if (p.transaction === 'rent_daily' || p.deal_type_id === 3) return true;
    if (/qiravdeba-dghiurad|rent-daily|posutoch/i.test(p.url || p.dynamic_slug || '')) return true;
    let text = [p.title, p.dynamic_title, p.description, p.comment].filter(Boolean).join('\n').toLowerCase();
    text = text.replace(/(?:არ\s+ქირავდება\s+დღიურად|დღიურად\s+არ\s+ქირავდება|not\s+(?:available\s+for\s+)?daily\s+rent|не\s+(?:сда[её]тся\s+)?посуточно)/g, '');
    return /(?:^|[^ა-ჰ])დღიურად(?:$|[^ა-ჰ])|დღიური\s+(?:ქირა|გაქირავება)|\b(?:daily\s+rent(?:al)?|rent(?:ed)?\s+(?:out\s+)?daily|per\s+(?:day|night)|nightly\s+rent)\b|посуточн|плат[аы]\s+за\s+сутки/i.test(text);
  };
  const rejection = (p, now = Date.now()) => {
    if (dailyRental(p)) return 'Daily rental offer';
    const posted = publicationTime(p);
    if (!Number.isFinite(posted)) return 'Original publication date is not confirmed';
    if (posted > now) return 'Publication date is in the future';
    if (now - posted > 72 * 3600000) return 'Original post is older than three days';
    return null;
  };
  const searchRejection = (p, now = Date.now()) => {
    if (dailyRental(p)) return 'Daily rental offer';
    if (p.created_at || p.published_at) return rejection(p, now);
    // Search cards omit created_at. An old update proves age; a recent update does not prove youth.
    // Fetch recent candidates, then require the original date from their detail record.
    const updated = publicationTime({ created_at: p.last_updated });
    return Number.isFinite(updated) && now - updated > 72 * 3600000 ? 'Search update is older than three days' : null;
  };
  const policy = { publicationTime, dailyRental, rejection, searchRejection };
  if (typeof module !== 'undefined' && module.exports) module.exports = policy;
  else root.HouseHuntPolicy = policy;
})(globalThis);
