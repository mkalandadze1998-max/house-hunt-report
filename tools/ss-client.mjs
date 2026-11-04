export const SS_SITE = 'https://home.ss.ge';
export const SS_API = 'https://api-gateway.ss.ge/v1/RealEstate';

export function publicSession(response, pageProps) {
  const cookie = response.headers.getSetCookie?.().find(value => value.startsWith('ss-session-token='));
  const token = cookie?.split(';')[0].slice('ss-session-token='.length) || pageProps?.credentialsToken;
  if (!token || /[\s\r\n]/.test(token)) throw Error('SS public session is missing; previous data retained.');
  return token;
}

export async function readDistricts(token, fetchImpl = fetch) {
  const response = await fetchImpl(SS_API + '/DistricsWithSubDistricts95', {
    headers: { authorization: 'Bearer ' + token, os: 'web', 'accept-language': 'ka' },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw Error('SS district request failed: HTTP ' + response.status);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length || rows.some(d => !Number.isInteger(d.id) || typeof d.title !== 'string' || !Array.isArray(d.subDistricts) || d.subDistricts.some(s => !Number.isInteger(s.id) || typeof s.title !== 'string'))) {
    throw Error('SS district data changed; previous data retained.');
  }
  return rows.map(d => ({
    districtTitle: d.title,
    subDistricts: d.subDistricts.map(s => ({ subDistrictId: s.id, subDistrictTitle: s.title }))
  }));
}
