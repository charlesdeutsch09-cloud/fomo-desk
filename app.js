// Desk iPhone app. Plan B: polls encrypted JSON under d/{dir}/ every 15 s. No secrets in this file.
(function () {
  'use strict';
  const POLL = 15, STALE_S = 300;
  const $ = s => document.querySelector(s);
  const view = $('#view'), overlay = $('#overlay'), offline = $('#offline');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = (v, d = 2) => v == null ? '—' : (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const big = v => v == null ? '—' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : usd(v);
  const pct = (v, d = 2) => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%';
  const tm = iso => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const px = p => p == null ? '—' : p >= 1 ? '$' + p.toFixed(4) : '$' + p.toPrecision(4);
  const ext = (href, inner, cls) => `<a class="${cls || ''}" href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>`;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- data channel ----------
  let dp = null, dir = null, aesKey = null, hmacKey = null;
  const D = { state: null, chart: null, activity: null, agents: null, account: null, coins: {} };
  let lastOk = 0, failing = false, nextTry = 0, tab = 'home', range = 'LIVE', actShown = 30, searchQ = '', route = null;

  function readFragment() {
    const m = location.hash.match(/[#&]d=([^&]+)/);
    if (m) { localStorage.setItem('dp', decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname + location.search); }
    return localStorage.getItem('dp');
  }
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function derive(p) {
    const enc = new TextEncoder();
    dir = hex(await crypto.subtle.digest('SHA-256', enc.encode('desk-dir:' + p))).slice(0, 40);
    const base = await crypto.subtle.importKey('raw', enc.encode(p), 'HKDF', false, ['deriveBits']);
    const raw = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('desk-salt-v1'), info: enc.encode('desk-enc-v1') }, base, 256);
    aesKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    hmacKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  async function coinKey(mint) { return hex(await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(mint))).slice(0, 24); }
  async function getJSON(name) {
    const r = await fetch(`d/${dir}/${name}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(j.iv) }, aesKey, b64(j.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  async function poll() {
    try {
      const [st, ch, ac, ag, acc] = await Promise.all(['state.json', 'chart.json', 'activity.json', 'agents.json', 'account.json'].map(getJSON));
      Object.assign(D, { state: st, chart: ch, activity: ac, agents: ag, account: acc });
      if (route && route.key) { try { D.coins[route.key] = await getJSON(`coin/${route.key}.json`); } catch (e) { } }
      lastOk = Date.now(); failing = (Date.now() - Date.parse(st.generatedAt)) / 1000 > STALE_S;
    } catch (e) { failing = true; }
    nextTry = Date.now() + POLL * 1000;
    render();
  }
  function tickOffline() {
    if (!failing) { offline.classList.add('hidden'); return; }
    const n = Math.max(0, Math.ceil((nextTry - Date.now()) / 1000));
    const last = D.state ? tm(D.state.generatedAt) : (lastOk ? tm(new Date(lastOk).toISOString()) : 'never');
    offline.textContent = `Desk offline · retrying in ${n}s · last update ${last}`;
    offline.classList.remove('hidden');
  }

  // ---------- pieces ----------
  const skel = (h, w) => `<div class="skel" style="height:${h}px;${w ? 'width:' + w : ''};margin:10px 0"></div>`;
  const paperPill = () => D.state && D.state.mode === 'PAPER' ? '<span class="pill paper">PAPER</span>' : '';
  const ICON = { bought: '↓', sold: '↑', stopped: '×', rejected: '–' };
  function actRow(r) {
    return `<li class="row" data-open="${r.kind === 'rejected' ? 'audit' : 'coin'}" data-key="${esc(r.key)}" data-mint="${esc(r.mint)}">
      <div class="ic ${r.kind}">${ICON[r.kind] || '•'}</div>
      <div class="mid"><div class="t">${esc(r.title)}</div><div class="s">${esc(r.subtitle)}</div></div>
      <div class="v ${r.kind === 'sold' ? 'up' : r.kind === 'stopped' ? 'down' : ''}">${esc(r.value)}</div></li>`;
  }
  function statusDot(a) {
    return a.paused ? '<span class="status off"><i></i>Paused</span>' : a.running ? '<span class="status"><i></i>Running</span>' : '<span class="status off"><i></i>Not running</span>';
  }
  function ringSVG(score, min) {
    const r = 44, c = 2 * Math.PI * r, s = Math.max(0, Math.min(100, score || 0)), col = s >= (min || 70) ? '#00d35a' : '#ffd60a';
    return `<svg class="ring" viewBox="0 0 110 110"><circle cx="55" cy="55" r="${r}" stroke="#2c2c2e" stroke-width="9" fill="none"/>
      <circle cx="55" cy="55" r="${r}" stroke="${col}" stroke-width="9" fill="none" stroke-linecap="round" stroke-dasharray="${c * s / 100} ${c}" transform="rotate(-90 55 55)"/>
      <text x="55" y="63" text-anchor="middle" fill="#fff" font-size="26" font-weight="600" font-family="-apple-system">${score == null ? '–' : s}</text></svg>`;
  }
  const COLORS = { scanner: '#64d2ff', auditor: '#fff', analyst: '#ffd60a', executor: '#00d35a', risk: '#ff6b9a' };
  const NAMES = { scanner: 'Scanner', auditor: 'Auditor', analyst: 'Analyst', executor: 'Executor', risk: 'Risk' };

  function cardBody(name, a) {
    if (name === 'scanner') {
      if (!a.feed.length) return `<div class="sub">Listening for graduations${a.waiting ? ` · ${a.waiting} waiting` : ''}</div>`;
      return `<div class="sub" style="margin-bottom:4px">${a.waiting} in the waiting room</div><ul class="feed">${a.feed.slice(0, 4).map(f =>
        `<li class="${f.verdict === 'pass' ? 'passed' : 'killed'}"><span class="k">${esc(f.name)}</span><span class="r">${f.verdict === 'pass' ? '→ auditor' : esc(f.reason)}</span></li>`).join('')}</ul>`;
    }
    if (name === 'auditor') {
      const c = a.current;
      if (!c) return '<div class="sub">No coin taken apart yet</div>';
      const strips = Array.from({ length: 8 }, (_, i) => { const l = c.layers.find(x => x.n === i + 1); return `<b class="${l ? (l.pass === 1 ? 'ok' : l.pass === 0 ? 'bad' : '') : ''}"></b>`; }).join('');
      return `<div class="strips">${strips}</div><div style="font-weight:600">${esc(c.name)}</div>
        <div class="sub ${c.done && !c.passed ? 'down' : ''}">${esc(c.status)}</div><div class="sub" style="margin-top:8px">${a.rejected} rejected</div>`;
    }
    if (name === 'analyst') {
      const l = a.last;
      return `<div style="display:flex;align-items:center;gap:14px">${ringSVG(l ? l.score : null, a.minScore)}
        <div>${l ? `<div style="font-weight:600">${esc(l.name)}</div><div class="sub">${l.passed ? '→ Executor' : esc(l.reason)}</div>` : '<div class="sub">Nothing scored yet</div>'}
        <div class="sub" style="margin-top:6px">${a.mode === 'rules' ? 'Rules mode' : 'Jev'}</div></div></div>`;
    }
    if (name === 'executor') {
      const l = a.last;
      if (!l) return `<div class="sub">${a.stackPct}% of stack per coin · waiting for a clear coin</div>`;
      const filled = l.status === 'bought' || l.status === 'sent';
      return `<div style="font-weight:600">${esc(l.name)}</div><div class="sub">${l.sizeUsd != null ? usd(l.sizeUsd) + ' · ' + l.stackPct + '% of stack' : esc(l.reason || 'skipped')}</div>
        ${l.sizeUsd != null ? `<div class="bar"><i data-fill style="width:${reduce ? 100 : 0}%"></i></div><div class="sub">${filled ? '✓ Filled' : esc(l.status)}</div>` : ''}`;
    }
    if (name === 'risk') {
      const l = a.lastExit;
      return `<div style="display:flex;gap:8px;margin-bottom:10px"><span class="pill red mono">stop -${a.stopPct}%</span><span class="pill green mono">trail ${a.trailPct}%</span></div>
        <div class="sub">${a.open ? a.open + ' open position' + (a.open > 1 ? 's' : '') : 'No open positions'}</div>
        ${l ? `<div style="margin-top:6px">${esc(l.label)} · ${esc(l.name)} <span class="${l.pnlUsd >= 0 ? 'up' : 'down'}">${usd(l.pnlUsd)}</span></div>` : ''}`;
    }
    return '';
  }
  function agentCard(name, a) {
    const w = Math.min(window.innerWidth - 32, 480);
    return `<div class="card acard" style="border-radius:${(42 * w / 504).toFixed(1)}px">
      <div class="head"><span class="aname" style="color:${COLORS[name]}">${NAMES[name]}</span>${statusDot(a)}</div>
      <div class="count">${esc(a.headline)}</div><div class="body">${cardBody(name, a)}</div></div>`;
  }

  // ---------- screens ----------
  function home() {
    const s = D.state;
    if (!s) return `${skel(44)}${skel(80, '70%')}${skel(220)}${skel(40)}${skel(200)}`;
    const unread = (s.pushes || []).some(p => p.id > +(localStorage.getItem('lastPush') || 0));
    const results = searchQ ? (s.coins || []).filter(c => [c.name, c.symbol, c.mint].some(x => x && x.toLowerCase().includes(searchQ.toLowerCase()))).slice(0, 8) : [];
    const ch = D.chart, pts = ch ? ch.ranges[range] || [] : [];
    const acts = (D.activity ? D.activity.rows : []).slice(0, 5);
    const running = Object.values(s.agents).filter(a => a.running && !a.paused).length;
    const notice = (s.notices || [])[0];
    return `<div class="nav"><button class="avatar" data-tab-go="account" aria-label="Account">C</button>
      <div class="navtitle">Grok Bot <span class="chev">›</span></div>
      <button class="iconbtn" data-act="search" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg></button>
      <button class="iconbtn" data-act="bell" aria-label="Pushes"><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15zM10 20.5a2.2 2.2 0 004 0"/></svg>${unread ? '<i class="dot"></i>' : ''}</button></div>
      <input id="search" class="search ${searchQ || route === 'search' ? '' : 'hidden'}" placeholder="Name, symbol or mint" value="${esc(searchQ)}" autocomplete="off">
      ${results.length ? `<ul class="rows results">${results.map(c => `<li class="row" data-open="coin" data-key="${esc(c.key)}"><div class="mid"><div class="t">${esc(c.name || c.mint)}</div><div class="s">${esc(c.symbol || '')} · ${esc(c.mint.slice(0, 6))}…</div></div></li>`).join('')}</ul>` : searchQ ? '<div class="empty">No coin matches</div>' : ''}
      <div class="balance-row"><span class="big">${usd(s.balance)}</span>${paperPill()}</div>
      <div class="today"><span class="${s.todayPct >= 0 ? 'up' : 'down'}">${pct(s.todayPct)} today</span><span class="pill mult">${s.multiplier.toFixed(2)}×</span></div>
      ${notice ? `<div class="note">${esc(notice.text)}</div>` : ''}
      <div class="chartwrap"><canvas id="cv-home"></canvas>${(ch && ch.marks.length) ? '' : '<div class="empty-note">Waiting for the first trade</div>'}</div>
      <div class="ranges">${['LIVE', '1H', '4H', '1D', '1W', 'ALL'].map(r => `<button data-range="${r}" class="${r === range ? 'on' : ''}">${r}</button>`).join('')}</div>
      <div class="section"><h2>Agents · ${running} running</h2></div>
      <div class="carousel">${['scanner', 'auditor', 'analyst', 'executor', 'risk'].map(n => agentCard(n, s.agents[n])).join('')}</div>
      <div class="section"><h2>Activity</h2><button class="link" data-tab-go="activity">See all</button></div>
      ${acts.length ? `<ul class="rows">${acts.map(actRow).join('')}</ul>` : '<div class="empty">Nothing yet tonight</div>'}`;
  }
  function agentsTab() {
    const s = D.state, ag = D.agents;
    if (!s || !ag) return `<h1 class="title">Agents</h1>${skel(220)}${skel(220)}`;
    return `<h1 class="title">Agents</h1>` + ['scanner', 'auditor', 'analyst', 'executor', 'risk'].map(n => {
      const a = s.agents[n], ds = ag.decisions[n] || [];
      return `<div class="card" style="margin-bottom:14px"><div class="head" style="display:flex;justify-content:space-between;align-items:center">
        <span class="aname" style="color:${COLORS[n]};font-weight:600;font-size:20px">${NAMES[n]}</span>${statusDot(a)}</div>
        <div class="sub" style="margin:6px 0 10px">${esc(a.headline)} · today ${a.today} · ${a.paused ? 'paused' : 'not paused'} <span style="color:var(--t3)">(change in chat)</span></div>
        ${ds.length ? `<ul class="feed">${ds.map(d => `<li><span class="k">${tm(d.ts)} · ${d.link ? ext(d.link, esc(d.name || '')) : esc(d.name || '')}</span><span class="r ${/reject|kill|stop|skip|drop/.test(d.verdict) ? 'down' : ''}">${esc(d.verdict)} · ${esc(d.reason || '')}</span></li>`).join('')}</ul>`
          : `<div class="sub">${n === 'scanner' ? 'Listening for graduations' : n === 'auditor' ? 'No coin taken apart yet' : 'No decisions yet tonight'}</div>`}
        <button class="link" data-settings="${n}" style="color:var(--green);margin-top:10px;min-height:44px">Settings ›</button></div>`;
    }).join('');
  }
  function activityTab() {
    if (!D.activity) return `<h1 class="title">Activity</h1>${skel(60)}${skel(60)}${skel(60)}`;
    const rows = D.activity.rows;
    return `<h1 class="title">Activity</h1>${rows.length ? `<ul class="rows">${rows.slice(0, actShown).map(actRow).join('')}</ul>
      ${rows.length > actShown ? '<button class="btn sec" data-act="more" style="margin-top:14px">Show more</button>' : ''}` : '<div class="empty">Nothing yet tonight</div>'}`;
  }
  function accountTab() {
    const a = D.account;
    if (!a) return `<h1 class="title">Account</h1>${skel(48)}${skel(48)}${skel(200)}`;
    const groups = Object.entries(a.settings).map(([g, items]) => `<div class="group-title" id="set-${g}">${g.charAt(0).toUpperCase() + g.slice(1)}</div>
      <div class="list">${items.map(i => `<div class="kv"><span class="k mono" style="font-size:13px">${esc(i.key.split('.').slice(1).join('.'))}</span><span class="v">${esc(i.display)}</span></div>`).join('')}</div>`).join('');
    return `<h1 class="title">Account</h1>
      <div class="list"><div class="kv"><span class="k">Mode</span><span class="v">${a.mode === 'PAPER' ? '<span class="pill paper">PAPER</span>' : 'LIVE'}</span></div>
      <div class="kv"><span class="k">Stack</span><span class="v">${usd(a.stack)}</span></div>
      <div class="kv"><span class="k">Notifier</span><span class="v">Discord · ${a.notifier.connected ? '<span class="up">connected</span>' : '<span class="down">not connected</span>'}</span></div></div>
      <div class="list">${ext(a.profileUrl, `<div class="kv"><span class="k">Your FOMO profile</span><span class="v">@${esc(a.fomoHandle)} ›</span></div>`)}
      <button class="kv" style="width:100%" data-act="invite"><span class="k">Invite a friend</span><span class="v">Share ›</span></button></div>
      <div class="note">Mode, stack, pause and settings are read-only here. Change them in the Grok Bot chat, e.g. “set stop to -8%”.</div>
      ${groups}`;
  }
  function coinScreen(c) {
    if (!c) return `<button class="back" data-act="back">‹ Back</button>${skel(40, '60%')}${skel(60, '50%')}${skel(260)}${skel(120)}`;
    const p = c.position, ch = p ? (c.price / p.entryPrice - 1) * 100 : null, au = c.audit;
    const age = c.ageHours == null ? '' : ` · ${c.ageHours < 1 ? Math.round(c.ageHours * 60) + 'm' : Math.round(c.ageHours) + 'h'} old`;
    const left = p ? Math.max(0, p.timeoutAt - Date.now() / 1000) : 0;
    return `<button class="back" data-act="back">‹ Back</button>
      <div style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:24px;font-weight:700">${esc(c.name || c.mint.slice(0, 8))} ${p ? paperPill() : ''}</div>
      <div class="sub">${esc(c.symbol || '')} · Solana${age}</div></div>
      ${c.shield ? `<button class="chip ${au && au.passed ? '' : 'bad'}" data-open="audit" data-key="${esc(route.key)}">🛡 ${esc(c.shield)}</button>` : ''}</div>
      <div class="price" style="margin-top:10px">${px(c.price)}</div>
      ${p ? `<div class="${ch >= 0 ? 'up' : 'down'}" style="font-size:17px">${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch).toFixed(2)}% since entry</div>` : ''}
      <div class="chartwrap" style="margin-top:10px"><canvas id="cv-coin"></canvas>${c.candles.length ? '' : '<div class="empty-note">No candles yet</div>'}</div>
      <div class="stats"><div class="stat"><div class="k">Market cap</div><div class="v">${big(c.stats.marketCap)}</div></div>
      <div class="stat"><div class="k">Liquidity</div><div class="v">${big(c.stats.liquidityUsd)}</div></div>
      <div class="stat"><div class="k">24h volume</div><div class="v">${big(c.stats.volume24h)}</div></div>
      <div class="stat"><div class="k">Holders</div><div class="v">${c.stats.holders ?? 'n/a'}</div></div></div>
      ${p ? `<div class="card" style="margin-bottom:14px"><div style="font-weight:600">Your position · ${usd(p.sizeUsd)} in · Executor</div>
        <div class="kv"><span class="k">Stop line</span><span class="v down">${px(p.stopPrice)} · -${p.stopPct}%</span></div>
        <div class="kv"><span class="k">Trail line</span><span class="v">${p.trailActive ? px(p.trailPrice) + ' · ' + p.trailPct + '% off top' : 'starts at ' + px(p.trailStartPrice)}</span></div>
        <div class="kv"><span class="k">Timeout</span><span class="v">${Math.floor(left / 3600)}h ${Math.floor(left % 3600 / 60)}m left</span></div></div>` : ''}
      ${ext(c.coinUrl, p ? 'Sell on FOMO' : 'Buy on FOMO', 'btn')}`;
  }
  function auditScreen(c) {
    if (!c) return `<button class="back" data-act="back">‹ Back</button>${skel(200)}${skel(300)}`;
    const a = c.audit, name = esc(c.name || c.mint.slice(0, 8));
    if (!a) return `<button class="back" data-act="back">‹ Back</button><div class="empty">No coin taken apart yet</div>`;
    const cls = l => l.pass === 1 ? 'ok' : l.pass === 0 ? 'bad' : 'nc';
    const on = D.account ? D.account.settings.auditor.find(i => i.key === 'auditor.enabled').value : true;
    return `<button class="back" data-act="back">‹ Back</button>
      <div style="font-size:24px;font-weight:700">${name}</div><div class="sub">Auditor · ${tm(a.ts)}</div>
      <div class="discs">${a.layers.map(l => `<div class="disc ${cls(l)}"></div>`).join('')}</div>
      ${a.done ? (a.passed ? `<div class="verdict up">Cleared · 8/8 parts</div><div class="sub">${a.sentUsd ? 'Sent to Executor · ' + usd(a.sentUsd) : 'Sent to Analyst'}</div>`
        : `<div class="verdict down">Rejected · ${esc(a.reason)}</div><div class="sub">Grok Bot won't buy ${name}</div>`) : '<div class="verdict">taking apart...</div>'}
      <div class="list" style="margin-top:16px">${a.layers.map(l => `<div class="kv layer-row"><span class="mark ${cls(l)}">${l.pass === 1 ? '✓' : l.pass === 0 ? '✗' : '·'}</span>
        <span class="k" style="flex:1">${l.n} · ${esc(l.name)}</span><span class="v ${cls(l) === 'bad' ? 'down' : ''}">${esc(l.value)}</span></div>`).join('')}</div>
      <div class="list"><div class="kv"><span class="k">Take apart before buying</span><span class="toggle ${on ? 'on' : ''}" aria-disabled="true"></span></div></div>
      <div class="note">Read-only here; change it in chat.</div>
      ${ext(c.coinUrl, 'Open on FOMO', 'btn')}`;
  }

  // ---------- render ----------
  function render() {
    tickOffline();
    document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    if (route && route.screen) {
      overlay.classList.remove('hidden');
      const c = D.coins[route.key];
      overlay.innerHTML = route.screen === 'coin' ? coinScreen(c) : auditScreen(c);
      if (c && route.screen === 'coin') {
        const p = c.position, lines = [];
        if (p) { lines.push({ price: p.exitLine, color: '#ff9f0a', label: 'Risk trailing stop' }); lines.push({ price: p.entryPrice, color: 'rgba(235,235,245,0.3)', label: 'Entry', dash: [2, 4] }); }
        Charts.candles($('#cv-coin'), c.candles, lines);
      }
    } else overlay.classList.add('hidden');
    const sy = window.scrollY, cs = document.querySelector('.carousel'), cx = cs ? cs.scrollLeft : 0;
    const focus = document.activeElement && document.activeElement.id === 'search';
    view.innerHTML = tab === 'home' ? home() : tab === 'agents' ? agentsTab() : tab === 'activity' ? activityTab() : accountTab();
    if (tab === 'home' && D.state) {
      const cv = $('#cv-home'); if (cv) Charts.line(cv, D.chart ? D.chart.ranges[range] : [], D.chart ? D.chart.start : null, D.chart ? D.chart.marks : []);
      const c2 = document.querySelector('.carousel'); if (c2) c2.scrollLeft = cx;
      requestAnimationFrame(() => document.querySelectorAll('[data-fill]').forEach(e => e.style.width = '100%'));
      if (focus) { const i = $('#search'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    }
    window.scrollTo(0, sy);
  }

  async function openCoin(screen, key, mint) {
    if (!key && mint) key = await coinKey(mint);
    route = { screen, key }; render();
    try { D.coins[key] = await getJSON(`coin/${key}.json`); } catch (e) { D.coins[key] = D.coins[key] || null; }
    render();
  }
  function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 1800); }
  function showPushes() {
    const ps = (D.state && D.state.pushes) || [];
    if (ps.length) localStorage.setItem('lastPush', ps[0].id);
    route = { screen: null };
    overlay.classList.remove('hidden');
    overlay.innerHTML = `<button class="back" data-act="back">‹ Back</button><h1 class="title">Pushes</h1>${ps.length ? `<ul class="rows">${ps.map(p =>
      `<li class="row">${ext(p.link, `<div class="mid"><div class="t">${esc(p.text)}</div><div class="s">${tm(p.ts)}</div></div>`)}</li>`).join('')}</ul>` : '<div class="empty">No pushes yet</div>'}`;
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-tab],[data-tab-go],[data-range],[data-open],[data-act],[data-settings]');
    if (!t) return;
    if (t.dataset.tab || t.dataset.tabGo) { tab = t.dataset.tab || t.dataset.tabGo; route = null; overlay.classList.add('hidden'); window.scrollTo(0, 0); render(); return; }
    if (t.dataset.range) { range = t.dataset.range; render(); return; }
    if (t.dataset.settings) { tab = 'account'; render(); const el = document.getElementById('set-' + t.dataset.settings); if (el) el.scrollIntoView(); return; }
    if (t.dataset.open) { openCoin(t.dataset.open, t.dataset.key, t.dataset.mint); return; }
    const a = t.dataset.act;
    if (a === 'back') { route = null; overlay.classList.add('hidden'); render(); }
    else if (a === 'more') { actShown += 30; render(); }
    else if (a === 'search') { const i = $('#search'); i.classList.toggle('hidden'); if (!i.classList.contains('hidden')) i.focus(); else { searchQ = ''; render(); } }
    else if (a === 'bell') { showPushes(); }
    else if (a === 'invite' && D.account) {
      const url = D.account.signupUrl;
      if (navigator.share) navigator.share({ title: 'FOMO', url }).catch(() => { });
      else navigator.clipboard.writeText(url).then(() => toast('Link copied'), () => toast(url));
    }
  });
  document.addEventListener('input', e => { if (e.target.id === 'search') { searchQ = e.target.value; render(); } });

  async function boot() {
    dp = readFragment();
    if (!dp) { view.innerHTML = '<h1 class="title">Desk</h1><div class="empty">Open this app once with the private link Grok Bot sent you (it ends in #d=…).</div>'; return; }
    await derive(dp);
    render();
    await poll();
    setInterval(poll, POLL * 1000);
    setInterval(tickOffline, 1000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  }
  window.addEventListener('resize', () => render());
  boot();
})();
