/**
 * Self-tests for kinematics / path sampling logic (mirrors test_model/script.js formulas).
 * Run: node kinematics_selftest.mjs
 */

import assert from "node:assert/strict";

function vecLen(x, y) {
  return Math.sqrt(x * x + y * y);
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1.x +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const y =
    0.5 *
    (2 * p1.y +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  return { x, y };
}

function buildSmoothPolyline(ctrl, closed) {
  if (!Array.isArray(ctrl) || ctrl.length < 2) return ctrl || [];
  const pts = ctrl.slice();
  const n = pts.length;
  const out = [];
  const get = (i) => pts[((i % n) + n) % n];
  const lastSeg = closed ? n : n - 1;
  for (let i = 0; i < lastSeg; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const L = Math.max(1e-6, Math.sqrt(dx * dx + dy * dy));
    const targetStep = 0.25;
    const steps = Math.max(12, Math.min(360, Math.ceil(L / targetStep)));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const q = catmullRom(p0, p1, p2, p3, t);
      if (!out.length || vecLen(q.x - out[out.length - 1].x, q.y - out[out.length - 1].y) > 1e-4) out.push(q);
    }
  }
  const endPt = closed ? out[0] : pts[pts.length - 1];
  if (!out.length || vecLen(endPt.x - out[out.length - 1].x, endPt.y - out[out.length - 1].y) > 1e-4) out.push({ x: endPt.x, y: endPt.y });
  return out;
}

function rebuildCache(ctrl, closed) {
  const poly = buildSmoothPolyline(ctrl, closed);
  const segs = [];
  let total = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) continue;
    segs.push({ i, a, b, dx, dy, len, start: total, end: total + len });
    total += len;
  }
  return { poly, segs, total, closed };
}

function sampleAtS(cache, s) {
  const { segs, total, closed } = cache;
  if (!segs.length || !Number.isFinite(total)) throw new Error("bad cache");
  if (closed) {
    s = ((s % total) + total) % total;
  } else {
    s = Math.max(0, Math.min(total, s));
  }
  if (s <= 1e-12) {
    const sg = segs[0];
    const tx = sg.dx / sg.len;
    const ty = sg.dy / sg.len;
    return { x: sg.a.x, y: sg.a.y, tx, ty };
  }
  if (s >= total - 1e-12) {
    const sg = segs[segs.length - 1];
    const tx = sg.dx / sg.len;
    const ty = sg.dy / sg.len;
    return { x: sg.b.x, y: sg.b.y, tx, ty };
  }
  const sg = segs.find((g) => s >= g.start && s <= g.end) || segs[segs.length - 1];
  const u = (s - sg.start) / sg.len;
  const tx = sg.dx / sg.len;
  const ty = sg.dy / sg.len;
  return { x: sg.a.x + sg.dx * u, y: sg.a.y + sg.dy * u, tx, ty };
}

function posRay(x0, y0, th, v0, a, t) {
  const d = v0 * t + 0.5 * a * t * t;
  return {
    x: x0 + d * Math.cos(th),
    y: y0 + d * Math.sin(th),
  };
}

function velRay(th, v0, a, t) {
  const s = v0 + a * t;
  return { vx: s * Math.cos(th), vy: s * Math.sin(th) };
}

function kinematicsFrame(frame, xa, ya, xb, yb, vxa, vya, vxb, vyb) {
  if (frame === "road") {
    return { xa, xb, ya, yb, vxa, vya, vxb, vyb };
  }
  if (frame === "a") {
    return { xa: 0, ya: 0, xb: xb - xa, yb: yb - ya, vxa: 0, vya: 0, vxb: vxb - vxa, vyb: vyb - vya };
  }
  return { xa: xa - xb, ya: ya - yb, xb: 0, yb: 0, vxa: vxa - vxb, vya: vya - vyb, vxb: 0, vyb: 0 };
}

// --- tests ---

// 1D uniform acceleration
{
  const x0 = -20,
    v0 = 12,
    a = -0.5,
    t = 4;
  const x = x0 + v0 * t + 0.5 * a * t * t;
  const v = v0 + a * t;
  assert.ok(Math.abs(x - (-20 + 48 - 4)) < 1e-9);
  assert.ok(Math.abs(v - 10) < 1e-9);
}

// Plane ray matches scalar along unit vector
{
  const x0 = 1,
    y0 = 2,
    th = 0.7,
    v0 = 3,
    a = -1,
    t = 2;
  const p = posRay(x0, y0, th, v0, a, t);
  const d = v0 * t + 0.5 * a * t * t;
  const ex = x0 + d * Math.cos(th);
  const ey = y0 + d * Math.sin(th);
  assert.ok(Math.abs(p.x - ex) < 1e-12 && Math.abs(p.y - ey) < 1e-12);
  const vv = velRay(th, v0, a, t);
  const s = v0 + a * t;
  assert.ok(Math.abs(vv.vx - s * Math.cos(th)) < 1e-12);
  assert.ok(Math.abs(vv.vy - s * Math.sin(th)) < 1e-12);
}

// Galilean: frame A
{
  const k = kinematicsFrame("a", 0, 0, 10, -5, 2, 1, -1, 3);
  assert.equal(k.xa, 0);
  assert.equal(k.ya, 0);
  assert.equal(k.xb, 10);
  assert.equal(k.yb, -5);
  assert.equal(k.vxa, 0);
  assert.equal(k.vya, 0);
  assert.equal(k.vxb, -3);
  assert.equal(k.vyb, 2);
}

// Galilean: frame B
{
  const k = kinematicsFrame("b", 3, 4, 10, 8, 1, 0, -2, 2);
  assert.equal(k.xb, 0);
  assert.equal(k.yb, 0);
  assert.equal(k.xa, -7);
  assert.equal(k.ya, -4);
  assert.equal(k.vxb, 0);
  assert.equal(k.vyb, 0);
  assert.equal(k.vxa, 3);
  assert.equal(k.vya, -2);
}

// Path: straight segment from (0,0) to (100,0) — compare arc-length to x
{
  const ctrl = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const cache = rebuildCache(ctrl, false);
  assert.ok(cache.total > 90 && cache.total < 110, `expected total ~100, got ${cache.total}`);
  for (const s of [0, 10, 55.5, 100, cache.total * 0.99]) {
    const p = sampleAtS(cache, s);
    assert.ok(Math.abs(p.y) < 0.05, `y should stay ~0 at s=${s}, got ${p.y}`);
    assert.ok(Math.abs(p.ty) < 0.05);
    assert.ok(Math.abs(p.tx - 1) < 0.05);
  }
  // beyond end: clamp
  const pOver = sampleAtS(cache, cache.total + 50);
  const pEnd = sampleAtS(cache, cache.total);
  assert.ok(Math.abs(pOver.x - pEnd.x) < 1e-6 && Math.abs(pOver.y - pEnd.y) < 1e-6);
}

// Closed path: wrap does not blow up and is periodic
{
  const ctrl = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const cache = rebuildCache(ctrl, true);
  assert.ok(cache.closed);
  const p0 = sampleAtS(cache, 0);
  const p1 = sampleAtS(cache, cache.total);
  const p2 = sampleAtS(cache, cache.total * 3 + 0.001);
  assert.ok(Math.abs(p0.x - p1.x) < 1e-2 && Math.abs(p0.y - p1.y) < 1e-2);
  assert.ok(Math.abs(p0.x - p2.x) < 0.2 && Math.abs(p0.y - p2.y) < 0.2);
}

// pathArcS formula
{
  const pathArcS = (t, v0, a) => v0 * t + 0.5 * a * t * t;
  assert.ok(Math.abs(pathArcS(2, 3, -1) - 4) < 1e-12);
}

console.log("kinematics_selftest: all checks passed");
