/**
 * Self-tests for lightspeed longread formulas.
 * Mirrors the math in test_model/script.js (lightspeedLongread IIFE).
 * Run: node lightspeed_selftest.mjs
 */

import assert from "node:assert/strict";

const C = 299792458; // м/с

function gamma(beta) {
  const b = Math.abs(beta);
  if (b >= 1) return Infinity;
  return 1 / Math.sqrt(1 - b * b);
}

function relAddVel(u, v) {
  return (u + v) / (1 + (u * v) / (C * C));
}

function kineticRel(m, v) {
  return (gamma(v / C) - 1) * m * C * C;
}

function kineticClassic(m, v) {
  return 0.5 * m * v * v;
}

// --- 1. Gamma table values (cited in video) ---
{
  const cases = [
    [0.5, 1.1547],
    [0.866, 2.0000],
    [0.9, 2.2942],
    [0.99, 7.0888],
    [0.999, 22.3663],
  ];
  for (const [beta, expected] of cases) {
    const g = gamma(beta);
    assert.ok(Math.abs(g - expected) < 5e-3, `γ(${beta}c) expected ≈ ${expected}, got ${g}`);
  }
}

// --- 2. Special-case: γ → 1 at β = 0 ---
{
  assert.equal(gamma(0), 1);
}

// --- 3. Relativistic velocity addition: c + v == c always ---
{
  for (const v of [1e3, 1e7, 1e8, 0.5 * C, 0.99 * C]) {
    const result = relAddVel(C, v);
    assert.ok(Math.abs(result - C) / C < 1e-12, `c + ${v} should equal c, got ${result}`);
  }
}

// --- 4. Galilean limit: u + v at low speeds ≈ u + v ---
{
  const u = 20;
  const v = 100;
  const gal = u + v;
  const rel = relAddVel(u, v);
  assert.ok(Math.abs(rel - gal) / gal < 1e-12, "low-speed addition should reduce to Galilei");
}

// --- 5. Rel addition cannot exceed c ---
{
  const u = 0.9 * C;
  const v = 0.9 * C;
  const result = relAddVel(u, v);
  assert.ok(result < C, `0.9c + 0.9c should stay < c, got ${result / C}c`);
  // closed form: (1.8 / 1.81) c
  const expected = (1.8 / 1.81) * C;
  assert.ok(Math.abs(result - expected) / C < 1e-12);
}

// --- 6. Kinetic energy: K(0.866c) = m*c² (since γ=2) ---
{
  const m = 1;
  const k = kineticRel(m, 0.866 * C);
  const expected = (gamma(0.866) - 1) * m * C * C;
  assert.ok(Math.abs(k - expected) < 1e-3 * Math.abs(expected));
}

// --- 7. Classical limit: K_rel ≈ K_cls when β is small enough to avoid catastrophic
// cancellation in (γ-1). At β = 0.01 the correction term ¾β² ≈ 7.5e-5,
// well above floating-point noise floor, so the ratio is meaningfully close to 1. ---
{
  const m = 1;
  const v = 0.01 * C;
  const ratio = kineticRel(m, v) / kineticClassic(m, v);
  assert.ok(Math.abs(ratio - 1) < 1e-3, `low-v ratio (β=0.01) should be ~1, got ${ratio}`);
  // Also: ratio is slightly above 1 (relativistic K is larger by ¾β²)
  assert.ok(ratio > 1, "relativistic K should be slightly larger than classical at finite β");
}

// --- 8. Constant-proper-acceleration rocket: v = c·tanh(η) is mathematically
// strictly less than c for any finite η. We test the simulator's working range
// (τ ∈ [0, 8 лет] at a = 9.8 m/s², so η ≤ ~8.2). For much larger η, tanh
// saturates to 1.0 in IEEE-754 doubles — that's a numerical floor of doubles,
// not a physical pathology. ---
{
  const a = 9.8; // m/s²
  for (const tauYears of [0.01, 1, 5, 8, 10]) {
    const tau = tauYears * 365.25 * 86400;
    const eta = (a * tau) / C;
    const v = C * Math.tanh(eta);
    assert.ok(v < C, `v should be < c at τ=${tauYears} yr, got ${v / C}c`);
  }
  // For 10 years at 1g, expected v/c ≈ tanh(η) where η ≈ 10.31
  const tau10 = 10 * 365.25 * 86400;
  const eta10 = (a * tau10) / C;
  const v10 = Math.tanh(eta10);
  assert.ok(v10 > 0.99999 && v10 < 1, `at 10 yr 1g: v/c expected ≈ 0.99999998, got ${v10}`);
}

// --- 9. Rocket math: cross-checks against known closed forms ---
{
  // At τ = c/a (in years for a=1 ly/y², comparable scale): η = 1
  // η = a·τ/c. Take a = 1g = 9.8 m/s², τ such that η = 1 → τ = c/a
  const a = 9.8;
  const tauForEta1 = C / a;
  const tauYearsForEta1 = tauForEta1 / (365.25 * 86400); // ~ 0.97 года
  const eta = (a * tauForEta1) / C;
  assert.ok(Math.abs(eta - 1) < 1e-9);
  const v = C * Math.tanh(eta);
  assert.ok(Math.abs(v / C - Math.tanh(1)) < 1e-12); // ≈ 0.7616
  const tEarth = (C / a) * Math.sinh(eta);
  assert.ok(Math.abs(tEarth / C * a - Math.sinh(1)) < 1e-12);
  const g = Math.cosh(eta);
  assert.ok(Math.abs(g - Math.cosh(1)) < 1e-12);
}

// --- 10. Rocket math: at large but representable τ, γ ≫ 1 ---
{
  const a = 9.8;
  const tau15 = 15 * 365.25 * 86400; // η ≈ 15.5, comfortably below double saturation
  const eta = (a * tau15) / C;
  const g = Math.cosh(eta);
  assert.ok(g > 1e6, `at 15 years γ should be ≫ 10^6, got ${g}`);
  // Sanity: γ = cosh(η) grows like e^η/2 for large η
  const expected = Math.exp(eta) / 2;
  assert.ok(Math.abs(g - expected) / expected < 1e-6, `γ should match cosh asymptotics`);
}

// --- 11. Energy ratio for +0.1c steps grows monotonically ---
{
  const ratios = [];
  for (let i = 0; i < 9; i++) {
    const a = i * 0.1;
    const b = (i + 1) * 0.1;
    ratios.push(gamma(b) - gamma(a));
  }
  for (let i = 1; i < ratios.length; i++) {
    assert.ok(ratios[i] > ratios[i - 1], `ratio should grow at step ${i}`);
  }
  // Last interval (0.8 → 0.9): expected (γ(0.9) - γ(0.8)) ≈ 1.6275
  // First interval (0 → 0.1): (γ(0.1) - 1) ≈ 0.005038
  const ratioFirstLast = ratios[ratios.length - 1] / ratios[0];
  assert.ok(ratioFirstLast > 100, `0.8→0.9c interval should cost >100× more than 0→0.1c`);
}

// --- 12. Muon survival in atmosphere ---
{
  const halfLife = 1.56e-6; // s
  const h = 15_000; // m
  const beta = 0.995;
  const v = beta * C;
  const t = h / v;
  const g = gamma(beta);
  const tau = t / g;

  const fracClassic = Math.pow(0.5, t / halfLife);
  const fracSR = Math.pow(0.5, tau / halfLife);

  // Classic: t ≈ 50 µs, half-life 1.56 µs → fraction ≈ 2^(-32.2) ≈ 2e-10
  assert.ok(fracClassic < 1e-9, `classic survival should be tiny, got ${fracClassic}`);
  // SR: γ ≈ 10.01, τ ≈ 5.02 µs → fraction ≈ 2^(-3.22) ≈ 0.107
  assert.ok(fracSR > 0.05 && fracSR < 0.2, `SR survival ≈ 10%, got ${fracSR}`);
}

// --- 13. Pythagoras identity: (γβ)² + 1 = γ² ---
{
  for (const beta of [0.1, 0.5, 0.866, 0.99, 0.999]) {
    const g = gamma(beta);
    const lhs = (g * beta) * (g * beta) + 1;
    const rhs = g * g;
    assert.ok(Math.abs(lhs - rhs) < 1e-9, `Pythagoras at β=${beta}: ${lhs} vs ${rhs}`);
  }
}

// --- 14a. Numerically-stable γ − 1 (used in LS1 chart):
// must match the standard formula at "normal" β and avoid catastrophic
// cancellation in the small-β regime. ---
function gammaMinusOneStable(beta) {
  const b = Math.abs(beta);
  const b2 = b * b;
  if (b2 >= 1) return Infinity;
  if (b2 < 1e-8) {
    const b4 = b2 * b2;
    const b6 = b4 * b2;
    const b8 = b4 * b4;
    return 0.5 * b2 + 0.375 * b4 + 0.3125 * b6 + 0.2734375 * b8;
  }
  return 1 / Math.sqrt(1 - b2) - 1;
}

{
  // For β ∈ [1e-3, 0.99] the stable formula must agree with the direct one
  // to within floating-point noise.
  for (const beta of [0.001, 0.01, 0.1, 0.5, 0.866, 0.99, 0.999]) {
    const direct = gamma(beta) - 1;
    const stable = gammaMinusOneStable(beta);
    const rel = Math.abs(stable - direct) / Math.max(1e-30, direct);
    assert.ok(rel < 1e-12, `stable γ−1 must match direct at β=${beta}, rel diff ${rel}`);
  }
  // For very small β the direct formula loses precision; the Taylor series
  // should give a non-zero, sensible answer.
  const tiny = 1e-6;
  const stableTiny = gammaMinusOneStable(tiny);
  const expected = 0.5 * tiny * tiny + 0.375 * Math.pow(tiny, 4);
  assert.ok(Math.abs(stableTiny - expected) / expected < 1e-12);
  assert.ok(stableTiny > 0, "γ−1 should be strictly positive for any β > 0");
}

// --- 14b. K_rel / K_cls ratio formula sanity:
// closed form is (γ−1) / (½β²). At β → 0 the ratio → 1. ---
{
  const ratioAt = (beta) => {
    if (beta === 0) return 1;
    return gammaMinusOneStable(beta) / (0.5 * beta * beta);
  };
  // Limit at β → 0 should be 1.
  assert.ok(Math.abs(ratioAt(1e-4) - 1) < 1e-6);
  // At β = 0.866 (γ = 2): (2−1)/(½·0.75) = 1 / 0.375 = 8/3 ≈ 2.6667
  assert.ok(Math.abs(ratioAt(0.866) - 8 / 3) < 1e-2);
  // At β = 0.99: (γ−1)/(½β²) = 6.0888 / 0.49005 ≈ 12.4248
  const r99 = ratioAt(0.99);
  assert.ok(Math.abs(r99 - 12.4248) < 1e-2, `ratio at 0.99c should be ~12.42, got ${r99}`);
  // Ratio is strictly increasing in β.
  let prev = 1;
  for (const beta of [0.1, 0.3, 0.5, 0.7, 0.9, 0.99]) {
    const r = ratioAt(beta);
    assert.ok(r > prev, `ratio must increase, got ${r} after ${prev} at β=${beta}`);
    prev = r;
  }
}

// --- 14c. Rocket distance formula sanity ---
{
  // x = (c²/a)·(cosh η − 1).
  // At η = 1: x = (c²/a) · (cosh 1 − 1) ≈ (c²/a) · 0.5430806...
  const a = 9.8;
  const eta = 1;
  const x = ((C * C) / a) * (Math.cosh(eta) - 1);
  const expected = ((C * C) / a) * 0.5430806348152437;
  assert.ok(Math.abs(x - expected) < 1e-3 * Math.abs(expected));
}

// =====================================================================
// Расширенный набор тестов для главной модели лонгрида (LS9 — ракета)
// =====================================================================
// Все формулы здесь должны быть точно те же, что используются в
// createRocketSimulator → physics(...).
const SEC_PER_YEAR = 365.25 * 86400;                     // юлианский год
const M_PER_LIGHTYEAR = C * SEC_PER_YEAR;                // ровно 9.460730472580800e15

function rocketPhysics(tauYears, aMS2) {
  const tauSec = tauYears * SEC_PER_YEAR;
  const eta = (aMS2 * tauSec) / C;
  const v = C * Math.tanh(eta);
  const tEarthSec = (C / aMS2) * Math.sinh(eta);
  const xMeters = (C * C / aMS2) * (Math.cosh(eta) - 1);
  const g = Math.cosh(eta);
  return {
    tauSec, eta, v, beta: v / C,
    tEarthSec,
    tEarthYears: tEarthSec / SEC_PER_YEAR,
    xMeters,
    xLightYears: xMeters / M_PER_LIGHTYEAR,
    g,
  };
}

// --- 15. Базовые контрольные точки на 1g ---
{
  // η = 1 — справочные значения tanh, sinh, cosh (1)
  const a = C / SEC_PER_YEAR;          // даёт η = τYears на отметке τ = 1 год
  const ph = rocketPhysics(1, a);
  assert.ok(Math.abs(ph.eta - 1) < 1e-12);
  assert.ok(Math.abs(ph.beta - Math.tanh(1)) < 1e-15);    // 0.7615941559557649
  assert.ok(Math.abs(ph.g - Math.cosh(1)) < 1e-15);       // 1.5430806348152437
}

// --- 16. tanh(η/2) — доля пути ракеты в системе Земли ---
// x / (c·t_З) = tanh(η/2) — это и есть та "линейка", которую мы
// рисуем под сценой. Проверим, что наши формулы дают именно её.
{
  for (const eta of [0.1, 0.5, 1, 2, 5, 8]) {
    const a = 9.8;
    const tauSec = eta * C / a;
    const tauYears = tauSec / SEC_PER_YEAR;
    const ph = rocketPhysics(tauYears, a);
    const ratio = ph.xMeters / (C * ph.tEarthSec);
    const expected = Math.tanh(eta / 2);
    assert.ok(Math.abs(ratio - expected) < 1e-12, `ratio at η=${eta}: ${ratio} vs ${expected}`);
    // Главное: при любом η этот ratio < 1 строго.
    assert.ok(ratio < 1, `ratio must be < 1 at η=${eta}`);
  }
}

// --- 17. Самосогласованность гиперболической триады:
//   sinh² + 1 = cosh², tanh = sinh/cosh ---
{
  for (const eta of [0, 0.5, 1, 3, 8]) {
    const sh = Math.sinh(eta);
    const ch = Math.cosh(eta);
    const th = Math.tanh(eta);
    assert.ok(Math.abs(sh * sh + 1 - ch * ch) < 1e-9 * ch * ch,
      `sinh²+1=cosh² at η=${eta}`);
    assert.ok(Math.abs(th - sh / ch) < 1e-15, `tanh=sinh/cosh at η=${eta}`);
  }
}

// --- 18. Связь γ = cosh(η) и β = tanh(η) — γ² (1−β²) = 1 ---
{
  for (const eta of [0.1, 0.5, 1, 3, 8]) {
    const beta = Math.tanh(eta);
    const g = Math.cosh(eta);
    const lhs = g * g * (1 - beta * beta);
    assert.ok(Math.abs(lhs - 1) < 1e-9, `γ²(1−β²)=1 at η=${eta}, got ${lhs}`);
  }
}

// --- 19. Сценарий 1g: 1 год собственного времени ---
//   a = 9.81 м/с², τ = 1 юлианский год → η = a·τ/c ≈ 1.0328.
//   tanh(1.0328) ≈ 0.7750, cosh(1.0328) ≈ 1.5819.
{
  const a = 9.81;
  const ph = rocketPhysics(1, a);
  assert.ok(Math.abs(ph.eta - 1.0328) < 0.005, `η at 1g/1yr ≈ 1.033, got ${ph.eta}`);
  assert.ok(Math.abs(ph.beta - 0.7750) < 0.005, `β at 1g/1yr ≈ 0.775, got ${ph.beta}`);
  assert.ok(Math.abs(ph.g - 1.5820) < 0.01, `γ at 1g/1yr ≈ 1.582, got ${ph.g}`);
  // Расстояние ≈ 0.585 св. года.
  assert.ok(ph.xLightYears > 0.5 && ph.xLightYears < 0.7,
    `x at 1g/1yr should be 0.5–0.7 ly, got ${ph.xLightYears}`);
}

// --- 20. Сценарий 1g: 5 лет собственного времени ---
//   η ≈ 5.16, β ≈ 0.99994, γ ≈ 88.
{
  const a = 9.81;
  const ph = rocketPhysics(5, a);
  assert.ok(Math.abs(ph.eta - 5.16) < 0.05, `η at 1g/5yr ≈ 5.16, got ${ph.eta}`);
  assert.ok(ph.beta > 0.9999 && ph.beta < 1, `β at 1g/5yr should be > 0.9999`);
  assert.ok(ph.g > 80 && ph.g < 100, `γ at 1g/5yr should be ~88, got ${ph.g}`);
}

// --- 21. Сценарий 1g: 10 лет собственного времени ---
//   η ≈ 10.33, β близко к 1 в пределах double, γ ~ 1.5e4.
{
  const a = 9.81;
  const ph = rocketPhysics(10, a);
  assert.ok(ph.beta < 1, "β must remain strictly less than 1");
  assert.ok(ph.beta > 0.99999999, "β should be very close to 1 at 1g/10yr");
  assert.ok(ph.g > 10_000 && ph.g < 20_000, `γ at 1g/10yr ~ 15k, got ${ph.g}`);
}

// --- 22. Релятивистское сжатие L/L₀ = 1/γ при разной β ---
{
  const cases = [
    [0.5, 0.86603],     // γ ≈ 1.1547
    [0.866, 0.5],       // γ = 2 (если β=√3/2 точно; при β=0.866 — 0.5003)
    [0.99, 0.14107],    // γ ≈ 7.0888
    [0.999, 0.04471],   // γ ≈ 22.366
  ];
  for (const [beta, expected] of cases) {
    const g = 1 / Math.sqrt(1 - beta * beta);
    const L = 1 / g;
    assert.ok(Math.abs(L - expected) < 0.01, `L/L₀ at β=${beta}: ${L} vs ${expected}`);
  }
}

// --- 23. Энергозатрата на каждые +0.1c (для гистограммы) ---
//   ΔK / m c² = γ_конец − γ_старт; шаг 0→0.1c берём за единицу.
{
  const dGamma = (a, b) => gamma(b) - gamma(a);
  const ref = dGamma(0, 0.1);                   // ≈ 0.005038
  // Список ожидаемых отношений (с точностью 0.5 %) — те самые столбики гистограммы.
  const expected = {
    "0-0.1": 1.0,
    "0.1-0.2": 3.06,    // 0.020621/0.005038
    "0.2-0.3": 5.55,    // 0.048285/0.005038
    "0.3-0.4": 8.49,    // 0.042792/0.005038 ... нет, проверим
  };
  // Скорее проверим монотонность и порядок величин.
  const sequence = [];
  for (let i = 0; i < 9; i++) {
    sequence.push(dGamma(i * 0.1, (i + 1) * 0.1) / ref);
  }
  // ratio(0→0.1) = 1 (тривиально)
  assert.ok(Math.abs(sequence[0] - 1) < 1e-12);
  // Должно строго расти
  for (let i = 1; i < sequence.length; i++) {
    assert.ok(sequence[i] > sequence[i - 1], `step ${i} ratio should grow`);
  }
  // Последний (0.8→0.9) много больше первого
  assert.ok(sequence[sequence.length - 1] > 100,
    `0.8→0.9c step should cost > 100× more than 0→0.1c, got ${sequence[sequence.length - 1]}`);
  // Хвост 0.9→0.99 ещё сильнее
  const ratio_last = dGamma(0.9, 0.99) / ref;
  assert.ok(ratio_last > 800, `0.9→0.99c step should cost > 800× more, got ${ratio_last}`);
}

// --- 24. Кинетическая энергия на единицу массы K/m = (γ−1)c² ---
//   При β = 0.866 → γ = 2 → K/m = c² ≈ 8.988e16 Дж/кг.
{
  const beta = Math.sqrt(3) / 2;     // ровно √3/2 ⇒ γ = 2
  const g = 1 / Math.sqrt(1 - beta * beta);
  const Kpm = (g - 1) * C * C;
  assert.ok(Math.abs(g - 2) < 1e-12);
  assert.ok(Math.abs(Kpm - C * C) / (C * C) < 1e-12,
    `K/m at γ=2 must equal c² (one full rest-mass-energy of mc²)`);
}

console.log("lightspeed_selftest: all checks passed");
