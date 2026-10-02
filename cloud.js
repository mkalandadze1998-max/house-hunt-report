'use strict';
/* ── House Hunt · shared state & login (Supabase) ────────────────────
   Two accounts (Aslani, Mariami) share one password; the login screen
   shows name buttons + a password field. Favorites, hidden listings,
   the compare set and notes live in the `shortlist` table and sync
   live between devices. The publishable key is safe to embed: row-level
   security only lets signed-in users read or write.                   */
window.HH_CLOUD=(()=>{
  const SUPABASE_URL='https://wqdoifhpeslhhlcfhzdq.supabase.co';
  const SUPABASE_KEY='sb_publishable_GdGmHZ0bqB835LzHw6Wuag_cPBRr_b2';
  const PEOPLE={aslani:'Aslani',mariami:'Mariami'};
  const EMAIL_DOMAIN='house-hunt.local';
  const TABLE='shortlist';

  const $=s=>document.querySelector(s);
  const sb=window.supabase?window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true}}):null;
  let user=null;             // {id,email,name}
  const listeners=new Set(); // change callbacks (row)=>void
  const nameOf=email=>PEOPLE[String(email||'').split('@')[0]]||String(email||'').split('@')[0]||'someone';

  /* ── Login gate ─────────────────────────────────────────────── */
  const gate=$('#gate');
  let who=null;try{who=localStorage.getItem('house-hunt-who')}catch{}
  function pick(k){who=k;try{localStorage.setItem('house-hunt-who',k)}catch{}gate.querySelectorAll('[data-who]').forEach(b=>{const on=b.dataset.who===k;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on)});$('#gatePassword').focus()}
  gate.querySelectorAll('[data-who]').forEach(b=>b.addEventListener('click',()=>pick(b.dataset.who)));
  if(who&&PEOPLE[who])pick(who);

  function showGate(msg){document.body.classList.add('locked');gate.hidden=false;const e=$('#gateError');e.textContent=msg||'';e.hidden=!msg;if(msg){gate.querySelector('.gate-card').classList.remove('shake');void gate.offsetWidth;gate.querySelector('.gate-card').classList.add('shake')}}
  function unlock(session){user={id:session.user.id,email:session.user.email,name:nameOf(session.user.email)};document.body.classList.remove('locked');gate.hidden=true;$('#whoami').textContent=user.name;$('#whoami').hidden=false;$('#signOut').hidden=false}

  $('#gateForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!sb)return showGate('Sign-in service failed to load. Check your connection and reload.');
    if(!who||!PEOPLE[who])return showGate('Pick who you are first.');
    const password=$('#gatePassword').value;
    if(!password)return showGate('Enter the password.');
    const btn=$('#gateSubmit');btn.disabled=true;btn.textContent='Signing in…';
    const {data,error}=await sb.auth.signInWithPassword({email:`${who}@${EMAIL_DOMAIN}`,password});
    btn.disabled=false;btn.textContent='Enter';
    if(error||!data?.session){$('#gatePassword').value='';$('#gatePassword').focus();return showGate(/invalid/i.test(error?.message||'')?'Wrong password.':(error?.message||'Could not sign in.'))}
    resolveReady(unlockAndReturn(data.session));
  });
  $('#signOut').addEventListener('click',async()=>{try{await sb?.auth.signOut()}catch{}location.reload()});
  function unlockAndReturn(session){unlock(session);return user}

  let resolveReady;
  const ready=new Promise(res=>{resolveReady=res});
  (async()=>{
    if(!sb){showGate('Sign-in service failed to load. Check your connection and reload.');return}
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
      .subscribe();
  }
  const onChange=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};

  return {ready,get user(){return user},load,set,setMany,subscribe,onChange,nameOf,PEOPLE};
})();
