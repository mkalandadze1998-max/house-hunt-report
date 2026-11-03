(function (root) {
  const publicationTime = p => {
    // Source renewal dates count. Local retrieval/check dates never count.
    let value = p.listing_date ?? p.last_updated ?? p.published_at ?? p.created_at;
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
    if (!Number.isFinite(posted)) return 'Source publication or renewal date is not confirmed';
    if (posted > now) return 'Publication date is in the future';
    if (now - posted > 72 * 3600000) return 'Source post or renewal is older than three days';
    return null;
  };
  const searchRejection = (p, now = Date.now()) => {
    if (dailyRental(p)) return 'Daily rental offer';
    return rejection(p, now);
  };
  const policy = { publicationTime, dailyRental, rejection, searchRejection };
  if (typeof module !== 'undefined' && module.exports) module.exports = policy;
  else root.HouseHuntPolicy = policy;
})(globalThis);
