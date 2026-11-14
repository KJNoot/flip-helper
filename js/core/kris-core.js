// Kris core (v1.10.0): the app-independent half of "Ask Kris". Memory on the phone, the request to the Kris proxy,
// the ```kris``` action block, reminders, and email/message drafts the USER sends. No UI and nothing app-specific here,
// so another app (e.g. Flip Side) can load this file and write only its own panel and "fill" handlers.
// Contract with the proxy: see worker/worker.js and KRIS-API.md (request: code, mode, text, image, history, memory, context, app).
(function (global) {
  'use strict';
  const MAX_FACTS = 40, MAX_TOPICS = 12, HIST_TURNS = 6, HIST_CHARS = 600;
  const ACTION_TYPES = ['remember', 'forget', 'fill', 'email', 'message', 'reminder'];
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const pad = n => String(n).padStart(2, '0');
  const localStamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function niceTime(d) { let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${pad(d.getMinutes())} ${ap}`; }
  function niceWhen(at, now) {
    const d = parseAt(at); if (!d) return at || '';
    now = now || new Date(); const same = (a, b) => a.toDateString() === b.toDateString(); const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1);
    return (same(d, now) ? 'today' : same(d, tmr) ? 'tomorrow' : `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`) + ' at ' + niceTime(d);
  }
  function parseAt(at) { const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)/.exec(String(at || '')); if (!m) return null; const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]); return isNaN(d) ? null : d; }
  // "Sat Nov 14 2026, 9:50 AM (America/Indianapolis)" — so Kris can work out "at 4" or "tomorrow"
  function nowText(d) { d = d || new Date(); let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { } return `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}, ${niceTime(d)} (${localStamp(d)}${tz ? ', ' + tz : ''})`; }

  // the reply's ```kris {...}``` block (same rules as the proxy; used if an older proxy left the block in the text)
  function parseActions(reply) {
    const actions = []; let change = '';
    let text = String(reply || '').replace(/```\s*kris\s*\n?([\s\S]*?)```/gi, (_, body) => {
      try { const o = JSON.parse(body.trim()); const list = Array.isArray(o) ? o : (o && Array.isArray(o.actions)) ? o.actions : []; for (const a of list) if (a && ACTION_TYPES.includes(a.type)) actions.push(a); } catch (e) { }
      return '';
    });
    text = text.replace(/\n?\s*CHANGE REQUEST:\s*(.+)\s*$/i, (_, s) => { change = s.trim(); return ''; }).trim();
    return { text, actions: actions.slice(0, 8), change };
  }

  // store: { get(key, default) -> Promise, set(key, value) -> Promise }  (Shift Report uses its IndexedDB "meta" store)
  function create(opts) {
    const store = opts.store, P = opts.prefix || 'kris';
    const K = { facts: P + 'Facts', topics: P + 'Topics', rem: P + 'Reminders' };
    const api = {};

    // ---------- memory: facts the user can see and delete, plus a short list of past chat topics ----------
    api.facts = async () => { const f = await store.get(K.facts, []); return Array.isArray(f) ? f : []; };
    api.addFacts = async list => {
      const f = await api.facts(), have = new Set(f.map(x => norm(x.t))), added = [];
      for (let t of list || []) { t = String(t || '').trim().slice(0, 200); if (!t || have.has(norm(t)) || /\b(password|passcode|pin|card number|cvv|ssn|social security)\b/i.test(t)) continue; f.push({ t, ts: Date.now() }); have.add(norm(t)); added.push(t); }
      await store.set(K.facts, f.slice(-MAX_FACTS)); return added;
    };
    api.removeFact = async i => { const f = await api.facts(); f.splice(i, 1); await store.set(K.facts, f); };
    api.forget = async match => { const m = norm(match); if (!m) return 0; const f = await api.facts(), keep = f.filter(x => !norm(x.t).includes(m)); await store.set(K.facts, keep); return f.length - keep.length; };
    api.topics = async () => { const t = await store.get(K.topics, []); return Array.isArray(t) ? t : []; };
    api.noteTopic = async text => {
      text = String(text || '').replace(/\s+/g, ' ').trim(); if (!text) return;
      const t = await api.topics(), d = new Date(), day = `${MON[d.getMonth()]} ${d.getDate()}`;
      t.push({ d: day, t: text.length > 90 ? text.slice(0, 88) + '…' : text });
      await store.set(K.topics, t.slice(-MAX_TOPICS));
    };
    api.summary = async () => (await api.topics()).map(x => `${x.d}: ${x.t}`).join('\n');
    api.clearMemory = async () => { await store.set(K.facts, []); await store.set(K.topics, []); };

    // log entries { who: 'me'|'ai'|'note', text, actions } -> the last few turns, trimmed (keeps each message cheap)
    api.history = log => log.filter(m => (m.who === 'me' || m.who === 'ai') && (m.text || m.img || m.actions)).slice(-HIST_TURNS * 2).map(m => {
      let t = m.text || (m.img ? '(photo)' : '');
      if (m.who === 'ai' && m.actions && m.actions.length) t += '\n[offered: ' + m.actions.map(a => a.type === 'fill' ? 'fill ' + a.target + (a.done ? ' (applied)' : '') : a.type + (a.done ? ' (done)' : '')).join(', ') + ']';
      return { role: m.who === 'me' ? 'user' : 'assistant', text: t.length > HIST_CHARS ? t.slice(0, HIST_CHARS) + '…' : t };
    });

    // ---------- the request ----------
    api.ask = async ({ text, image, mode, log, context, app }) => {
      const url = opts.url(); if (!url) return { ok: false, error: 'off' };
      const facts = (await api.facts()).map(x => x.t);
      const body = { code: await opts.code(), mode: mode || 'chat', text: text || '', image: image || null, history: api.history(log || []), memory: { facts, summary: await api.summary() }, context: context || '', app: Object.assign({ now: nowText() }, app || {}) };
      let res, j;
      try { res = await fetch(url.replace(/\/$/, '') + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); j = await res.json().catch(() => ({})); }
      catch (e) { return { ok: false, error: 'network' }; }
      if (!res.ok) return { ok: false, error: j.error || 'upstream', status: res.status };
      const p = parseActions(j.reply || '');
      const actions = (Array.isArray(j.actions) ? j.actions : []).concat(p.actions).filter(a => a && ACTION_TYPES.includes(a.type)).slice(0, 8);
      if (text) api.noteTopic(text).catch(() => { });
      return { ok: true, reply: p.text, actions, change: j.change || p.change || '', used: j.used || null };
    };

    // ---------- reminders (kept on the phone) ----------
    api.reminders = async () => { const r = await store.get(K.rem, []); return Array.isArray(r) ? r : []; };
    api.addReminder = async ({ at, text }) => { const d = parseAt(at); if (!d) return null; const r = await api.reminders(); const rem = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: localStamp(d), text: String(text || 'Reminder').slice(0, 300), done: false }; r.push(rem); await store.set(K.rem, r); return rem; };
    api.updateReminder = async (id, patch) => { const r = await api.reminders(); const x = r.find(y => y.id === id); if (x) Object.assign(x, patch); await store.set(K.rem, r.filter(y => !y.done || Date.now() - (y.doneAt || 0) < 864e5 * 7)); return x; };
    api.removeReminder = async id => store.set(K.rem, (await api.reminders()).filter(y => y.id !== id));
    api.due = async now => { now = now || new Date(); return (await api.reminders()).filter(y => !y.done && !y.shown && parseAt(y.at) <= now); };
    api.snooze = async (id, min) => { const d = new Date(Date.now() + (min || 15) * 60000); return api.updateReminder(id, { at: localStamp(d), shown: false }); };
    // a phone notification when allowed (works while the app is open or was used recently; phones don't wake a web app on a timer)
    api.askNotify = async () => { try { if (!('Notification' in global)) return 'unsupported'; if (Notification.permission === 'default') return await Notification.requestPermission(); return Notification.permission; } catch (e) { return 'unsupported'; } };
    api.notify = async (title, body) => {
      try {
        if (!('Notification' in global) || Notification.permission !== 'granted') return false;
        const reg = navigator.serviceWorker && await Promise.race([navigator.serviceWorker.getRegistration(), new Promise(r => setTimeout(r, 1500))]);
        if (reg && reg.showNotification) { await reg.showNotification(title, { body, tag: 'kris-reminder', icon: 'icons/icon-192.png' }); return true; }
        new Notification(title, { body }); return true;
      } catch (e) { return false; }
    };
    // an .ics calendar event with an alarm: the sure way to get a reminder on a locked phone
    api.ics = (rem, appName) => {
      const d = parseAt(rem.at) || new Date(), e = new Date(d.getTime() + 15 * 60000);
      const f = x => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
      const esc = s => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
      return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kris//Reminder//EN', 'BEGIN:VEVENT', 'UID:' + rem.id + '@kris', 'DTSTAMP:' + f(new Date()), 'DTSTART:' + f(d), 'DTEND:' + f(e), 'SUMMARY:' + esc(rem.text), 'DESCRIPTION:' + esc('Reminder from Kris' + (appName ? ' (' + appName + ')' : '')),
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(rem.text), 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
    };

    // ---------- drafts the user sends ----------
    const mailtoHref = (to, subject, body, cc) => 'mailto:' + encodeURIComponent(to || '').replace(/%40/g, '@').replace(/%2C/g, ',') + '?' + (cc ? 'cc=' + encodeURIComponent(cc) + '&' : '') + 'subject=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(body || '');
    api.mailtoHref = mailtoHref;
    // files: [File]. With files and a share sheet: share (To is copied, paste it). Otherwise: download the files and open the mail app.
    api.openEmail = async ({ to, cc, subject, body, files, toast, saveBlob }) => {
      toast = toast || (() => { }); files = (files || []).filter(Boolean);
      if (files.length) {
        let can = false; try { can = !!(navigator.canShare && navigator.canShare({ files })); } catch (e) { }
        if (can) {
          if (to) try { navigator.clipboard && navigator.clipboard.writeText(to).catch(() => { }); } catch (e) { }
          toast(to ? 'Pick your email app. The To address is copied: paste it, check it, then press Send.' : 'Pick your email app, check it, then press Send.', 7000);
          try { await navigator.share({ files, title: subject, text: (to ? 'To: ' + to + (cc ? '\nCc: ' + cc : '') + '\n\n' : '') + body }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
        }
        for (const f of files) { const b = new Uint8Array(await f.arrayBuffer()); if (saveBlob) saveBlob(b, f.name, f.type); }
        body = body + '\n\n(Attach: ' + files.map(f => f.name).join(', ') + ' — just saved to your Downloads.)';
      }
      const a = document.createElement('a'); a.href = mailtoHref(to, subject, body, cc); a.id = 'krisMailto'; a.hidden = true; document.body.append(a); a.click(); a.remove();
      toast('Your mail app opens. Check it, then press Send.', 5000); return 'mailto';
    };
    api.copy = async text => { try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; } };
    return api;
  }

  global.KrisCore = { create, parseActions, parseAt, niceWhen, nowText, localStamp };
})(typeof window !== 'undefined' ? window : globalThis);
