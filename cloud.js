'use strict';
/* ── House Hunt · shared state & login (Supabase) ────────────────────
   One shared password unlocks the site (it signs in to the default
   Supabase account). Who you are — Mariami by default, switchable to
   Aslani in the header — is a label remembered per device and stamped
   on every change. Favorites, hidden listings, the compare set and notes
   live in the `shortlist` table and sync live between devices. The
   publishable key is safe to embed: row-level security only lets
   signed-in users read or write.                                       */
window.HH_CLOUD=(()=>{
  const SUPABASE_URL='https://wqdoifhpeslhhlcfhzdq.supabase.co';
  const SUPABASE_KEY='sb_publishable_GdGmHZ0bqB835LzHw6Wuag_cPBRr_b2';
  const PEOPLE={mariami:'Mariami',aslani:'Aslani'};
  const DEFAULT_WHO='mariami';          // account used for the password sign-in and the default identity
  const EMAIL_DOMAIN='house-hunt.local';
  const TABLE='shortlist';

  const $=s=>document.querySelector(s);
  let sb=null;
  const waitForLibrary=(ms=10000)=>new Promise(res=>{const t0=Date.now();(function poll(){if(window.supabase)return res(window.supabase);if(Date.now()-t0>ms)return res(null);setTimeout(poll,150)})()});
  let user=null;             // {id,email,name}
  const listeners=new Set(); // change callbacks (row)=>void
  const whoListeners=new Set();
  let who=DEFAULT_WHO;try{const w=localStorage.getItem('house-hunt-who');if(w&&PEOPLE[w])who=w}catch{}
  function setWho(k){if(!PEOPLE[k])return;who=k;try{localStorage.setItem('house-hunt-who',k)}catch{}if(user)user.name=PEOPLE[k];renderWho();for(const fn of whoListeners)try{fn(PEOPLE[k])}catch{}}
  function renderWho(){document.querySelectorAll('#whoSwitch [data-who]').forEach(b=>{const on=b.dataset.who===who;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on)})}
  document.querySelectorAll('#whoSwitch [data-who]').forEach(b=>b.addEventListener('click',()=>setWho(b.dataset.who)));

  /* ── Login gate ─────────────────────────────────────────────── */
  const gate=$('#gate');

  function showGate(msg){document.body.classList.add('locked');gate.hidden=false;const e=$('#gateError');e.textContent=msg||'';e.hidden=!msg;if(msg){gate.querySelector('.gate-card').classList.remove('shake');void gate.offsetWidth;gate.querySelector('.gate-card').classList.add('shake')}}
  function unlock(session){user={id:session.user.id,email:session.user.email,name:PEOPLE[who]};document.body.classList.remove('locked');gate.hidden=true;$('#whoSwitch').hidden=false;renderWho();$('#signOut').hidden=false}

  $('#gateForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!sb)return showGate('Sign-in service is still loading — try again in a moment.');
    const password=$('#gatePassword').value;
    if(!password)return showGate('Enter the password.');
    const btn=$('#gateSubmit');btn.disabled=true;btn.textContent='Signing in…';
    const {data,error}=await sb.auth.signInWithPassword({email:`${DEFAULT_WHO}@${EMAIL_DOMAIN}`,password});
    btn.disabled=false;btn.textContent='Enter';
    if(error||!data?.session){$('#gatePassword').value='';$('#gatePassword').focus();return showGate(/invalid/i.test(error?.message||'')?'Wrong password.':(error?.message||'Could not sign in.'))}
    resolveReady(unlockAndReturn(data.session));
  });
  $('#signOut').addEventListener('click',async()=>{try{await sb?.auth.signOut()}catch{}location.reload()});
  function unlockAndReturn(session){unlock(session);return user}

  let resolveReady;
  const ready=new Promise(res=>{resolveReady=res});
  (async()=>{
    const lib=await waitForLibrary();
    if(!lib){showGate('Sign-in service failed to load. Check your connection and reload.');return}
    sb=lib.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
    const {data}=await sb.auth.getSession();
    if(data?.session)resolveReady(unlockAndReturn(data.session));else showGate('');
    sb.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||(!session&&event!=='INITIAL_SESSION'))showGate('Signed out.')});
  })();

  /* ── Data ───────────────────────────────────────────────────── */
  async function load(){
    const {data,error}=await sb.from(TABLE).select('*');
    if(error)throw error;
    return data||[];
  }
  // Upsert a partial row for one listing. patch: {favorite?,hidden?,compare?,note?}
  async function set(listing_id,patch){
    const row={listing_id:String(listing_id),...patch,updated_by:user?.name||null,updated_at:new Date().toISOString()};
    const {error}=await sb.from(TABLE).upsert(row,{onConflict:'listing_id'});
    if(error)throw error;
    return row;
  }
  async function setMany(rows){
    if(!rows.length)return;
    const stamped=rows.map(r=>({...r,listing_id:String(r.listing_id),updated_by:user?.name||null,updated_at:new Date().toISOString()}));
    const {error}=await sb.from(TABLE).upsert(stamped,{onConflict:'listing_id'});
    if(error)throw error;
  }
  function subscribe(){
    sb.channel('shortlist-live')
      .on('postgres_changes',{event:'*',schema:'public',table:TABLE},payload=>{const row=payload.new&&Object.keys(payload.new).length?payload.new:payload.old;for(const fn of listeners)try{fn(row,payload.eventType)}catch(e){console.warn(e)}})
      .subscribe(status=>{if(status!=='SUBSCRIBED')console.warn('realtime:',status);window.dispatchEvent(new CustomEvent('hh-realtime',{detail:status}))});
  }
  const onChange=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};

  return {ready,get user(){return user},get who(){return PEOPLE[who]},setWho,onWho:fn=>{whoListeners.add(fn)},load,set,setMany,subscribe,onChange,PEOPLE};
})();
