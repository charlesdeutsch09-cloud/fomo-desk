// Hand-drawn canvas charts. No library. devicePixelRatio aware.
(function () {
  function setup(cv, h) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || cv.parentNode.clientWidth;
    cv.style.height = h + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  function dashed(ctx, x0, x1, y, color, dash) {
    ctx.save(); ctx.strokeStyle = color; ctx.setLineDash(dash || [3, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.restore();
  }
  const MARK = { buy: '#0a84ff', win: '#00d35a', loss: '#ff453a' };

  // points: [[t, v], ...]; start: value of dashed baseline; marks: [{t, kind, label}]
  function line(cv, points, start, marks, h) {
    const { ctx, w } = setup(cv, h = h || 220);
    const padTop = 34, padBot = 10;
    if (!points || points.length < 2) {
      dashed(ctx, 0, w, h / 2, 'rgba(235,235,245,0.3)', [4, 5]);
      return;
    }
    const t0 = points[0][0], t1 = points[points.length - 1][0] || t0 + 1;
    let lo = Math.min(...points.map(p => p[1]), start ?? Infinity), hi = Math.max(...points.map(p => p[1]), start ?? -Infinity);
    if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
    const X = t => ((t - t0) / Math.max(1, t1 - t0)) * w, Y = v => padTop + (1 - (v - lo) / (hi - lo)) * (h - padTop - padBot);
    // fill
    const g = ctx.createLinearGradient(0, padTop, 0, h);
    g.addColorStop(0, 'rgba(0,211,90,0.22)'); g.addColorStop(1, 'rgba(0,211,90,0)');
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
    ctx.lineTo(X(t1), h); ctx.lineTo(X(t0), h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
    ctx.strokeStyle = '#00d35a'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    if (start != null) dashed(ctx, 0, w, Y(start), 'rgba(235,235,245,0.3)');
    // marks: never overlap -> a later mark that would collide moves up a row
    const placed = []; ctx.font = '600 11px -apple-system, sans-serif';
    (marks || []).filter(m => m.t >= t0 && m.t <= t1 + 60).sort((a, b) => a.t - b.t).forEach(m => {
      let v = points[0][1]; for (const p of points) { if (p[0] <= m.t) v = p[1]; else break; }
      const x = Math.min(Math.max(X(m.t), 4), w - 4), y = Y(v), tw = ctx.measureText(m.label).width + 12;
      let bx = Math.min(Math.max(x - tw / 2, 2), w - tw - 2), row = 0, by;
      for (;;) { by = Math.max(2, y - 26 - row * 22); if (!placed.some(r => bx < r.x + r.w + 4 && bx + tw + 4 > r.x && Math.abs(by - r.y) < 20)) break; row++; if (row > 8) break; }
      placed.push({ x: bx, y: by, w: tw });
      const c = MARK[m.kind] || '#fff';
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill();
      ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, tw, 18, 9) : ctx.rect(bx, by, tw, 18); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = m.kind === 'buy' ? '#fff' : '#000'; ctx.fillText(m.label, bx + 6, by + 13);
    });
  }

  // candles: [[t, o, h, l, c, vol]], lines: [{price, color, label, dash}]
  function candles(cv, cs, lines, h) {
    const { ctx, w } = setup(cv, h = h || 260);
    const volH = 44, top = 12, bot = h - volH - 8;
    if (!cs || !cs.length) { dashed(ctx, 0, w, bot / 2, 'rgba(235,235,245,0.3)'); return; }
    let lo = Math.min(...cs.map(c => c[3])), hi = Math.max(...cs.map(c => c[2]));
    (lines || []).forEach(l => { if (l.price) { lo = Math.min(lo, l.price); hi = Math.max(hi, l.price); } });
    if (hi - lo < hi * 1e-6) { hi *= 1.01; lo *= 0.99; }
    const n = Math.max(cs.length, 30), bw = w / n, Y = v => top + (1 - (v - lo) / (hi - lo)) * (bot - top);
    const vmax = Math.max(...cs.map(c => c[5] || 0), 1e-9), off = n - cs.length;
    cs.forEach((c, i) => {
      const x = (i + off) * bw + bw / 2, up = c[4] >= c[1], col = up ? '#00d35a' : '#ff453a';
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(c[2])); ctx.lineTo(x, Y(c[3])); ctx.stroke();
      const y0 = Y(Math.max(c[1], c[4])), y1 = Y(Math.min(c[1], c[4]));
      ctx.fillRect(x - bw * 0.35, y0, bw * 0.7, Math.max(1, y1 - y0));
      const vh = ((c[5] || 0) / vmax) * volH; ctx.globalAlpha = 0.45; ctx.fillRect(x - bw * 0.35, h - vh, bw * 0.7, vh); ctx.globalAlpha = 1;
    });
    ctx.font = '600 11px -apple-system, sans-serif';
    (lines || []).forEach(l => { if (!l.price) return; const y = Y(l.price); dashed(ctx, 0, w, y, l.color, l.dash || [5, 4]);
      ctx.fillStyle = l.color; ctx.fillText(l.label, 6, y - 5); });
  }
  window.Charts = { line, candles };
})();
