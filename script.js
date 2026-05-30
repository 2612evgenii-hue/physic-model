/**
 * Galilean relativity lab — 1D (highway) and 2D (xy plane) with same frame transforms
 * Comments in English for maintainability; all user-facing strings are in HTML (Russian).
 */

(function () {
  "use strict";

  /** Rounded rect path; falls back if roundRect is unavailable */
  function pathRoundRect(ctx, x, y, ww, hh, r) {
    const rad = Math.min(r, ww / 2, hh / 2);
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, ww, hh, rad);
      return;
    }
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + ww, y, x + ww, y + hh, rad);
    ctx.arcTo(x + ww, y + hh, x, y + hh, rad);
    ctx.arcTo(x, y + hh, x, y, rad);
    ctx.arcTo(x, y, x + ww, y, rad);
    ctx.closePath();
  }

  // --- State ---
  const state = {
    t: 0,
    x0a: -20,
    x0b: 25,
    va: 12,
    vb: 5,
    /** Ускорения в лабораторной (дорожной) системе, м/с²; равномерно ускоренное движение */
    aa: 0,
    ab: 0,
    frame: "road", // 'road' | 'a' | 'b'
    playing: false,
    timeScale: 1,
    traces: true,
    relativeDelta: true,
    tooltips: false,
    lastTs: 0,
    /** 'line' — прямая (дорога); 'plane' — вид сверху, кинематика в xy */
    dimensionMode: "line",
    /** Две демонстрации на одной странице: полная лаборатория или только прямая */
    siteModel: "line", // 'lab' — плоскость; 'line' — только прямая
    y0a: -12,
    y0b: 14,
    vya: 4,
    vyb: -3,
    aya: 0,
    ayb: 0,
    /** Плоскость: модуль и угол начальной скорости в лаб. СО (v_x = |v|cos θ, v_y = |v|sin θ), |v| ≥ 0 */
    speedA: 12.649110640673518,
    speedB: 5.830951894845301,
    thetaA: 0.3217505543966422,
    thetaB: -0.5404195002705842,
    planeSelectedCar: null,
    planeAngleDrag: false,
    /** Плоскость: 'ray' — прямолинейно вдоль θ; 'path' — движение по заданной ломаной траектории */
    planeMotionMode: "ray",
    /** Плоскость: траектории для A/B как массив точек в лаб. СО */
    planePathA: null,
    planePathB: null,
    planePathClosedA: false,
    planePathClosedB: false,
    /** Плоскость: кэш сглаженной полилинии и длины для s→позиции */
    planePathCacheA: null,
    planePathCacheB: null,
    /** Редактирование траектории: перетаскивание узла */
    planePathDrag: null,
    /** Плоскость: выбранный инструмент редактирования траектории */
    planePathTool: "pen", // 'hand' | 'pen' | 'move' | 'erase'
    /** История редактирования траектории (undo/redo) */
    planePathUndoA: [],
    planePathRedoA: [],
    planePathUndoB: [],
    planePathRedoB: [],
    /** Плоскость: режим просмотра для редактирования траектории */
    planeView: { mode: "auto", cx: 0, cy: 0, zoom: 1 },
    /** Пока фокус в поле θ на HUD, не перезаписывать значение из состояния каждый кадр */
    angleHudFocused: false,
    /** Показывать на сцене только катеты Δx′, Δy′ (|Δr′| управляется отдельным переключателем) */
    showDeltaLegs: true,
    /** Последний кадр плоскости — для попадания и перевода экран→мир */
    planeLayout: null,
    // Visual transition when frame changes (lerp screen positions)
    transition: {
      active: false,
      start: 0,
      duration: 520,
      from: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
      to: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
    },
    /** Max simulation time reached in this run (for pause / scrub review) */
    tRecorded: 0,
    /** While user drags the time slider, tick() must not overwrite the value */
    scrubDragging: false,
    /** Logical (CSS) canvas size — drawing uses these after DPR transform */
    canvasCss: { w: 1200, h: 520 },
  };

  function isPlane() {
    return state.dimensionMode === "plane";
  }

  const FRAME_LABELS = {
    road: "Система отсчёта · дорога",
    a: "Система отсчёта · машина A",
    b: "Система отсчёта · машина B",
  };

  const FRAME_TITLES = {
    road: "Выбранная система · дорога",
    a: "Выбранная система · машина A",
    b: "Выбранная система · машина B",
  };

  const FRAME_SUBS = {
    road: "Координаты совпадают с лабораторной сценой",
    a: "Начало в кузове A, она покоится, остальные движутся относительно неё",
    b: "Начало в кузове B, она покоится, остальные движутся относительно неё",
  };

  // --- DOM ---
  const canvas = document.getElementById("sim-canvas");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("canvas-overlay");

  /**
   * Скорости в лабораторной системе.
   * Прямая: v_x = v₀ + a t. Плоскость: прямолинейное движение вдоль заданного θ — скаляр вдоль луча s(t)=s₀+a t, v⃗ = s(t)û.
   */
  function velRoad(t) {
    if (!isPlane()) {
      return {
        vxa: state.va + state.aa * t,
        vxb: state.vb + state.ab * t,
        vya: 0,
        vyb: 0,
      };
    }
    if (state.planeMotionMode === "path") {
      ensurePlanePath("a");
      ensurePlanePath("b");
      if (!getPlanePathCache("a")) rebuildPlanePathCache("a");
      if (!getPlanePathCache("b")) rebuildPlanePathCache("b");
      const sa = state.speedA * t + 0.5 * state.aa * t * t;
      const sb = state.speedB * t + 0.5 * state.ab * t * t;
      const pa = samplePlanePathAtS("a", sa);
      const pb = samplePlanePathAtS("b", sb);
      const sA = state.speedA + state.aa * t;
      const sB = state.speedB + state.ab * t;
      return {
        vxa: sA * pa.tx,
        vxb: sB * pb.tx,
        vya: sA * pa.ty,
        vyb: sB * pb.ty,
      };
    }
    const sA = state.speedA + state.aa * t;
    const sB = state.speedB + state.ab * t;
    return {
      vxa: sA * Math.cos(state.thetaA),
      vxb: sB * Math.cos(state.thetaB),
      vya: sA * Math.sin(state.thetaA),
      vyb: sB * Math.sin(state.thetaB),
    };
  }

  /** Положения в лабораторной системе (плоскость: смещение только вдоль û(θ), см. velRoad). */
  function posRoad(t) {
    if (!isPlane()) {
      const xa = state.x0a + state.va * t + 0.5 * state.aa * t * t;
      const xb = state.x0b + state.vb * t + 0.5 * state.ab * t * t;
      return { xa, xb, ya: 0, yb: 0 };
    }
    if (state.planeMotionMode === "path") {
      ensurePlanePath("a");
      ensurePlanePath("b");
      if (!getPlanePathCache("a")) rebuildPlanePathCache("a");
      if (!getPlanePathCache("b")) rebuildPlanePathCache("b");
      const sa = state.speedA * t + 0.5 * state.aa * t * t;
      const sb = state.speedB * t + 0.5 * state.ab * t * t;
      const pa = samplePlanePathAtS("a", sa);
      const pb = samplePlanePathAtS("b", sb);
      return { xa: pa.x, xb: pb.x, ya: pa.y, yb: pb.y };
    }
    const da = state.speedA * t + 0.5 * state.aa * t * t;
    const db = state.speedB * t + 0.5 * state.ab * t * t;
    return {
      xa: state.x0a + da * Math.cos(state.thetaA),
      xb: state.x0b + db * Math.cos(state.thetaB),
      ya: state.y0a + da * Math.sin(state.thetaA),
      yb: state.y0b + db * Math.sin(state.thetaB),
    };
  }

  function getPlanePath(which) {
    return which === "a" ? state.planePathA : state.planePathB;
  }
  function setPlanePath(which, path) {
    if (which === "a") state.planePathA = path;
    else state.planePathB = path;
  }
  function getPlanePathClosed(which) {
    return which === "a" ? state.planePathClosedA : state.planePathClosedB;
  }
  function setPlanePathClosed(which, v) {
    if (which === "a") state.planePathClosedA = !!v;
    else state.planePathClosedB = !!v;
  }
  function getPlanePathCache(which) {
    return which === "a" ? state.planePathCacheA : state.planePathCacheB;
  }
  function setPlanePathCache(which, cache) {
    if (which === "a") state.planePathCacheA = cache;
    else state.planePathCacheB = cache;
  }

  function ensurePlanePath(which) {
    const p = getPlanePath(which);
    if (Array.isArray(p) && p.length >= 2) return;
    const x0 = which === "a" ? state.x0a : state.x0b;
    const y0 = which === "a" ? state.y0a : state.y0b;
    const th = which === "a" ? state.thetaA : state.thetaB;
    const L = 60;
    setPlanePath(which, [
      { x: x0, y: y0 },
      { x: x0 + Math.cos(th) * L, y: y0 + Math.sin(th) * L },
    ]);
    setPlanePathClosed(which, false);
    rebuildPlanePathCache(which);
  }

  function shiftPlanePath(which, dx, dy) {
    const p = getPlanePath(which);
    if (!Array.isArray(p) || !p.length) return;
    p.forEach((pt) => {
      pt.x += dx;
      pt.y += dy;
    });
    rebuildPlanePathCache(which);
  }

  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    // Uniform Catmull–Rom (tension=0.5)
    const x =
      0.5 *
      ((2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
    const y =
      0.5 *
      ((2 * p1.y) +
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
      // IMPORTANT: We use polyline arc-length for physics (s→position), so this discretization
      // controls numerical accuracy. Keep roughly constant spatial step, with a safe cap.
      const targetStep = 0.25; // meters between poly points (balance accuracy vs performance)
      const steps = Math.max(12, Math.min(360, Math.ceil(L / targetStep)));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const q = catmullRom(p0, p1, p2, p3, t);
        if (!out.length || vecLen(q.x - out[out.length - 1].x, q.y - out[out.length - 1].y) > 1e-4) out.push(q);
      }
    }
    // include final point
    const endPt = closed ? out[0] : pts[pts.length - 1];
    if (!out.length || vecLen(endPt.x - out[out.length - 1].x, endPt.y - out[out.length - 1].y) > 1e-4) out.push({ x: endPt.x, y: endPt.y });
    return out;
  }

  function rebuildPlanePathCache(which) {
    const ctrl = getPlanePath(which);
    if (!Array.isArray(ctrl) || ctrl.length < 2) {
      setPlanePathCache(which, null);
      return;
    }
    const closed = getPlanePathClosed(which);
    const poly = buildSmoothPolyline(ctrl, closed);
    if (poly.length < 2) {
      setPlanePathCache(which, null);
      return;
    }
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
    if (!segs.length) {
      setPlanePathCache(which, null);
      return;
    }
    setPlanePathCache(which, { poly, segs, total, closed, ctrlCount: ctrl.length });
  }

  function samplePlanePathAtS(pathOrWhich, s) {
    // If given 'a'/'b', use cached smooth polyline.
    const which = pathOrWhich === "a" || pathOrWhich === "b" ? pathOrWhich : null;
    const cache = which ? getPlanePathCache(which) : null;
    const segs = cache && cache.segs;
    const total = cache && cache.total;
    if (!segs || !segs.length || !Number.isFinite(total)) return { x: 0, y: 0, tx: 1, ty: 0 };
    // Normalize/clamp s without recursion (prevents hangs on s==0 / s==total for closed paths).
    if (cache.closed) {
      s = ((s % total) + total) % total; // [0, total)
    } else {
      // Important: for open paths, clamp at endpoints.
      // Otherwise, with negative acceleration (reverse) the car will "leave" the path and go straight.
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

  function fitPlaneViewToAll() {
    const b = viewBoundsPlane("road", state.t);
    const cx = (b.minX + b.maxX) * 0.5;
    const cy = (b.minY + b.maxY) * 0.5;
    state.planeView = { mode: "manual", cx, cy, zoom: 1 };
  }

  /**
   * Переход в выбранную систему отсчёта: r' = r − r_ref, v' = v − v_ref (Галилей в плоскости).
   * Поля va, vb — компоненты v_x в выбранной СО (как в одномерной версии); vya, vyb — v_y.
   */
  function kinematicsInFrame(frame, t) {
    const { xa, xb, ya, yb } = posRoad(t);
    const { vxa, vya, vxb, vyb } = velRoad(t);
    let xpa,
      xpb,
      ypa,
      ypb,
      vpxa,
      vpya,
      vpxb,
      vpyb;
    if (frame === "road") {
      xpa = xa;
      xpb = xb;
      ypa = ya;
      ypb = yb;
      vpxa = vxa;
      vpya = vya;
      vpxb = vxb;
      vpyb = vyb;
    } else if (frame === "a") {
      xpa = 0;
      ypa = 0;
      xpb = xb - xa;
      ypb = yb - ya;
      vpxa = 0;
      vpya = 0;
      vpxb = vxb - vxa;
      vpyb = vyb - vya;
    } else {
      xpa = xa - xb;
      ypa = ya - yb;
      xpb = 0;
      ypb = 0;
      vpxa = vxa - vxb;
      vpya = vya - vyb;
      vpxb = 0;
      vpyb = 0;
    }
    return {
      xa: xpa,
      xb: xpb,
      ya: ypa,
      yb: ypb,
      va: vpxa,
      vb: vpxb,
      vya: vpya,
      vyb: vpyb,
      xaRoad: xa,
      xbRoad: xb,
      yaRoad: ya,
      ybRoad: yb,
      vaRoad: vxa,
      vbRoad: vxb,
      vyaRoad: vya,
      vybRoad: vyb,
    };
  }

  function relativeVelocityX() {
    const v = velRoad(state.t);
    return v.vxa - v.vxb;
  }

  function relativeVelocityY() {
    if (!isPlane()) return 0;
    const v = velRoad(state.t);
    return v.vya - v.vyb;
  }

  function vecLen(x, y) {
    return Math.sqrt(x * x + y * y);
  }

  /** Угол v₀ в лаб. СО: от направления +x против часовой стрелки, градусы [0, 360) */
  function labVelocityAngleDeg(thRad) {
    let d = (thRad * 180) / Math.PI;
    d = ((d % 360) + 360) % 360;
    return d;
  }

  function syncPolarFromComponents() {
    state.speedA = vecLen(state.va, state.vya);
    state.thetaA = state.speedA < 1e-9 ? state.thetaA : Math.atan2(state.vya, state.va);
    state.speedB = vecLen(state.vb, state.vyb);
    state.thetaB = state.speedB < 1e-9 ? state.thetaB : Math.atan2(state.vyb, state.vb);
  }

  function applyPolarVelocity(which) {
    if (which === "a" || which === "all") {
      state.va = state.speedA * Math.cos(state.thetaA);
      state.vya = state.speedA * Math.sin(state.thetaA);
    }
    if (which === "b" || which === "all") {
      state.vb = state.speedB * Math.cos(state.thetaB);
      state.vyb = state.speedB * Math.sin(state.thetaB);
    }
  }

  function screenToWorldPlane(sx, sy, b, padL, padT, drawW, drawH) {
    const span = b.maxX - b.minX;
    const wx = b.minX + ((sx - padL) / drawW) * span;
    const wy = b.maxY - ((sy - padT) / drawH) * span;
    return { wx, wy };
  }

  /** Есть ли изгиб x(t) или y(t) */
  function hasAcceleration() {
    if (Math.abs(state.aa) > 1e-15 || Math.abs(state.ab) > 1e-15) return true;
    return false;
  }

  /** Отрезок [0, t], при ускорении равномерная сетка по времени для кривых x(t) */
  function sampleTimePoints1D(tEnd) {
    if (tEnd <= 1e-12) return [0];
    // In plane path mode, x(t), y(t) are generally nonlinear even when a=0 (because tangent changes),
    // so we always sample densely for accurate charts/traces.
    if (isPlane() && state.planeMotionMode === "path") {
      const N = Math.min(240, Math.max(24, Math.ceil(tEnd * 60)));
      const out = [];
      for (let i = 0; i <= N; i++) out.push((tEnd * i) / N);
      return out;
    }
    if (!hasAcceleration()) return [0, tEnd];
    const N = Math.min(96, Math.max(12, Math.ceil(tEnd * 24)));
    const out = [];
    for (let i = 0; i <= N; i++) out.push((tEnd * i) / N);
    return out;
  }

  function traceTimesForScene(tEnd) {
    // In plane+path mode, relative frames (A/B) can curve much more than road frame.
    // Use denser sampling there, but keep a hard cap for performance.
    if (isPlane() && state.planeMotionMode === "path" && state.frame !== "road") {
      const sa = Math.abs(pathArcS(tEnd, "a"));
      const sb = Math.abs(pathArcS(tEnd, "b"));
      const L = sa + sb; // rough activity measure
      const N = Math.max(360, Math.min(900, Math.ceil(L * 4.2) + 120));
      const out = [];
      for (let i = 0; i <= N; i++) out.push((tEnd * i) / N);
      return out;
    }
    return sampleTimePoints1D(tEnd);
  }

  function pathArcS(t, which) {
    const v0 = which === "a" ? state.speedA : state.speedB;
    const a = which === "a" ? state.aa : state.ab;
    return v0 * t + 0.5 * a * t * t;
  }

  function traceScreenPointsPlanePath(which, tEnd, map) {
    // Sample along arc-length s, not time: smoother at high speed.
    const sEnd = pathArcS(tEnd, which);
    const L = Math.abs(sEnd);
    if (L < 1e-7) {
      const p0 = samplePlanePathAtS(which, 0);
      const s0 = map(p0.x, p0.y);
      return [{ sx: s0.sx, sy: s0.sy }];
    }
    const N = Math.max(36, Math.min(520, Math.ceil(L * 3.2) + 24));
    const out = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const s = sEnd * u;
      const pw = samplePlanePathAtS(which, s);
      const ps = map(pw.x, pw.y);
      out.push({ sx: ps.sx, sy: ps.sy });
    }
    return out;
  }

  /** Map x' in current frame to canvas x */
  function viewBounds(frame, t) {
    const k = kinematicsInFrame(frame, t);
    const xs = [k.xa, k.xb, 0];
    let minP = Math.min(...xs);
    let maxP = Math.max(...xs);
    const pad = Math.max(18, (maxP - minP) * 0.35 + 12);
    minP -= pad;
    maxP += pad;
    if (minP === maxP) {
      minP -= 20;
      maxP += 20;
    }
    return { min: minP, max: maxP };
  }

  function xToCanvas(x, bounds, drawableW, padL) {
    const span = bounds.max - bounds.min;
    return padL + ((x - bounds.min) / span) * drawableW;
  }

  /** Screen X for car centers (height unused; API kept for clarity) */
  function projectCarsToScreen(frame, t, width) {
    const padL = 72;
    const padR = 56;
    const drawableW = width - padL - padR;
    const k = kinematicsInFrame(frame, t);
    const b = viewBounds(frame, t);
    return {
      xa: xToCanvas(k.xa, b, drawableW, padL),
      xb: xToCanvas(k.xb, b, drawableW, padL),
      bounds: b,
      k,
    };
  }

  function lineModeCarScreenY(h) {
    const roadY = h * 0.58;
    const laneH = h * 0.2;
    return roadY + laneH * 0.18;
  }

  function viewBoundsPlane(frame, t) {
    const k = kinematicsInFrame(frame, t);
    const xs = [k.xa, k.xb, 0];
    const ys = [k.ya, k.yb, 0];
    if (isPlane() && state.planeMotionMode === "path") {
      ensurePlanePath("a");
      ensurePlanePath("b");
      const pushPts = (p) => {
        if (!Array.isArray(p)) return;
        p.forEach((pt) => {
          xs.push(pt.x);
          ys.push(pt.y);
        });
      };
      pushPts(state.planePathA);
      pushPts(state.planePathB);
    }
    let minX = Math.min(...xs);
    let maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);
    const padX = Math.max(14, (maxX - minX) * 0.35 + 12);
    const padY = Math.max(14, (maxY - minY) * 0.35 + 12);
    minX -= padX;
    maxX += padX;
    minY -= padY;
    maxY += padY;
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const half = Math.max((maxX - minX) * 0.5, (maxY - minY) * 0.5, 14);
    return { minX: cx - half, maxX: cx + half, minY: cy - half, maxY: cy + half };
  }

  function viewBoundsPlaneManual(frame, t) {
    const k = kinematicsInFrame(frame, t);
    const base = viewBoundsPlane(frame, t);
    const pv = state.planeView || { mode: "auto", cx: 0, cy: 0, zoom: 1 };
    if (pv.mode !== "manual") return base;
    const cx = pv.cx;
    const cy = pv.cy;
    const span = (base.maxX - base.minX) / Math.max(0.25, pv.zoom || 1);
    const half = span * 0.5;
    return { minX: cx - half, maxX: cx + half, minY: cy - half, maxY: cy + half };
  }

  function worldToPlaneScreen(wx, wy, bounds, padL, padT, drawW, drawH) {
    const span = bounds.maxX - bounds.minX;
    const sx = padL + ((wx - bounds.minX) / span) * drawW;
    const sy = padT + ((bounds.maxY - wy) / span) * drawH;
    return { sx, sy };
  }

  function projectCarsToScreenPlane(frame, t, width, height) {
    const padL = 56;
    const padR = 44;
    const padT = 48;
    const padB = 52;
    const drawW = width - padL - padR;
    const drawH = height - padT - padB;
    const k = kinematicsInFrame(frame, t);
    const b = viewBoundsPlaneManual(frame, t);
    const map = (wx, wy) => worldToPlaneScreen(wx, wy, b, padL, padT, drawW, drawH);
    const pa = map(k.xa, k.ya);
    const pb = map(k.xb, k.yb);
    return { a: { x: pa.sx, y: pa.sy }, b: { x: pb.sx, y: pb.sy }, bounds: b, k, padL, padT, drawW, drawH };
  }

  function startFrameTransition(oldFrame) {
    const w = state.canvasCss.w;
    const h = state.canvasCss.h;
    if (isPlane()) {
      const before = projectCarsToScreenPlane(oldFrame, state.t, w, h);
      const after = projectCarsToScreenPlane(state.frame, state.t, w, h);
      state.transition = {
        active: true,
        start: performance.now(),
        duration: 520,
        from: { a: { x: before.a.x, y: before.a.y }, b: { x: before.b.x, y: before.b.y } },
        to: { a: { x: after.a.x, y: after.a.y }, b: { x: after.b.x, y: after.b.y } },
      };
      return;
    }
    const cy = lineModeCarScreenY(h);
    const before = projectCarsToScreen(oldFrame, state.t, w);
    const after = projectCarsToScreen(state.frame, state.t, w);
    state.transition = {
      active: true,
      start: performance.now(),
      duration: 520,
      from: { a: { x: before.xa, y: cy }, b: { x: before.xb, y: cy } },
      to: { a: { x: after.xa, y: cy }, b: { x: after.xb, y: cy } },
    };
  }

  // --- Drawing ---
  const COL_A = "#7eb8d4";
  const COL_B = "#d4a66a";
  const COL_AXIS = "rgba(255,255,255,0.2)";
  const COL_GRID = "rgba(255,255,255,0.06)";

  function velocityScreenAngle(vx, vy, bounds, padL, padT, drawW, drawH) {
    const p0 = worldToPlaneScreen(0, 0, bounds, padL, padT, drawW, drawH);
    const p1 = worldToPlaneScreen(vx * 0.35 + 1e-9, vy * 0.35 + 1e-9, bounds, padL, padT, drawW, drawH);
    return Math.atan2(p1.sy - p0.sy, p1.sx - p0.sx);
  }

  function drawScenePlane(ts, w, h) {
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "rgba(14,18,34,0.98)");
    bg.addColorStop(1, "rgba(5,7,14,1)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const proj = projectCarsToScreenPlane(state.frame, state.t, w, h);
    const b = proj.bounds;
    const { padL, padT, drawW, drawH, k } = proj;
    let ax = proj.a.x;
    let ay = proj.a.y;
    let bx = proj.b.x;
    let by = proj.b.y;
    if (state.transition.active) {
      const p = Math.min(1, (ts - state.transition.start) / state.transition.duration);
      const e = 1 - Math.pow(1 - p, 3);
      ax = state.transition.from.a.x + (state.transition.to.a.x - state.transition.from.a.x) * e;
      ay = state.transition.from.a.y + (state.transition.to.a.y - state.transition.from.a.y) * e;
      bx = state.transition.from.b.x + (state.transition.to.b.x - state.transition.from.b.x) * e;
      by = state.transition.from.b.y + (state.transition.to.b.y - state.transition.from.b.y) * e;
      if (p >= 1) state.transition.active = false;
    }

    const map = (wx, wy) => worldToPlaneScreen(wx, wy, b, padL, padT, drawW, drawH);

    const spanX = b.maxX - b.minX;
    const stepX = axisStepForSpan(spanX, drawW);
    const stepY = axisStepForSpan(b.maxY - b.minY, drawH);
    ctx.strokeStyle = COL_GRID;
    ctx.lineWidth = 1;
    for (let xv = Math.floor(b.minX / stepX) * stepX; xv <= b.maxX + stepX * 0.01; xv += stepX) {
      const p1 = map(xv, b.minY);
      const p2 = map(xv, b.maxY);
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.stroke();
    }
    for (let yv = Math.floor(b.minY / stepY) * stepY; yv <= b.maxY + stepY * 0.01; yv += stepY) {
      const p1 = map(b.minX, yv);
      const p2 = map(b.maxX, yv);
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.stroke();
    }

    const o = map(0, 0);
    if (o.sx >= padL - 2 && o.sx <= padL + drawW + 2 && o.sy >= padT - 2 && o.sy <= padT + drawH + 2) {
      ctx.strokeStyle = "rgba(94,243,192,0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(o.sx, padT);
      ctx.lineTo(o.sx, padT + drawH);
      ctx.moveTo(padL, o.sy);
      ctx.lineTo(padL + drawW, o.sy);
      ctx.stroke();
      ctx.fillStyle = "rgba(94,243,192,0.9)";
      ctx.font = "600 10px Outfit";
      ctx.textAlign = "left";
      ctx.fillText("O", o.sx + 6, o.sy - 8);
    }

    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "500 11px Outfit";
    ctx.textAlign = "right";
    ctx.fillText("x′, м", padL + drawW - 2, padT - 10);
    ctx.save();
    ctx.translate(20, padT + drawH * 0.5);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("y′, м", 0, 0);
    ctx.restore();

    ctx.font = "10px Outfit, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.textAlign = "center";
    for (let xv = Math.floor(b.minX / stepX) * stepX; xv <= b.maxX + stepX * 0.01; xv += stepX) {
      const pm = map(xv, b.minY + (b.maxY - b.minY) * 0.04);
      if (pm.sx < padL + 8 || pm.sx > padL + drawW - 8) continue;
      ctx.fillText(formatSimAxisNumber(xv, stepX), pm.sx, padT + drawH + 18);
    }
    ctx.textAlign = "right";
    for (let yv = Math.floor(b.minY / stepY) * stepY; yv <= b.maxY + stepY * 0.01; yv += stepY) {
      const pm = map(b.minX + (b.maxX - b.minX) * 0.04, yv);
      if (pm.sy < padT + 10 || pm.sy > padT + drawH - 6) continue;
      ctx.fillText(formatSimAxisNumber(yv, stepY), padL - 8, pm.sy + 3);
    }

    if (state.traces && state.t > 1e-7) {
      const frame = state.frame;
      ctx.lineWidth = 2;
      [["a", COL_A], ["b", COL_B]].forEach(([key, col]) => {
        ctx.beginPath();
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.42;
        if (state.planeMotionMode === "path" && frame === "road") {
          if (!getPlanePathCache(key)) rebuildPlanePathCache(key);
          const pts = traceScreenPointsPlanePath(key, state.t, map);
          pts.forEach((pp, i) => {
            if (i === 0) ctx.moveTo(pp.sx, pp.sy);
            else ctx.lineTo(pp.sx, pp.sy);
          });
        } else {
          const times = traceTimesForScene(state.t);
          times.forEach((tau, ti) => {
            const kf = kinematicsInFrame(frame, tau);
            const wx = key === "a" ? kf.xa : kf.xb;
            const wy = key === "a" ? kf.ya : kf.yb;
            const p = map(wx, wy);
            if (ti === 0) ctx.moveTo(p.sx, p.sy);
            else ctx.lineTo(p.sx, p.sy);
          });
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    }

    function drawTopCar(sx, sy, ang, color, label) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(ang);
      const L = 24;
      const W = 13;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath();
      ctx.ellipse(0, 1, L * 0.5, W * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      const gr = ctx.createLinearGradient(-L, -W, L, W);
      gr.addColorStop(0, color);
      gr.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = gr;
      ctx.strokeStyle = "rgba(255,255,255,0.32)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(L * 0.55, 0);
      ctx.lineTo(-L * 0.38, W * 0.48);
      ctx.lineTo(-L * 0.38, -W * 0.48);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.rotate(-ang);
      ctx.fillStyle = "#fff";
      ctx.font = "700 11px Outfit";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(label, 0, -16);
      ctx.restore();
    }

    let angA = velocityScreenAngle(k.va, k.vya, b, padL, padT, drawW, drawH);
    let angB = velocityScreenAngle(k.vb, k.vyb, b, padL, padT, drawW, drawH);
    // In path mode we render body heading along path tangent (forward),
    // even if v(t) becomes negative (reverse motion should not rotate the body 180°).
    if (state.planeMotionMode === "path" && state.frame === "road") {
      if (!getPlanePathCache("a")) rebuildPlanePathCache("a");
      if (!getPlanePathCache("b")) rebuildPlanePathCache("b");
      const pa = samplePlanePathAtS("a", pathArcS(state.t, "a"));
      const pb = samplePlanePathAtS("b", pathArcS(state.t, "b"));
      angA = velocityScreenAngle(pa.tx, pa.ty, b, padL, padT, drawW, drawH);
      angB = velocityScreenAngle(pb.tx, pb.ty, b, padL, padT, drawW, drawH);
    }
    drawTopCar(ax, ay, angA, COL_A, "A");
    drawTopCar(bx, by, angB, COL_B, "B");

    // Draw editable paths (laboratory coords) in path mode
    if (state.planeMotionMode === "path" && state.frame === "road") {
      ensurePlanePath("a");
      ensurePlanePath("b");
      const drawPath = (which, col) => {
        if (!getPlanePathCache(which)) rebuildPlanePathCache(which);
        const cache = getPlanePathCache(which);
        const p = cache && cache.poly;
        if (!Array.isArray(p) || p.length < 2) return;
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        p.forEach((pt, i) => {
          const s = map(pt.x, pt.y);
          if (i === 0) ctx.moveTo(s.sx, s.sy);
          else ctx.lineTo(s.sx, s.sy);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      };
      drawPath("a", "rgba(77,225,255,0.85)");
      drawPath("b", "rgba(212,166,106,0.85)");

      const sel = state.planeSelectedCar;
      if (sel) {
        const ctrl = getPlanePath(sel);
        if (Array.isArray(ctrl)) {
          ctx.save();
          ctx.font = "600 10px JetBrains Mono, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctrl.forEach((pt, i) => {
            const s = map(pt.x, pt.y);
            const c = sel === "a" ? "rgba(77,225,255,0.92)" : "rgba(212,166,106,0.92)";
            ctx.fillStyle = "rgba(0,0,0,0.62)";
            ctx.beginPath();
            ctx.arc(s.sx, s.sy, 7.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = c;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(s.sx, s.sy, 7.5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(s.sx, s.sy, 2.4, 0, Math.PI * 2);
            ctx.fill();
            // cleaner: no numbering clutter
          });
          ctx.restore();
        }
      }
    }

    if (state.relativeDelta && state.showDeltaLegs) {
      const Pa = map(k.xa, k.ya);
      const Pb = map(k.xb, k.yb);
      const Pc = map(k.xb, k.ya);
      ctx.strokeStyle = "rgba(250, 210, 140, 0.65)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(Pa.sx, Pa.sy);
      ctx.lineTo(Pc.sx, Pc.sy);
      ctx.lineTo(Pb.sx, Pb.sy);
      ctx.stroke();
      ctx.setLineDash([]);
      const wdx = k.xb - k.xa;
      const wdy = k.yb - k.ya;
      ctx.fillStyle = "rgba(250, 210, 140, 0.92)";
      ctx.font = "600 9px JetBrains Mono";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Δx′=" + wdx.toFixed(1) + " м", (Pa.sx + Pc.sx) * 0.5, (Pa.sy + Pc.sy) * 0.5 - 6);
      ctx.fillText("Δy′=" + wdy.toFixed(1) + " м", (Pc.sx + Pb.sx) * 0.5, (Pc.sy + Pb.sy) * 0.5 + 6);
      ctx.textBaseline = "alphabetic";
    }

    if (state.relativeDelta) {
      const dx = k.xb - k.xa;
      const dy = k.yb - k.ya;
      const dist = vecLen(dx, dy);
      ctx.strokeStyle = "rgba(167,139,250,0.88)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(167,139,250,0.95)";
      ctx.font = "600 10px JetBrains Mono";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("|Δr′| = " + dist.toFixed(1) + " м", (ax + bx) * 0.5, (ay + by) * 0.5 - 8);
    }

    const hitR = 28;
    const ringR = 42;
    let selCx = null;
    let selCy = null;
    let angleHud = null;
    if (state.frame === "road" && state.planeSelectedCar) {
      const car = state.planeSelectedCar;
      // Ring shows heading direction: in path mode it's the path tangent (forward).
      let vx = car === "a" ? k.va : k.vb;
      let vy = car === "a" ? k.vya : k.vyb;
      if (state.planeMotionMode === "path") {
        const which = car;
        if (!getPlanePathCache(which)) rebuildPlanePathCache(which);
        const pH = samplePlanePathAtS(which, pathArcS(state.t, which));
        vx = pH.tx;
        vy = pH.ty;
      }
      const scAng = velocityScreenAngle(vx, vy, b, padL, padT, drawW, drawH);
      const cx = car === "a" ? ax : bx;
      const cy = car === "a" ? ay : by;
      selCx = cx;
      selCy = cy;
      const pulse = 0.5 + 0.5 * Math.sin(ts * 0.0031);
      const col = car === "a" ? COL_A : COL_B;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(scAng);
      ctx.lineWidth = 1.05;
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle =
        car === "a"
          ? `rgba(77,225,255,${0.28 + pulse * 0.42})`
          : `rgba(212,166,106,${0.28 + pulse * 0.42})`;
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(ringR, 0);
      ctx.strokeStyle =
        car === "a" ? `rgba(200,243,255,${0.55 + pulse * 0.35})` : `rgba(255,224,190,${0.55 + pulse * 0.35})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
      if (state.planeMotionMode === "ray") angleHud = { cx, cy, ringR, padL, padT, drawW, w, h, car };
    }

    state.planeLayout = {
      roadEdit: state.frame === "road",
      b,
      padL,
      padT,
      drawW,
      drawH,
      w,
      h,
      ax,
      ay,
      bx,
      by,
      hitR,
      ringR: 42,
      selCx,
      selCy,
      angleHud,
    };

    if (state.frame === "a" || state.frame === "b") {
      const fx = state.frame === "a" ? ax : bx;
      const fy = state.frame === "a" ? ay : by;
      const badgeText = "покой в собственной СО";
      ctx.font = "600 10px Outfit";
      ctx.textAlign = "center";
      const tw = ctx.measureText(badgeText).width;
      const padX = 14;
      const bw = Math.ceil(tw + padX * 2);
      const bh = 24;
      const bx0 = fx - bw / 2;
      const by0 = Math.max(8, fy - 48 - bh);
      ctx.fillStyle = "rgba(94,243,192,0.12)";
      ctx.strokeStyle = "rgba(94,243,192,0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      pathRoundRect(ctx, bx0, by0, bw, bh, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(94,243,192,0.95)";
      ctx.textBaseline = "middle";
      ctx.fillText(badgeText, fx, by0 + bh * 0.5);
      ctx.textBaseline = "alphabetic";
    }

    if (state.tooltips) {
      overlay.innerHTML = "";
      const tip = (sx, sy, text) => {
        const div = document.createElement("div");
        div.className = "canvas-tip";
        div.textContent = text;
        div.style.cssText =
          "position:absolute;left:" +
          (sx / w) * 100 +
          "%;top:" +
          (sy / h) * 100 +
          "%;transform:translate(-50%,-120%);background:rgba(12,14,24,0.92);border:1px solid rgba(255,255,255,0.12);padding:6px 10px;border-radius:10px;font-size:11px;pointer-events:none;white-space:nowrap;";
        overlay.appendChild(div);
      };
      tip(ax, ay, "A · x′=" + k.xa.toFixed(1) + " м  y′=" + k.ya.toFixed(1) + " м");
      tip(bx, by, "B · x′=" + k.xb.toFixed(1) + " м  y′=" + k.yb.toFixed(1) + " м");
    } else {
      overlay.innerHTML = "";
    }
  }

  function drawScene(ts) {
    const w = state.canvasCss.w;
    const h = state.canvasCss.h;
    if (isPlane()) {
      drawScenePlane(ts, w, h);
      return;
    }
    ctx.clearRect(0, 0, w, h);

    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
    sky.addColorStop(0, "rgba(126, 184, 212, 0.08)");
    sky.addColorStop(0.5, "transparent");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h * 0.55);

    const roadY = h * 0.58;
    const laneH = h * 0.2;

    // Parallax stripes (motion cue — phase tied to observer frame и текущей скорости)
    const vr = velRoad(state.t);
    let phase = 0;
    if (state.frame === "road") phase = state.t * vr.vxa * 0.12;
    else if (state.frame === "a") phase = state.t * (-vr.vxa) * 0.12;
    else phase = state.t * (-vr.vxb) * 0.12;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, roadY - 8, w, laneH + 40);
    ctx.clip();
    for (let i = -2; i < 40; i++) {
      const x = ((i * 80 + (phase * 40) % 80) + w) % (w + 160) - 80;
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(x, roadY + laneH * 0.45, 42, 3);
    }
    ctx.restore();

    // Road surface
    const roadGrad = ctx.createLinearGradient(0, roadY, 0, h);
    roadGrad.addColorStop(0, "rgba(20,24,38,0.95)");
    roadGrad.addColorStop(1, "rgba(8,10,18,1)");
    ctx.fillStyle = roadGrad;
    ctx.fillRect(0, roadY, w, h - roadY);

    ctx.strokeStyle = "rgba(77,225,255,0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, roadY);
    ctx.lineTo(w, roadY);
    ctx.stroke();

    const padL = 72;
    const padR = 56;
    const drawableW = w - padL - padR;
    const axisY = roadY + laneH * 0.72;
    const proj = projectCarsToScreen(state.frame, state.t, w);
    const b = proj.bounds;

    // Ticks in current frame coordinates — step from min pixel spacing (no overlapping labels when zoomed)
    const span = b.max - b.min;
    const step = axisStepForSpan(span, drawableW);
    const startTick = Math.floor(b.min / step) * step;
    ctx.font = "11px Outfit, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.textAlign = "center";
    for (let xv = startTick; xv <= b.max + step * 0.001; xv += step) {
      const sx = xToCanvas(xv, b, drawableW, padL);
      if (sx < padL - 5 || sx > w - padR + 5) continue;
      ctx.strokeStyle = COL_GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, axisY + 6);
      ctx.lineTo(sx, axisY + 22);
      ctx.stroke();
      ctx.fillText(formatSimAxisNumber(xv, step), sx, axisY + 38);
    }

    // Main axis line
    ctx.strokeStyle = COL_AXIS;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padL, axisY);
    ctx.lineTo(w - padR, axisY);
    ctx.stroke();

    // Origin marker
    const ox = xToCanvas(0, b, drawableW, padL);
    if (ox >= padL - 4 && ox <= w - padR + 4) {
      ctx.strokeStyle = "rgba(94,243,192,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ox, axisY - 10);
      ctx.lineTo(ox, axisY + 10);
      ctx.stroke();
      ctx.fillStyle = "rgba(94,243,192,0.85)";
      ctx.font = "600 11px Outfit";
      ctx.fillText("0", ox, axisY - 16);
    }

    // Axis label
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "500 12px Outfit";
    ctx.textAlign = "right";
    ctx.fillText("x′, м", w - padR + 8, axisY - 12);

    // Следы τ∈[0,t]: при ненулевом ускорении — ломаная по нескольким моментам времени
    if (state.traces && state.t > 1e-7) {
      const frame = state.frame;
      const times = traceTimesForScene(state.t);
      ctx.lineWidth = 2;
      [["a", COL_A], ["b", COL_B]].forEach(([key, col], idx) => {
        const sy = axisY - 8 - idx * 3;
        ctx.beginPath();
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.35;
        times.forEach((tau, ti) => {
          const kf = kinematicsInFrame(frame, tau);
          const xv = key === "a" ? kf.xa : kf.xb;
          const sx = xToCanvas(xv, b, drawableW, padL);
          if (ti === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    }

    // Cars Y position
    const carY = roadY + laneH * 0.18;
    const carH = 26;
    const carW = 64;

    let sxA = proj.xa;
    let sxB = proj.xb;
    let syA = carY;
    let syB = carY;
    if (state.transition.active) {
      const p = Math.min(1, (ts - state.transition.start) / state.transition.duration);
      const e = 1 - Math.pow(1 - p, 3);
      sxA = state.transition.from.a.x + (state.transition.to.a.x - state.transition.from.a.x) * e;
      sxB = state.transition.from.b.x + (state.transition.to.b.x - state.transition.from.b.x) * e;
      syA = state.transition.from.a.y + (state.transition.to.a.y - state.transition.from.a.y) * e;
      syB = state.transition.from.b.y + (state.transition.to.b.y - state.transition.from.b.y) * e;
      if (p >= 1) state.transition.active = false;
    }

    function drawCar(sx, sy, color, label) {
      ctx.save();
      ctx.translate(sx, sy);
      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.ellipse(0, carH + 6, carW * 0.45, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      // Body
      const g = ctx.createLinearGradient(-carW / 2, 0, carW / 2, carH);
      g.addColorStop(0, color);
      g.addColorStop(1, "rgba(0,0,0,0.35)");
      ctx.fillStyle = g;
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      pathRoundRect(ctx, -carW / 2, 0, carW, carH, 10);
      ctx.fill();
      ctx.stroke();
      // Windshield
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.beginPath();
      pathRoundRect(ctx, -carW / 2 + 8, 5, carW - 28, 10, 4);
      ctx.fill();
      // Headlight glow
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.beginPath();
      ctx.arc(carW / 2 - 4, carH * 0.55, 3, 0, Math.PI * 2);
      ctx.fill();
      // Label
      ctx.fillStyle = "#fff";
      ctx.font = "700 12px Outfit";
      ctx.textAlign = "center";
      ctx.fillText(label, 0, -10);
      ctx.restore();

      // Drop line to axis
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sx, sy + carH);
      ctx.lineTo(sx, axisY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    drawCar(sxA, syA, COL_A, "A");
    drawCar(sxB, syB, COL_B, "B");

    // Relative delta segment (below axis tick numbers so labels never overlap)
    if (state.relativeDelta) {
      const k = proj.k;
      const d = k.xb - k.xa;
      const x1 = sxA;
      const x2 = sxB;
      /* На узком canvas axisY+58 уходит за нижний край — подпись и линия пропадают */
      const midY = Math.max(axisY + 10, Math.min(axisY + 58, h - 22));
      ctx.strokeStyle = "rgba(167,139,250,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(Math.min(x1, x2), midY);
      ctx.lineTo(Math.max(x1, x2), midY);
      ctx.stroke();
      ctx.fillStyle = "rgba(167,139,250,0.95)";
      ctx.font = "600 11px JetBrains Mono";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("Δx′ = " + d.toFixed(1) + " м", (x1 + x2) / 2, midY + 6);
      ctx.textBaseline = "alphabetic";
    }

    // Frame lock badge — чуть выше области HTML-подсказок (42% сверху), без сдвига самих подсказок
    if (state.frame === "a" || state.frame === "b") {
      const fixed = state.frame === "a" ? sxA : sxB;
      const badgeText = "покой в собственной СО";
      ctx.font = "600 10px Outfit";
      ctx.textAlign = "center";
      const tw = ctx.measureText(badgeText).width;
      const padX = 14;
      const bw = Math.ceil(tw + padX * 2);
      const bh = 24;
      const bx = fixed - bw / 2;
      const tooltipTopPx = h * 0.42;
      const carTy = state.frame === "a" ? syA : syB;
      const byNearCar = carTy - 62 - bh;
      const byAboveTips = tooltipTopPx - bh - 8;
      const by = Math.max(6, Math.min(byNearCar, byAboveTips));
      ctx.fillStyle = "rgba(94,243,192,0.12)";
      ctx.strokeStyle = "rgba(94,243,192,0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      pathRoundRect(ctx, bx, by, bw, bh, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(94,243,192,0.95)";
      ctx.textBaseline = "middle";
      ctx.fillText(badgeText, fixed, by + bh / 2);
      ctx.textBaseline = "alphabetic";
    }

    // Tooltips — фиксированная вертикаль; бейдж сдвигается вверх, а не подсказки вниз
    if (state.tooltips) {
      overlay.innerHTML = "";
      const topPct = 42;
      const tip = (sx, text, tp) => {
        const div = document.createElement("div");
        div.className = "canvas-tip";
        div.textContent = text;
        div.style.cssText =
          "position:absolute;left:" +
          (sx / w) * 100 +
          "%;top:" +
          tp +
          "%;transform:translate(-50%,0);background:rgba(12,14,24,0.92);border:1px solid rgba(255,255,255,0.12);padding:6px 10px;border-radius:10px;font-size:11px;pointer-events:none;white-space:nowrap;";
        overlay.appendChild(div);
      };
      tip(sxA, "A · x′ = " + proj.k.xa.toFixed(2) + " м", topPct);
      tip(sxB, "B · x′ = " + proj.k.xb.toFixed(2) + " м", topPct);
    } else {
      overlay.innerHTML = "";
    }
  }

  /**
   * Узлы времени для графиков: при a=0 достаточно двух точек (отрезок),
   * при равноускоренном движении x(t) и Δx(t) квадратичны — нужна плотная выборка.
   * График v(t) остаётся отрезком — линейная функция времени.
   */
  function analyticPlotTimes() {
    const t = state.t;
    return sampleTimePoints1D(t).map((tv) => ({ t: tv }));
  }

  function analyticPlotTimesVelocity() {
    const t = state.t;
    if (t <= 1e-15) return [{ t: 0 }];
    return [{ t: 0 }, { t: t }];
  }

  function niceTickStep(span, targetDivs) {
    if (span <= 0 || !isFinite(span)) return 1;
    const a = span / Math.max(4, targetDivs);
    const p10 = Math.pow(10, Math.floor(Math.log10(a)));
    const err = a / p10;
    const step = err <= 1 ? 1 : err <= 2 ? 2 : err <= 5 ? 5 : 10;
    return step * p10;
  }

  /** Tick step for sim axis: keep ~minPx between labels so they never stack when zoomed */
  function axisStepForSpan(span, drawableW) {
    if (span <= 0 || !isFinite(span)) return 1;
    const minPx = 52;
    const targetDivs = Math.max(3, Math.floor(drawableW / minPx));
    let step = niceTickStep(span, targetDivs);
    let px = (step / span) * drawableW;
    let guard = 0;
    while (px < minPx * 0.9 && guard < 28) {
      const nstep = step * 2;
      if (nstep === step) break;
      step = nstep;
      px = (step / span) * drawableW;
      guard++;
    }
    return step;
  }

  function formatSimAxisNumber(xv, step) {
    const ad = Math.abs(step);
    if (ad >= 5) return String(Math.round(xv));
    if (ad >= 0.5) return (Math.round(xv * 10) / 10).toFixed(1);
    if (ad >= 0.05) return (Math.round(xv * 100) / 100).toFixed(2);
    return (Math.round(xv * 1000) / 1000).toFixed(3);
  }

  function formatTick(n, span) {
    const ad = Math.abs(span);
    if (ad < 0.05) return n.toFixed(3);
    if (ad < 2) return n.toFixed(2);
    if (ad < 80) return n.toFixed(1);
    return String(Math.round(n));
  }

  /**
   * Cartesian plot with dynamic bounds, grid, axes, optional y=0 and t=now cursor.
   */
  function drawCartesianChart(c, cssW, cssH, opts) {
    const {
      points,
      series,
      xLabel,
      yLabel,
      showYZero,
      cursorT,
    } = opts;
    c.clearRect(0, 0, cssW, cssH);
    c.fillStyle = "rgba(255,255,255,0.025)";
    c.fillRect(0, 0, cssW, cssH);

    if (!points.length || !series.length) return;

    let tMin = 0;
    let tMax = Math.max(0.4, state.t, ...points.map((p) => p.t));
    let yMin = Infinity;
    let yMax = -Infinity;
    points.forEach((p) => {
      series.forEach((s) => {
        const y = s.yFn(p.t);
        if (isFinite(y)) {
          yMin = Math.min(yMin, y);
          yMax = Math.max(yMax, y);
        }
      });
    });
    if (!isFinite(yMin) || !isFinite(yMax)) return;

    // Avoid degenerate Y span (single t=0 sample on Δx etc.): tiny span made tick step explode
    {
      const raw = yMax - yMin;
      const yC = (yMin + yMax) * 0.5;
      if (raw < 1e-12) {
        const half = 0.5 * Math.max(2, Math.abs(yC) * 0.25 + 1.5);
        yMin = yC - half;
        yMax = yC + half;
      } else {
        const yPad = Math.max(raw * 0.12, 1e-6);
        yMin -= yPad;
        yMax += yPad;
      }
      let sp = yMax - yMin;
      if (sp < 1.2) {
        const extra = (1.2 - sp) / 2;
        yMin -= extra;
        yMax += extra;
      }
    }

    const tPad = (tMax - tMin) * 0.04;
    tMax += tPad;

    const L = 54;
    const R = 12;
    const T = 16;
    const B = 40;
    const plotW = cssW - L - R;
    const plotH = cssH - T - B;
    if (plotW < 20 || plotH < 20) return;

    function tx(t) {
      return L + ((t - tMin) / (tMax - tMin || 1)) * plotW;
    }
    function ty(y) {
      return T + (1 - (y - yMin) / (yMax - yMin || 1)) * plotH;
    }

    const tStep = niceTickStep(tMax - tMin, 5);
    const yStep = niceTickStep(yMax - yMin, 5);

    // Grid vertical
    c.strokeStyle = "rgba(255,255,255,0.06)";
    c.lineWidth = 1;
    for (let tv = Math.ceil(tMin / tStep) * tStep; tv <= tMax + tStep * 0.01; tv += tStep) {
      const x = tx(tv);
      if (x < L || x > L + plotW) continue;
      c.beginPath();
      c.moveTo(x, T);
      c.lineTo(x, T + plotH);
      c.stroke();
    }
    // Grid horizontal
    for (let yv = Math.ceil(yMin / yStep) * yStep; yv <= yMax + yStep * 0.01; yv += yStep) {
      const yy = ty(yv);
      if (yy < T || yy > T + plotH) continue;
      c.beginPath();
      c.moveTo(L, yy);
      c.lineTo(L + plotW, yy);
      c.stroke();
    }

    // y = 0 reference
    if (showYZero && yMin < 0 && yMax > 0) {
      c.strokeStyle = "rgba(255,255,255,0.12)";
      c.setLineDash([5, 5]);
      c.beginPath();
      c.moveTo(L, ty(0));
      c.lineTo(L + plotW, ty(0));
      c.stroke();
      c.setLineDash([]);
    }

    // Plot frame
    c.strokeStyle = "rgba(255,255,255,0.28)";
    c.lineWidth = 1.2;
    c.strokeRect(L, T, plotW, plotH);

    // Axis labels & ticks
    c.fillStyle = "rgba(255,255,255,0.4)";
    c.font = "10px Outfit, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "top";
    for (let tv = Math.ceil(tMin / tStep) * tStep; tv <= tMax + tStep * 0.01; tv += tStep) {
      const x = tx(tv);
      if (x < L - 2 || x > L + plotW + 2) continue;
      c.fillText(formatTick(tv, tMax - tMin), x, T + plotH + 6);
    }
    c.fillStyle = "rgba(255,255,255,0.45)";
    c.font = "500 11px Outfit, sans-serif";
    c.fillText(xLabel, L + plotW / 2, cssH - 14);

    c.textAlign = "right";
    c.textBaseline = "middle";
    c.fillStyle = "rgba(255,255,255,0.4)";
    c.font = "10px Outfit, sans-serif";
    for (let yv = Math.ceil(yMin / yStep) * yStep; yv <= yMax + yStep * 0.01; yv += yStep) {
      const yy = ty(yv);
      if (yy < T - 2 || yy > T + plotH + 2) continue;
      c.fillText(formatTick(yv, yMax - yMin), L - 8, yy);
    }

    c.save();
    c.translate(14, T + plotH / 2);
    c.rotate(-Math.PI / 2);
    c.textAlign = "center";
    c.fillStyle = "rgba(255,255,255,0.45)";
    c.font = "500 11px Outfit, sans-serif";
    c.fillText(yLabel, 0, 0);
    c.restore();

    // Current time cursor
    if (cursorT >= tMin && cursorT <= tMax) {
      const cx = tx(cursorT);
      c.strokeStyle = "rgba(94,243,192,0.35)";
      c.lineWidth = 1;
      c.setLineDash([3, 4]);
      c.beginPath();
      c.moveTo(cx, T);
      c.lineTo(cx, T + plotH);
      c.stroke();
      c.setLineDash([]);
    }

    // Series — все узлы участвуют в stroke; кружки только у t=0 и текущего t (без «горошка» на кривой)
    series.forEach((s) => {
      c.lineWidth = 2.2;
      c.strokeStyle = s.color;
      c.lineJoin = "round";
      c.lineCap = "round";
      c.beginPath();
      let started = false;
      points.forEach((p) => {
        const y = s.yFn(p.t);
        if (!isFinite(y)) return;
        const px = tx(p.t);
        const py = ty(y);
        if (!started) {
          c.moveTo(px, py);
          started = true;
        } else {
          c.lineTo(px, py);
        }
      });
      c.stroke();

      /* Маркер только в текущий момент t: точка при t=0 убрана (визуальный «кружок у начала координат») */
      points.forEach((p, idx) => {
        if (points.length > 1 && idx < points.length - 1) return;
        const y = s.yFn(p.t);
        if (!isFinite(y)) return;
        const px = tx(p.t);
        const py = ty(y);
        const r = 2.6;
        c.fillStyle = s.color;
        c.strokeStyle = "rgba(255,255,255,0.35)";
        c.lineWidth = 1;
        c.beginPath();
        c.arc(px, py, r, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      });
    });
  }

  function drawAllStudyCharts() {
    const ptsXt = analyticPlotTimes();
    const ptsVt = analyticPlotTimesVelocity();
    const frame = state.frame;

    document.querySelectorAll(".study-canvas").forEach((cv) => {
      const kind = cv.dataset.chart;
      const cssW = parseFloat(cv.dataset.cssW) || 400;
      const cssH = parseFloat(cv.dataset.cssH) || 200;
      const c = cv.getContext("2d");

      if (kind === "road-xt") {
        drawCartesianChart(c, cssW, cssH, {
          points: ptsXt,
          xLabel: "t, с",
          yLabel: "x, м",
          showYZero: true,
          cursorT: state.t,
          series: [
            {
              color: COL_A,
              legend: "x_A(t)",
              yFn: (t) => posRoad(t).xa,
            },
            {
              color: COL_B,
              legend: "x_B(t)",
              yFn: (t) => posRoad(t).xb,
            },
          ],
        });
      } else if (kind === "frame-xt") {
        drawCartesianChart(c, cssW, cssH, {
          points: ptsXt,
          xLabel: "t, с",
          yLabel: "x′, м",
          showYZero: true,
          cursorT: state.t,
          series: [
            {
              color: COL_A,
              legend: "x′_A(t)",
              yFn: (t) => kinematicsInFrame(frame, t).xa,
            },
            {
              color: COL_B,
              legend: "x′_B(t)",
              yFn: (t) => kinematicsInFrame(frame, t).xb,
            },
          ],
        });
      } else if (kind === "road-yt") {
        if (!isPlane()) {
          c.clearRect(0, 0, cssW, cssH);
          return;
        }
        drawCartesianChart(c, cssW, cssH, {
          points: ptsXt,
          xLabel: "t, с",
          yLabel: "y, м",
          showYZero: true,
          cursorT: state.t,
          series: [
            {
              color: COL_A,
              legend: "y_A(t)",
              yFn: (t) => posRoad(t).ya,
            },
            {
              color: COL_B,
              legend: "y_B(t)",
              yFn: (t) => posRoad(t).yb,
            },
          ],
        });
      } else if (kind === "frame-yt") {
        if (!isPlane()) {
          c.clearRect(0, 0, cssW, cssH);
          return;
        }
        drawCartesianChart(c, cssW, cssH, {
          points: ptsXt,
          xLabel: "t, с",
          yLabel: "y′, м",
          showYZero: true,
          cursorT: state.t,
          series: [
            {
              color: COL_A,
              legend: "y′_A(t)",
              yFn: (t) => kinematicsInFrame(frame, t).ya,
            },
            {
              color: COL_B,
              legend: "y′_B(t)",
              yFn: (t) => kinematicsInFrame(frame, t).yb,
            },
          ],
        });
      } else if (kind === "road-vt") {
        drawCartesianChart(c, cssW, cssH, {
          points: ptsVt,
          xLabel: "t, с",
          yLabel: isPlane() ? "|v|, м/с" : "v_x, м/с",
          showYZero: true,
          cursorT: state.t,
          series: isPlane()
            ? [
                {
                  color: COL_A,
                  legend: "|v_A|",
                  yFn: (tau) => {
                    const v = velRoad(tau);
                    return vecLen(v.vxa, v.vya);
                  },
                },
                {
                  color: COL_B,
                  legend: "|v_B|",
                  yFn: (tau) => {
                    const v = velRoad(tau);
                    return vecLen(v.vxb, v.vyb);
                  },
                },
              ]
            : [
                {
                  color: COL_A,
                  legend: "v_A",
                  yFn: (tau) => velRoad(tau).vxa,
                },
                {
                  color: COL_B,
                  legend: "v_B",
                  yFn: (tau) => velRoad(tau).vxb,
                },
              ],
        });
      } else if (kind === "delta-xt") {
        drawCartesianChart(c, cssW, cssH, {
          points: ptsXt,
          xLabel: "t, с",
          yLabel: isPlane() ? "|Δr|, м" : "Δx, м",
          showYZero: true,
          cursorT: state.t,
          series: [
            {
              color: "rgba(167,139,250,0.95)",
              legend: isPlane() ? "|r_B − r_A|" : "x_B − x_A",
              yFn: (t) => {
                const r = posRoad(t);
                if (isPlane()) return vecLen(r.xb - r.xa, r.yb - r.ya);
                return r.xb - r.xa;
              },
            },
          ],
        });
      }
    });
  }

  // --- History sample ---
  // --- UI update ---
  const el = (id) => document.getElementById(id);

  function layoutPlaneAngleHud() {
    const hud = el("plane-angle-hud");
    if (!hud) return;
    if (!isPlane()) {
      hud.hidden = true;
      return;
    }
    const ah = state.planeLayout && state.planeLayout.angleHud;
    if (!ah) {
      const ti = el("inp-theta-deg");
      if (ti && document.activeElement === ti) ti.blur();
      hud.hidden = true;
      return;
    }
    hud.hidden = false;
    hud.dataset.car = ah.car;
    const { cx, cy, ringR, padL, padT, w, h } = ah;
    const tipY = cy - ringR - 10;
    const ly = tipY < padT + 14 ? cy + ringR + 20 : tipY;
    const topPx = Math.max(padT + 4, ly - 50);
    let pctL = (cx / w) * 100;
    pctL = Math.max(10, Math.min(90, pctL));
    hud.style.left = pctL + "%";
    hud.style.top = (topPx / h) * 100 + "%";
    hud.style.transform = "translate(-50%, 0)";
  }

  function syncAngleHudInputFromState() {
    const inp = el("inp-theta-deg");
    if (!inp || state.angleHudFocused) return;
    if (!isPlane() || state.frame !== "road" || !state.planeSelectedCar) return;
    const car = state.planeSelectedCar;
    const th = car === "a" ? state.thetaA : state.thetaB;
    inp.value = labVelocityAngleDeg(th).toFixed(1);
  }

  function applyThetaDegFromInput() {
    const inp = el("inp-theta-deg");
    if (!inp || !isPlane() || state.frame !== "road" || !state.planeSelectedCar) return;
    let d = parseFloat(String(inp.value).replace(",", "."));
    if (!Number.isFinite(d)) return;
    d = ((d % 360) + 360) % 360;
    const r = (d * Math.PI) / 180;
    const car = state.planeSelectedCar;
    if (car === "a") state.thetaA = r;
    else state.thetaB = r;
    applyPolarVelocity(car);
    inp.value = d.toFixed(1);
    state.t = 0;
    state.tRecorded = 0;
    syncLinePlaneSliderUi();
    updatePlanePanelUI();
  }

  function syncPlaybackButton() {
    const b = el("btn-play-pause");
    if (!b) return;
    b.classList.toggle("is-playing", state.playing);
    b.classList.toggle("is-paused", !state.playing);
    const label = state.playing ? "Пауза" : "Запустить или продолжить симуляцию";
    b.setAttribute("aria-label", label);
    b.title = state.playing ? "Пауза" : "Запустить или продолжить";
  }

  function syncScrubUI() {
    const scrub = el("scrub-t");
    if (!scrub) return;
    const max = Math.max(1e-6, state.tRecorded);
    scrub.max = String(max);
    scrub.min = "0";
    const can = !state.playing && state.tRecorded > 1e-6;
    scrub.disabled = !can;
    if (!state.scrubDragging) {
      const v = Math.max(0, Math.min(state.t, state.tRecorded));
      scrub.value = String(v);
    }
    const lab = el("scrub-label");
    const mx = el("scrub-max-label");
    if (lab) lab.textContent = `t = ${state.t.toFixed(2)} с`;
    if (mx) mx.textContent = `/ ${state.tRecorded.toFixed(2)} с`;
    document.querySelectorAll(".scrub-btn").forEach((btn) => {
      btn.disabled = !can;
    });
  }

  function fmt(n, u) {
    const s = (Math.round(n * 100) / 100).toFixed(2);
    return s + " " + u;
  }

  function ux(id, v) {
    const n = el(id);
    if (n) n.textContent = v;
  }

  function syncDeltaLegsToggleUi() {
    const wrap = el("wrap-chk-delta-legs");
    const inp = el("chk-delta-legs");
    const txt = el("chk-delta-legs-text");
    if (!wrap || !inp) return;
    if (!isPlane()) return;
    wrap.classList.remove("toggle--dim-muted");
    inp.disabled = false;
    if (txt) txt.textContent = "Катеты Δx′ и Δy′ на сцене (|Δr′| не гасится)";
  }

  function syncChartTitles() {
    const tRoadVt = el("chart-title-road-vt");
    const tDelta = el("chart-title-delta");
    const tVrel = el("disp-vrel-label");
    const dtVrel = el("m-dt-vrel");
    if (tRoadVt) {
      tRoadVt.textContent = isPlane()
        ? "Модуль скорости |v(t)|, лабораторная система"
        : "Скорость v_x(t), лабораторная система";
    }
    if (tDelta) {
      tDelta.textContent = isPlane()
        ? "Расстояние |Δr(t)| между машинами"
        : "Разделение Δx(t) = x_B − x_A";
    }
    const relTxt = el("chk-relative-text");
    if (relTxt) {
      relTxt.textContent = isPlane()
        ? "Подсвечивать отрезок |Δr′| между машинами"
        : "Подсвечивать относительное расстояние";
    }
    if (tVrel) {
      tVrel.textContent = isPlane()
        ? "Вектор v_A − v_B (модуль и проекции)"
        : "Скорость A относительно B (по оси x)";
    }
    if (dtVrel) {
      dtVrel.innerHTML = isPlane()
        ? "v<sub>отн,x</sub> = v<sub>xA</sub> − v<sub>xB</sub>"
        : "v<sub>отн</sub> = v<sub>A</sub> − v<sub>B</sub>";
    }
  }

  function updateMetrics() {
    const k = kinematicsInFrame(state.frame, state.t);
    const { xaRoad, xbRoad, yaRoad, ybRoad, vaRoad, vbRoad, vyaRoad, vybRoad } = k;

    ux("disp-t", state.t.toFixed(2));
    ux("disp-timescale", String(state.timeScale));

    ux("m-xa-road", fmt(xaRoad, "м"));
    ux("m-xb-road", fmt(xbRoad, "м"));
    ux("m-va-road", fmt(vaRoad, "м/с"));
    ux("m-vb-road", fmt(vbRoad, "м/с"));
    ux("m-aa-road", fmt(state.aa, "м/с²"));
    ux("m-ab-road", fmt(state.ab, "м/с²"));
    const dta = el("m-dt-aa-road");
    const dtb = el("m-dt-ab-road");
    if (dta) dta.innerHTML = isPlane() ? "a<sub>∥A</sub> (вдоль направления)" : "a<sub>xA</sub>";
    if (dtb) dtb.innerHTML = isPlane() ? "a<sub>∥B</sub> (вдоль направления)" : "a<sub>xB</sub>";

    if (isPlane()) {
      ux("m-ya-road", fmt(yaRoad, "м"));
      ux("m-yb-road", fmt(ybRoad, "м"));
      ux("m-vya-road", fmt(vyaRoad, "м/с"));
      ux("m-vyb-road", fmt(vybRoad, "м/с"));
      const sA = vecLen(vaRoad, vyaRoad);
      const sB = vecLen(vbRoad, vybRoad);
      ux("m-vs-road", sA.toFixed(2) + " / " + sB.toFixed(2) + " м/с");
      const sub = el("disp-vrel-plane");
      if (sub) {
        const vrx0 = relativeVelocityX();
        const vry0 = relativeVelocityY();
        sub.textContent = "в лаб. СО: (" + vrx0.toFixed(2) + ", " + vry0.toFixed(2) + ") м/с";
      }
    } else {
      const sub = el("disp-vrel-plane");
      if (sub) sub.textContent = "";
    }

    ux("metric-frame-title", FRAME_TITLES[state.frame]);
    ux("metric-frame-sub", FRAME_SUBS[state.frame]);
    ux("m-xa-frame", fmt(k.xa, "м"));
    ux("m-xb-frame", fmt(k.xb, "м"));
    ux("m-va-frame", fmt(k.va, "м/с"));
    ux("m-vb-frame", fmt(k.vb, "м/с"));
    if (isPlane()) {
      ux("m-ya-frame", fmt(k.ya, "м"));
      ux("m-yb-frame", fmt(k.yb, "м"));
      ux("m-vya-frame", fmt(k.vya, "м/с"));
      ux("m-vyb-frame", fmt(k.vyb, "м/с"));
    }

    const vrx = relativeVelocityX();
    const vry = relativeVelocityY();
    const vmag = vecLen(vrx, vry);
    ux("m-vrel-card", fmt(vrx, "м/с"));
    if (isPlane()) {
      ux("m-vrel-y-card", fmt(vry, "м/с"));
      ux("m-vrel-mag-card", fmt(vmag, "м/с"));
      ux("m-dy", fmt(ybRoad - yaRoad, "м"));
      ux("m-dr", fmt(vecLen(xbRoad - xaRoad, ybRoad - yaRoad), "м"));
    }
    ux("m-dx", fmt(xbRoad - xaRoad, "м"));
    ux("disp-vrel", isPlane() ? fmt(vmag, "м/с") : fmt(vrx, "м/с"));

    const fill = el("vrel-fill");
    if (fill) {
      const vmax = isPlane() ? 99 : 70;
      const pct = Math.min(1, vmag / vmax) * 50;
      if (isPlane()) {
        fill.style.width = pct + "%";
        fill.style.marginLeft = "50%";
      } else {
        fill.style.width = pct + "%";
        fill.style.marginLeft = vrx >= 0 ? "50%" : 50 - pct + "%";
      }
    }

    ux("frame-lock-label", FRAME_LABELS[state.frame]);

    let note = "";
    if (isPlane()) {
      if (state.frame === "a")
        note =
          "В СО A вектор v′_A = 0: машина покоится, положение и скорость B задаются разностью r_B − r_A и v_B − v_A в плоскости.";
      else if (state.frame === "b")
        note = "В СО B аналогично: v′_B = 0, относительное движение A описывается теми же галилеевыми формулами по x и y.";
      else note = "В лабораторной системе видны обе скорости; переключение СО меняет и x′, и y′, и проекции скорости.";
    } else {
      if (state.frame === "a") note = "В системе A имеем v′A = 0, дорога «течёт» со скоростью −vA вдоль оси.";
      else if (state.frame === "b") note = "В системе B имеем v′B = 0, картина симметрична системе A.";
      else note = "В лабораторной системе видны обе скорости относительно шоссе.";
    }
    ux("m-frame-note", note);
  }

  function resizeStudyCanvases() {
    document.querySelectorAll(".study-canvas").forEach((cv) => {
      const wrap = cv.closest(".chart-block__canvas-wrap");
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = rect.width;
      if (cssW < 8) return;
      const cssH = Math.max(200, Math.min(340, cssW * 0.48));
      cv.dataset.cssW = String(cssW);
      cv.dataset.cssH = String(cssH);
      cv.width = Math.floor(cssW * dpr);
      cv.height = Math.floor(cssH * dpr);
      const c = cv.getContext("2d");
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }

  function resizeCanvases() {
    const wrap = canvas.closest("#canvas-main") || canvas.parentElement;
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = rect.width;
    const cssH = isPlane() ? Math.max(620, cssW * 0.56) : (cssW * 520) / 1200;
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    state.canvasCss = { w: cssW, h: cssH };
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    resizeStudyCanvases();
  }

  // --- Loop ---
  function tick(now) {
    if (!state.lastTs) state.lastTs = now;
    const dt = ((now - state.lastTs) / 1000) * state.timeScale;
    state.lastTs = now;

    if (state.playing) {
      state.t += dt;
      state.tRecorded = Math.max(state.tRecorded, state.t);
    }

    updateMetrics();
    drawScene(now);
    layoutPlaneAngleHud();
    syncAngleHudInputFromState();
    // Charts are expensive in path mode; throttle while playing to keep animation smooth.
    if (!state.playing || !state._chartsLast || now - state._chartsLast > 120) {
      state._chartsLast = now;
      drawAllStudyCharts();
    }
    syncScrubUI();
    requestAnimationFrame(tick);
  }

  // --- Events ---
  function setPlaying(v) {
    state.playing = v;
    state.lastTs = 0;
    if (isPlane()) {
      // During playback — always auto-fit (for clarity)
      state.planeView.mode = "auto";
    }
    syncPlaybackButton();
  }

  function bindSlider(id, key, valId, isInt) {
    const input = el(id);
    const disp = el(valId);
    if (!input || !disp) return;
    const isNum = disp.tagName === "INPUT";
    const fmtVal = (v) => (isInt ? String(Math.round(v)) : Number(v).toFixed(1));
    const clamp = (v) => Math.min(Number(input.max), Math.max(Number(input.min), v));
    const syncNumAttrs = () => {
      if (isNum) {
        disp.min = input.min;
        disp.max = input.max;
        disp.step = input.getAttribute("step") || "any";
      }
    };
    const updateDisp = () => {
      const v = Number(input.value);
      if (isNum) disp.value = fmtVal(v);
      else disp.textContent = fmtVal(v);
    };
    input.addEventListener("input", () => {
      state[key] = Number(input.value);
      updateDisp();
      state.t = 0;
      state.tRecorded = 0;
    });
    if (isNum) {
      const commitNum = () => {
        let v = parseFloat(String(disp.value).replace(",", "."));
        if (!Number.isFinite(v)) {
          updateDisp();
          return;
        }
        v = clamp(v);
        state[key] = v;
        input.value = String(v);
        disp.value = fmtVal(v);
        state.t = 0;
        state.tRecorded = 0;
      };
      disp.addEventListener("change", commitNum);
      disp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          disp.blur();
          commitNum();
        }
      });
    }
    if (isNum) syncNumAttrs();
    updateDisp();
  }

  bindSlider("x0a", "x0a", "val-x0a", false);
  bindSlider("x0b", "x0b", "val-x0b", false);
  bindSlider("aa", "aa", "val-aa", false);
  bindSlider("ab", "ab", "val-ab", false);

  const SLIDER_KEYS = ["x0a", "x0b", "aa", "ab", "y0a", "y0b", "vya", "vyb"];

  function syncLinePlaneSliderUi() {
    const vaIn = el("va");
    const vbIn = el("vb");
    const vaDisp = el("val-va");
    const vbDisp = el("val-vb");
    const lblA = el("label-va");
    const lblB = el("label-vb");
    const title = el("block-initial-title");
    if (title) {
      title.textContent = isPlane() ? "Начальные условия (плоскость xy)" : "Начальные условия (дорога)";
    }
    syncPlaneAccelSliderLabels();
    if (!vaIn || !vbIn || !vaDisp || !vbDisp) return;
    const setVelDisp = (d, v) => {
      if (d.tagName === "INPUT") d.value = v.toFixed(1);
      else d.textContent = v.toFixed(1);
    };
    if (isPlane()) {
      vaIn.min = "0";
      vaIn.max = "35";
      vbIn.min = "0";
      vbIn.max = "35";
      syncPolarFromComponents();
      vaIn.value = String(state.speedA);
      vbIn.value = String(state.speedB);
      if (vaDisp.tagName === "INPUT") {
        vaDisp.min = "0";
        vaDisp.max = "35";
        vaDisp.step = vaIn.step || "0.5";
      }
      if (vbDisp.tagName === "INPUT") {
        vbDisp.min = "0";
        vbDisp.max = "35";
        vbDisp.step = vbIn.step || "0.5";
      }
      if (!(vaDisp.tagName === "INPUT" && document.activeElement === vaDisp)) setVelDisp(vaDisp, state.speedA);
      if (!(vbDisp.tagName === "INPUT" && document.activeElement === vbDisp)) setVelDisp(vbDisp, state.speedB);
      if (lblA) {
        lblA.innerHTML =
          '<span class="tag tag--a">A</span> Модуль начальной скорости <span class="mono">|v₀|</span> (м/с), ≥ 0';
      }
      if (lblB) {
        lblB.innerHTML =
          '<span class="tag tag--b">B</span> Модуль начальной скорости <span class="mono">|v₀|</span> (м/с), ≥ 0';
      }
    } else {
      vaIn.min = "-35";
      vaIn.max = "35";
      vbIn.min = "-35";
      vbIn.max = "35";
      vaIn.value = String(state.va);
      vbIn.value = String(state.vb);
      if (vaDisp.tagName === "INPUT") {
        vaDisp.min = "-35";
        vaDisp.max = "35";
        vaDisp.step = vaIn.step || "0.5";
      }
      if (vbDisp.tagName === "INPUT") {
        vbDisp.min = "-35";
        vbDisp.max = "35";
        vbDisp.step = vbIn.step || "0.5";
      }
      if (!(vaDisp.tagName === "INPUT" && document.activeElement === vaDisp)) setVelDisp(vaDisp, state.va);
      if (!(vbDisp.tagName === "INPUT" && document.activeElement === vbDisp)) setVelDisp(vbDisp, state.vb);
      if (lblA) lblA.innerHTML = '<span class="tag tag--a">A</span> Скорость <span class="mono">v</span> (м/с)';
      if (lblB) lblB.innerHTML = '<span class="tag tag--b">B</span> Скорость <span class="mono">v</span> (м/с)';
    }
  }

  function syncPlaneAccelSliderLabels() {
    const la = el("label-aa");
    const lb = el("label-ab");
    if (!la || !lb) return;
    if (isPlane()) {
      la.innerHTML =
        '<span class="tag tag--a">A</span> Ускорение <span class="mono">a</span> вдоль направления движения (м/с²)';
      lb.innerHTML =
        '<span class="tag tag--b">B</span> Ускорение <span class="mono">a</span> вдоль направления движения (м/с²)';
    } else {
      la.innerHTML = '<span class="tag tag--a">A</span> Ускорение a<sub>xA</sub> (м/с²)';
      lb.innerHTML = '<span class="tag tag--b">B</span> Ускорение a<sub>xB</sub> (м/с²)';
    }
  }

  function wireVelocitySliders() {
    const vaIn = el("va");
    const vbIn = el("vb");
    const vaDisp = el("val-va");
    const vbDisp = el("val-vb");
    if (!vaIn || !vbIn || !vaDisp || !vbDisp) return;
    const setVD = (d, v) => {
      if (d.tagName === "INPUT") d.value = v.toFixed(1);
      else d.textContent = v.toFixed(1);
    };
    vaIn.addEventListener("input", () => {
      const raw = Number(vaIn.value);
      if (isPlane()) {
        const v = Math.max(0, raw);
        state.speedA = v;
        applyPolarVelocity("a");
        vaIn.value = String(v);
        setVD(vaDisp, v);
      } else {
        state.va = raw;
        setVD(vaDisp, raw);
      }
      state.t = 0;
      state.tRecorded = 0;
    });
    vbIn.addEventListener("input", () => {
      const raw = Number(vbIn.value);
      if (isPlane()) {
        const v = Math.max(0, raw);
        state.speedB = v;
        applyPolarVelocity("b");
        vbIn.value = String(v);
        setVD(vbDisp, v);
      } else {
        state.vb = raw;
        setVD(vbDisp, raw);
      }
      state.t = 0;
      state.tRecorded = 0;
    });
  }

  wireVelocitySliders();

  function wireVelocityNumberInputs() {
    const vaIn = el("va");
    const vbIn = el("vb");
    const vaDisp = el("val-va");
    const vbDisp = el("val-vb");
    if (!vaIn || !vbIn || !vaDisp || !vbDisp || vaDisp.tagName !== "INPUT" || vbDisp.tagName !== "INPUT") return;
    const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const commitVa = () => {
      let v = parseFloat(String(vaDisp.value).replace(",", "."));
      if (!Number.isFinite(v)) return;
      if (isPlane()) {
        v = clampN(v, 0, 35);
        state.speedA = v;
        applyPolarVelocity("a");
      } else {
        v = clampN(v, -35, 35);
        state.va = v;
      }
      vaIn.value = String(v);
      vaDisp.value = v.toFixed(1);
      state.t = 0;
      state.tRecorded = 0;
    };
    const commitVb = () => {
      let v = parseFloat(String(vbDisp.value).replace(",", "."));
      if (!Number.isFinite(v)) return;
      if (isPlane()) {
        v = clampN(v, 0, 35);
        state.speedB = v;
        applyPolarVelocity("b");
      } else {
        v = clampN(v, -35, 35);
        state.vb = v;
      }
      vbIn.value = String(v);
      vbDisp.value = v.toFixed(1);
      state.t = 0;
      state.tRecorded = 0;
    };
    vaDisp.addEventListener("change", commitVa);
    vaDisp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        vaDisp.blur();
        commitVa();
      }
    });
    vbDisp.addEventListener("change", commitVb);
    vbDisp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        vbDisp.blur();
        commitVb();
      }
    });
  }

  wireVelocityNumberInputs();

  function writeStateToSliders() {
    SLIDER_KEYS.forEach((key) => {
      const inp = el(key);
      const vd = el("val-" + key);
      if (inp) inp.value = String(state[key]);
      if (vd) {
        const s = Number(state[key]).toFixed(1);
        if (vd.tagName === "INPUT") vd.value = s;
        else vd.textContent = s;
      }
    });
    syncLinePlaneSliderUi();
  }

  function updateRailReadouts() {
    const rx = el("rail-x0");
    const ry = el("rail-y0");
    const vx = el("rail-x0-val");
    const vy = el("rail-y0-val");
    if (!rx || !ry) return;
    const active = isPlane() && state.planeSelectedCar && state.frame === "road" && !rx.disabled;
    if (!active) {
      if (vx) {
        if (vx.tagName === "INPUT") {
          vx.value = "";
          vx.disabled = true;
        } else vx.textContent = "";
      }
      if (vy) {
        if (vy.tagName === "INPUT") {
          vy.value = "";
          vy.disabled = true;
        } else vy.textContent = "";
      }
      return;
    }
    if (vx) {
      if (vx.tagName === "INPUT") {
        vx.disabled = false;
        vx.min = rx.min;
        vx.max = rx.max;
        vx.step = rx.step || "0.1";
        if (document.activeElement !== vx) vx.value = Number(rx.value).toFixed(1);
      } else vx.textContent = Number(rx.value).toFixed(1) + " м";
    }
    if (vy) {
      if (vy.tagName === "INPUT") {
        vy.disabled = false;
        vy.min = ry.min;
        vy.max = ry.max;
        vy.step = ry.step || "0.1";
        if (document.activeElement !== vy) vy.value = Number(ry.value).toFixed(1);
      } else vy.textContent = Number(ry.value).toFixed(1) + " м";
    }
  }

  function syncRailsFromState() {
    const wrap = el("canvas-plane-rails");
    const float = el("plane-path-float");
    const rx = el("rail-x0");
    const ry = el("rail-y0");
    const capx = el("rail-x-caption");
    const capy = el("rail-y-caption");
    if (!rx || !ry) return;
    const showRails = isPlane() && state.planeSelectedCar && state.frame === "road";
    if (wrap) {
      wrap.classList.toggle("is-visible", showRails);
      wrap.setAttribute("aria-hidden", showRails ? "false" : "true");
    }
    if (float) float.hidden = !showRails;
    if (!showRails) {
      rx.disabled = true;
      ry.disabled = true;
      if (capx) capx.textContent = "x₀";
      if (capy) capy.textContent = "y₀";
      updateRailReadouts();
      return;
    }
    rx.disabled = false;
    ry.disabled = false;
    if (state.planeSelectedCar === "a") {
      rx.value = String(state.x0a);
      ry.value = String(state.y0a);
      if (capx) capx.textContent = "x₀ (A)";
      if (capy) capy.textContent = "y₀ (A)";
    } else {
      rx.value = String(state.x0b);
      ry.value = String(state.y0b);
      if (capx) capx.textContent = "x₀ (B)";
      if (capy) capy.textContent = "y₀ (B)";
    }
    updateRailReadouts();
  }

  function updatePlanePanelUI() {
    const lbl = el("plane-selection-label");
    if (!lbl) return;
    if (!isPlane()) {
      lbl.textContent = "";
      return;
    }
    if (state.frame !== "road") {
      lbl.textContent = "Чтобы менять x₀, y₀ и направление, выберите систему «дорога».";
      return;
    }
    if (!state.planeSelectedCar) {
      lbl.textContent = "Нажмите на машину A или B на поле";
      return;
    }
    const car = state.planeSelectedCar;
    if (car === "a") {
      lbl.textContent =
        "Выбрана машина A · x₀ = " + state.x0a.toFixed(1) + " м, y₀ = " + state.y0a.toFixed(1) + " м" +
        (state.planeMotionMode === "ray"
          ? " · θ = " + labVelocityAngleDeg(state.thetaA).toFixed(1) + "° (0° — вправо, +x)"
          : " · режим: траектория");
    } else {
      lbl.textContent =
        "Выбрана машина B · x₀ = " + state.x0b.toFixed(1) + " м, y₀ = " + state.y0b.toFixed(1) + " м" +
        (state.planeMotionMode === "ray"
          ? " · θ = " + labVelocityAngleDeg(state.thetaB).toFixed(1) + "° (0° — вправо, +x)"
          : " · режим: траектория");
    }
  }

  function canvasCssPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * state.canvasCss.w;
    const y = ((clientY - rect.top) / rect.height) * state.canvasCss.h;
    return { x, y };
  }

  function planeWorldAtPointer(e) {
    const pl = state.planeLayout;
    if (!pl) return null;
    const p = canvasCssPoint(e.clientX, e.clientY);
    const world = screenToWorldPlane(p.x, p.y, pl.b, pl.padL, pl.padT, pl.drawW, pl.drawH);
    return { p, world, pl };
  }

  function onPlaneCanvasPointerDown(e) {
    if (!isPlane()) return;
    const pl = state.planeLayout;
    if (!pl || pl.ax == null) return;
    const p = canvasCssPoint(e.clientX, e.clientY);
    const dist = (ax, ay) => vecLen(p.x - ax, p.y - ay);

    // Pan camera anywhere in plane mode.
    // Works in all frames/modes (trajectory not required).
    if (e.button === 1 || e.shiftKey || e.altKey) {
      state.planePathDrag = { which: "view", idx: -1, pid: e.pointerId, sx: p.x, sy: p.y, cx: state.planeView.cx, cy: state.planeView.cy };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {}
      e.preventDefault();
      return;
    }

    // Only left click edits/selection (middle handled above as pan).
    if (e.button !== 0) return;
    if (
      state.planeMotionMode === "ray" &&
      state.planeSelectedCar &&
      state.frame === "road" &&
      pl.selCx != null &&
      pl.selCy != null &&
      pl.ringR
    ) {
      const dRing = dist(pl.selCx, pl.selCy);
      if (dRing > pl.ringR - 16 && dRing < pl.ringR + 22) {
        state.planeAngleDrag = true;
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch (_) {}
        e.preventDefault();
        return;
      }
    }
    // Path edit tools: must run BEFORE car-hit logic, because the first path point совпадает с машиной.
    // Also support cycling by clicking the start point even if the car wasn't selected yet.
    if (state.planeMotionMode === "path" && state.frame === "road") {
      const map = (wx, wy) => worldToPlaneScreen(wx, wy, pl.b, pl.padL, pl.padT, pl.drawW, pl.drawH);
      const tool = state.planePathTool || "pen";

      // Hand tool: select car for editing, or click empty space to hide all edit markings.
      if (tool === "hand") {
        const r = pl.hitR || 28;
        if (dist(pl.ax, pl.ay) < r) {
          state.planeSelectedCar = "a";
          syncRailsFromState();
          updatePlanePanelUI();
          e.preventDefault();
          return;
        }
        if (dist(pl.bx, pl.by) < r) {
          state.planeSelectedCar = "b";
          syncRailsFromState();
          updatePlanePanelUI();
          e.preventDefault();
          return;
        }
        state.planeSelectedCar = null;
        state.planeAngleDrag = false;
        state.planePathDrag = null;
        syncRailsFromState();
        updatePlanePanelUI();
        e.preventDefault();
        return;
      }

      // Pen: click the start point (idx 0) of A/B to toggle closed/open.
      if (tool === "pen") {
        ensurePlanePath("a");
        ensurePlanePath("b");
        const pa = getPlanePath("a");
        const pb = getPlanePath("b");
        const hitStart = (which, path) => {
          if (!Array.isArray(path) || path.length < 3) return false;
          const s0 = map(path[0].x, path[0].y);
          return vecLen(p.x - s0.sx, p.y - s0.sy) < 12;
        };
        let whichHit = null;
        if (hitStart("a", pa)) whichHit = "a";
        else if (hitStart("b", pb)) whichHit = "b";
        if (whichHit) {
          if (typeof state._pushPlanePathHistory === "function") state._pushPlanePathHistory(whichHit);
          setPlanePathClosed(whichHit, !getPlanePathClosed(whichHit));
          rebuildPlanePathCache(whichHit);
          state.planeSelectedCar = whichHit;
          syncRailsFromState();
          state.t = 0;
          state.tRecorded = 0;
          updatePlanePanelUI();
          e.preventDefault();
          return;
        }
      }

      if (state.planeSelectedCar) {
        ensurePlanePath(state.planeSelectedCar);
        const path = getPlanePath(state.planeSelectedCar);
        if (Array.isArray(path)) {
          // hit test points in screen space
          let hitIdx = -1;
          for (let i = 0; i < path.length; i++) {
            const s = map(path[i].x, path[i].y);
            if (vecLen(p.x - s.sx, p.y - s.sy) < 12) {
              hitIdx = i;
              break;
            }
          }
          if (tool === "erase") {
            if (hitIdx >= 0 && path.length > 2) {
              if (typeof state._pushPlanePathHistory === "function") state._pushPlanePathHistory(state.planeSelectedCar);
              path.splice(hitIdx, 1);
              if (hitIdx === 0) {
                // keep anchor at index 0
                path[0].x = state.planeSelectedCar === "a" ? state.x0a : state.x0b;
                path[0].y = state.planeSelectedCar === "a" ? state.y0a : state.y0b;
              }
              state.t = 0;
              state.tRecorded = 0;
              rebuildPlanePathCache(state.planeSelectedCar);
              updatePlanePanelUI();
              e.preventDefault();
              return;
            }
            e.preventDefault();
            return;
          }
          if (tool === "move") {
            if (hitIdx >= 0) {
              state.planePathDrag = { which: state.planeSelectedCar, idx: hitIdx, pid: e.pointerId };
              try {
                canvas.setPointerCapture(e.pointerId);
              } catch (_) {}
              e.preventDefault();
              return;
            }
            // shift whole view (pan) by dragging empty space
            state.planePathDrag = { which: "view", idx: -1, pid: e.pointerId, sx: p.x, sy: p.y, cx: state.planeView.cx, cy: state.planeView.cy };
            try {
              canvas.setPointerCapture(e.pointerId);
            } catch (_) {}
            e.preventDefault();
            return;
          }
          // tool === 'pen'
          if (hitIdx >= 0) {
            // Pen: click the first point to toggle closed/open (cycle)
            if (hitIdx === 0 && path.length >= 3) {
              if (typeof state._pushPlanePathHistory === "function") state._pushPlanePathHistory(state.planeSelectedCar);
              setPlanePathClosed(state.planeSelectedCar, !getPlanePathClosed(state.planeSelectedCar));
              rebuildPlanePathCache(state.planeSelectedCar);
              state.t = 0;
              state.tRecorded = 0;
              updatePlanePanelUI();
            }
            e.preventDefault();
            return;
          }
          const world = screenToWorldPlane(p.x, p.y, pl.b, pl.padL, pl.padT, pl.drawW, pl.drawH);
          if (typeof state._pushPlanePathHistory === "function") state._pushPlanePathHistory(state.planeSelectedCar);
          path.push({ x: world.wx, y: world.wy });
          state.t = 0;
          state.tRecorded = 0;
          rebuildPlanePathCache(state.planeSelectedCar);
          updatePlanePanelUI();
          e.preventDefault();
          return;
        }
      }
    }

    const r = pl.hitR || 28;
    if (dist(pl.ax, pl.ay) < r) {
      state.planeSelectedCar = "a";
      syncRailsFromState();
      updatePlanePanelUI();
      e.preventDefault();
      return;
    }
    if (dist(pl.bx, pl.by) < r) {
      state.planeSelectedCar = "b";
      syncRailsFromState();
      updatePlanePanelUI();
      e.preventDefault();
      return;
    }

    state.planeSelectedCar = null;
    syncRailsFromState();
    updatePlanePanelUI();
  }

  function onPlaneCanvasPointerMove(e) {
    if (!isPlane()) return;
    if (state.planePathDrag) {
      const pl = state.planeLayout;
      if (!pl) return;
      const drag = state.planePathDrag;
      if (drag.which === "view") {
        // pan view by pointer delta in screen -> world
        const p = canvasCssPoint(e.clientX, e.clientY);
        const dxPx = p.x - drag.sx;
        const dyPx = p.y - drag.sy;
        const b = pl.b;
        const span = b.maxX - b.minX;
        const dxW = (dxPx / pl.drawW) * span;
        const dyW = -(dyPx / pl.drawH) * span;
        state.planeView.cx = drag.cx - dxW;
        state.planeView.cy = drag.cy - dyW;
        state.planeView.mode = "manual";
        e.preventDefault();
        return;
      }
      // Point dragging is only available in road-edit mode
      if (!pl.roadEdit) return;
      const path = getPlanePath(drag.which);
      if (!Array.isArray(path) || !path[drag.idx]) return;
      // record undo snapshot once per drag
      if (!drag.didSnap && typeof state._pushPlanePathHistory === "function") {
        state._pushPlanePathHistory(drag.which);
        drag.didSnap = true;
      }
      const p = canvasCssPoint(e.clientX, e.clientY);
      const world = screenToWorldPlane(p.x, p.y, pl.b, pl.padL, pl.padT, pl.drawW, pl.drawH);
      path[drag.idx].x = world.wx;
      path[drag.idx].y = world.wy;
      if (drag.which === "a" && drag.idx === 0) {
        state.x0a = world.wx;
        state.y0a = world.wy;
      } else if (drag.which === "b" && drag.idx === 0) {
        state.x0b = world.wx;
        state.y0b = world.wy;
      }
      syncRailsFromState();
      updatePlanePanelUI();
      state.t = 0;
      state.tRecorded = 0;
      rebuildPlanePathCache(drag.which);
      // In path mode, keep θ consistent with the tangent at start (for UI/labels elsewhere)
      if (drag.which === "a" || drag.which === "b") {
        const which = drag.which;
        if (!getPlanePathCache(which)) rebuildPlanePathCache(which);
        const p0 = samplePlanePathAtS(which, 0);
        const th0 = Math.atan2(p0.ty, p0.tx);
        if (which === "a") state.thetaA = th0;
        else state.thetaB = th0;
      }
      e.preventDefault();
      return;
    }
    if (!state.planeAngleDrag) return;
    const pl = state.planeLayout;
    if (!pl || !pl.roadEdit) return;
    const car = state.planeSelectedCar;
    if (!car) return;
    const p = canvasCssPoint(e.clientX, e.clientY);
    const world = screenToWorldPlane(p.x, p.y, pl.b, pl.padL, pl.padT, pl.drawW, pl.drawH);
    const x0 = car === "a" ? state.x0a : state.x0b;
    const y0 = car === "a" ? state.y0a : state.y0b;
    const th = Math.atan2(world.wy - y0, world.wx - x0);
    if (car === "a") state.thetaA = th;
    else state.thetaB = th;
    applyPolarVelocity(car);
    state.t = 0;
    state.tRecorded = 0;
    updatePlanePanelUI();
    e.preventDefault();
  }

  function onPlaneCanvasPointerUp(e) {
    if (state.planeAngleDrag) {
      state.planeAngleDrag = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
      updatePlanePanelUI();
    }
    if (state.planePathDrag) {
      state.planePathDrag = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
      updatePlanePanelUI();
    }
  }

  canvas.addEventListener("pointerdown", onPlaneCanvasPointerDown);
  canvas.addEventListener("pointermove", onPlaneCanvasPointerMove);
  canvas.addEventListener("pointerup", onPlaneCanvasPointerUp);
  canvas.addEventListener("pointercancel", onPlaneCanvasPointerUp);

  // Zoom with wheel in plane mode (any mode/frame).
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!isPlane()) return;
      e.preventDefault();
      const dz = e.deltaY > 0 ? 0.92 : 1.08;
      const z0 = state.planeView.zoom || 1;
      const z1 = Math.max(0.6, Math.min(2.6, z0 * dz));
      state.planeView.zoom = z1;
      state.planeView.mode = "manual";
      const zInp = el("plane-zoom");
      const zNum = el("plane-zoom-num");
      if (zInp) zInp.value = String(z1);
      if (zNum) zNum.value = String(z1.toFixed(1));
      if (zInp) {
        const min = Number(zInp.min || 0);
        const max = Number(zInp.max || 1);
        const p = max > min ? ((z1 - min) / (max - min)) * 100 : 0;
        zInp.style.background = `linear-gradient(90deg, rgba(45,140,255,0.95) 0%, rgba(45,140,255,0.95) ${p}%, rgba(255,255,255,0.92) ${p}%, rgba(255,255,255,0.92) 100%)`;
      }
    },
    { passive: false },
  );

  const railX = el("rail-x0");
  if (railX) {
    railX.addEventListener("input", (e) => {
      if (!isPlane() || !state.planeSelectedCar) return;
      const v = Number(e.target.value);
      if (state.planeSelectedCar === "a") {
        const dx = v - state.x0a;
        state.x0a = v;
        if (isPlane() && state.planeMotionMode === "path") shiftPlanePath("a", dx, 0);
      } else {
        const dx = v - state.x0b;
        state.x0b = v;
        if (isPlane() && state.planeMotionMode === "path") shiftPlanePath("b", dx, 0);
      }
      state.t = 0;
      state.tRecorded = 0;
      updateRailReadouts();
      updatePlanePanelUI();
    });
  }
  const railY = el("rail-y0");
  if (railY) {
    railY.addEventListener("input", (e) => {
      if (!isPlane() || !state.planeSelectedCar) return;
      const v = Number(e.target.value);
      if (state.planeSelectedCar === "a") {
        const dy = v - state.y0a;
        state.y0a = v;
        if (isPlane() && state.planeMotionMode === "path") shiftPlanePath("a", 0, dy);
      } else {
        const dy = v - state.y0b;
        state.y0b = v;
        if (isPlane() && state.planeMotionMode === "path") shiftPlanePath("b", 0, dy);
      }
      state.t = 0;
      state.tRecorded = 0;
      updateRailReadouts();
      updatePlanePanelUI();
    });
  }

  const railNumX = el("rail-x0-val");
  if (railNumX && railNumX.tagName === "INPUT") {
    railNumX.addEventListener("change", () => {
      if (!isPlane() || !state.planeSelectedCar || state.frame !== "road") return;
      const rx = el("rail-x0");
      let v = parseFloat(String(railNumX.value).replace(",", "."));
      if (!Number.isFinite(v)) return;
      v = Math.min(80, Math.max(-80, v));
      railNumX.value = v.toFixed(1);
      if (rx) rx.value = String(v);
      if (state.planeSelectedCar === "a") {
        const dx = v - state.x0a;
        state.x0a = v;
        if (isPlane() && state.planeMotionMode === "path") shiftPlanePath("a", dx, 0);
      } else {
        const dx = v - state.x0b;
        state.x0b = v;
        if (isPlane() && state.planeMotionMode === "path") shiftPlanePath("b", dx, 0);
      }
      state.t = 0;
      state.tRecorded = 0;
      updatePlanePanelUI();
    });
    railNumX.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        railNumX.blur();
        railNumX.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }
  const railNumY = el("rail-y0-val");
  if (railNumY && railNumY.tagName === "INPUT") {
    railNumY.addEventListener("change", () => {
      if (!isPlane() || !state.planeSelectedCar || state.frame !== "road") return;
      const ry = el("rail-y0");
      let v = parseFloat(String(railNumY.value).replace(",", "."));
      if (!Number.isFinite(v)) return;
      v = Math.min(80, Math.max(-80, v));
      railNumY.value = v.toFixed(1);
      if (ry) ry.value = String(v);
      if (state.planeSelectedCar === "a") {
        const dy = v - state.y0a;
        state.y0a = v;
        if (isPlane() && state.planeMotionMode === "path") shiftPlanePath("a", 0, dy);
      } else {
        const dy = v - state.y0b;
        state.y0b = v;
        if (isPlane() && state.planeMotionMode === "path") shiftPlanePath("b", 0, dy);
      }
      state.t = 0;
      state.tRecorded = 0;
      updatePlanePanelUI();
    });
    railNumY.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        railNumY.blur();
        railNumY.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }

  const angInp = el("inp-theta-deg");
  if (angInp) {
    angInp.addEventListener("focus", () => {
      state.angleHudFocused = true;
    });
    angInp.addEventListener("blur", () => {
      state.angleHudFocused = false;
      syncAngleHudInputFromState();
    });
    angInp.addEventListener("change", applyThetaDegFromInput);
    angInp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        angInp.blur();
        applyThetaDegFromInput();
      }
    });
  }

  const chkLegs = el("chk-delta-legs");
  if (chkLegs) {
    state.showDeltaLegs = chkLegs.checked;
    chkLegs.addEventListener("change", (e) => {
      state.showDeltaLegs = e.target.checked;
    });
  }

  function setSegActive(groupEl, activeBtn) {
    if (!groupEl) return;
    groupEl.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("is-active", b === activeBtn));
  }

  function wirePlanePathToolbar() {
    const toolsWrap = el("plane-path-tools");
    const btnHand = el("tool-path-hand");
    const btnPen = el("tool-path-pen");
    const btnMove = el("tool-path-move");
    const btnErase = el("tool-path-erase");
    const z = el("plane-zoom");
    const zNum = el("plane-zoom-num");
    const zMinus = el("btn-zoom-minus");
    const zPlus = el("btn-zoom-plus");
    const undoBtn = el("btn-path-undo");
    const redoBtn = el("btn-path-redo");
    if (btnHand) {
      btnHand.addEventListener("click", () => {
        state.planePathTool = "hand";
        setSegActive(btnHand.parentElement, btnHand);
      });
    }
    if (btnPen) {
      btnPen.addEventListener("click", () => {
        state.planePathTool = "pen";
        setSegActive(btnPen.parentElement, btnPen);
      });
    }
    if (btnMove) {
      btnMove.addEventListener("click", () => {
        state.planePathTool = "move";
        setSegActive(btnMove.parentElement, btnMove);
      });
    }
    if (btnErase) {
      btnErase.addEventListener("click", () => {
        state.planePathTool = "erase";
        setSegActive(btnErase.parentElement, btnErase);
      });
    }
    const applyZoom = (v) => {
      if (!Number.isFinite(v)) return;
      v = Math.max(0.6, Math.min(2.6, v));
      state.planeView.zoom = v;
      state.planeView.mode = "manual";
      if (z) z.value = String(v);
      if (zNum) zNum.value = String(v.toFixed(1));
      syncZoomTrackFill();
    };
    const syncZoomTrackFill = () => {
      if (!z) return;
      const min = Number(z.min || 0);
      const max = Number(z.max || 1);
      const v = Number(z.value || 0);
      const p = max > min ? ((v - min) / (max - min)) * 100 : 0;
      // Blue filled left, white right (mockup)
      z.style.background = `linear-gradient(90deg, rgba(45,140,255,0.95) 0%, rgba(45,140,255,0.95) ${p}%, rgba(255,255,255,0.92) ${p}%, rgba(255,255,255,0.92) 100%)`;
    };
    if (z) z.addEventListener("input", () => applyZoom(Number(z.value)));
    if (zNum) zNum.addEventListener("change", () => applyZoom(parseFloat(String(zNum.value).replace(",", "."))));
    if (zMinus) zMinus.addEventListener("click", () => applyZoom((state.planeView.zoom || 1) - 0.1));
    if (zPlus) zPlus.addEventListener("click", () => applyZoom((state.planeView.zoom || 1) + 0.1));

    const getUndoStack = (which) => (which === "a" ? state.planePathUndoA : state.planePathUndoB);
    const getRedoStack = (which) => (which === "a" ? state.planePathRedoA : state.planePathRedoB);
    const pushHistory = (which) => {
      const path = getPlanePath(which);
      const snap = {
        path: Array.isArray(path) ? path.map((p) => ({ x: p.x, y: p.y })) : null,
        closed: getPlanePathClosed(which),
      };
      const u = getUndoStack(which);
      u.push(snap);
      // new edit invalidates redo
      getRedoStack(which).length = 0;
      // cap memory
      if (u.length > 120) u.shift();
    };
    // Expose for pointer handlers
    state._pushPlanePathHistory = pushHistory;

    const applySnapshot = (which, snap) => {
      setPlanePath(which, snap.path ? snap.path.map((p) => ({ x: p.x, y: p.y })) : null);
      if (snap.path) ensurePlanePath(which);
      setPlanePathClosed(which, !!snap.closed);
      rebuildPlanePathCache(which);
      state.t = 0;
      state.tRecorded = 0;
      updatePlanePanelUI();
    };
    const doUndo = () => {
      if (!isPlane() || state.planeMotionMode !== "path" || !state.planeSelectedCar) return;
      const which = state.planeSelectedCar;
      const u = getUndoStack(which);
      if (!u.length) return;
      const cur = { path: (getPlanePath(which) || null) && getPlanePath(which).map((p) => ({ x: p.x, y: p.y })), closed: getPlanePathClosed(which) };
      getRedoStack(which).push(cur);
      applySnapshot(which, u.pop());
    };
    const doRedo = () => {
      if (!isPlane() || state.planeMotionMode !== "path" || !state.planeSelectedCar) return;
      const which = state.planeSelectedCar;
      const r = getRedoStack(which);
      if (!r.length) return;
      const cur = { path: (getPlanePath(which) || null) && getPlanePath(which).map((p) => ({ x: p.x, y: p.y })), closed: getPlanePathClosed(which) };
      getUndoStack(which).push(cur);
      applySnapshot(which, r.pop());
    };
    if (undoBtn) undoBtn.addEventListener("click", doUndo);
    if (redoBtn) redoBtn.addEventListener("click", doRedo);

    // Init slider fill on load
    syncZoomTrackFill();
  }

  wirePlanePathToolbar();

  function setSiteModel(model) {
    if (model !== "lab" && model !== "line" && model !== "lightspeed") return;
    if ((state.siteModel || "line") === model) return;
    state.siteModel = model;
    document.body.classList.toggle("sim-site-line", model === "line");
    document.body.classList.toggle("is-lightspeed", model === "lightspeed");
    const longreadRoot = document.getElementById("longread-c-root");
    if (longreadRoot) {
      if (model === "lightspeed") longreadRoot.removeAttribute("hidden");
      else longreadRoot.setAttribute("hidden", "");
    }
    if (model === "line") {
      if (state.dimensionMode === "plane") setDimensionMode("line");
      state.planeMotionMode = "ray";
      state.planePathDrag = null;
      state.planeAngleDrag = false;
      state.planeSelectedCar = null;
      state.planeView = { mode: "auto", cx: 0, cy: 0, zoom: 1 };
    } else if (model === "lab") {
      if (state.dimensionMode !== "plane") setDimensionMode("plane");
    } else if (model === "lightspeed") {
      // Лонгрид существует независимо от обычной симуляции; останавливаем основной стенд.
    }
    state.t = 0;
    state.tRecorded = 0;
    setPlaying(false);
    syncSiteModelUi();
    syncPlaneMotionModeUI();
    syncRailsFromState();
    updatePlanePanelUI();
    resizeCanvases();
    updateMetrics();
    // Уведомляем модуль лонгрида о смене режима, чтобы запустить/остановить анимации
    document.dispatchEvent(new CustomEvent("ls:siteModelChange", { detail: { model } }));
  }

  function syncSiteModelUi() {
    const lab = el("btn-site-model-lab");
    const line = el("btn-site-model-line");
    const ls = el("btn-site-model-lightspeed");
    const m = state.siteModel || "line";
    if (lab) {
      lab.classList.toggle("is-active", m === "lab");
      lab.setAttribute("aria-pressed", m === "lab" ? "true" : "false");
    }
    if (line) {
      line.classList.toggle("is-active", m === "line");
      line.setAttribute("aria-pressed", m === "line" ? "true" : "false");
    }
    if (ls) {
      ls.classList.toggle("is-active", m === "lightspeed");
      ls.setAttribute("aria-pressed", m === "lightspeed" ? "true" : "false");
    }
    const theoryLine = document.querySelector(".model-theory--line");
    const theoryLab = document.querySelector(".model-theory--lab");
    if (theoryLine) theoryLine.setAttribute("aria-hidden", m === "line" ? "false" : "true");
    if (theoryLab) theoryLab.setAttribute("aria-hidden", m === "lab" ? "false" : "true");

    // Slide the pill indicator
    var activePill = document.querySelector(".model-picker__pill.is-active");
    var slider = document.querySelector(".model-picker__slider");
    if (activePill && slider) {
      var pills = activePill.closest(".model-picker__pills");
      if (pills) {
        var pRect = pills.getBoundingClientRect();
        var aRect = activePill.getBoundingClientRect();
        if (!slider._initialized) {
          slider.style.transition = "none";
          slider._initialized = true;
          requestAnimationFrame(function() {
            requestAnimationFrame(function() {
              slider.style.transition = "";
            });
          });
        }
        slider.style.left = (aRect.left - pRect.left) + "px";
        slider.style.width = aRect.width + "px";
      }
    }
  }

  function setDimensionMode(dim) {
    if (dim === "plane" && state.siteModel === "line") {
      showToast("В режиме «движение по прямой» плоскость недоступна. Переключите на «движение на плоскости».");
      return;
    }
    if (dim === state.dimensionMode) return;
    state.dimensionMode = dim;
    document.body.classList.toggle("sim-plane-mode", dim === "plane");
    document.querySelectorAll(".seg-btn--dim").forEach((b) => {
      const on = b.dataset.dim === dim;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (dim === "line") {
      state.y0a = 0;
      state.y0b = 0;
      state.vya = 0;
      state.vyb = 0;
      state.aya = 0;
      state.ayb = 0;
      state.planeSelectedCar = null;
      state.planeAngleDrag = false;
      writeStateToSliders();
      const sub = el("disp-vrel-plane");
      if (sub) sub.textContent = "";
    } else {
      syncPolarFromComponents();
      applyPolarVelocity("all");
      if (
        state.y0a === 0 &&
        state.y0b === 0 &&
        state.speedA < 1e-6 &&
        state.speedB < 1e-6
      ) {
        state.y0a = -12;
        state.y0b = 14;
        state.speedA = 12;
        state.speedB = 8;
        state.thetaA = 0.35;
        state.thetaB = 2.1;
        applyPolarVelocity("all");
      }
      writeStateToSliders();
    }
    state.t = 0;
    state.tRecorded = 0;
    setPlaying(false);
    syncChartTitles();
    canvas.setAttribute(
      "aria-label",
      dim === "plane" ? "Вид сверху: движение в плоскости xy" : "Визуализация движения машин вдоль дороги",
    );
    resizeCanvases();
    syncRailsFromState();
    updatePlanePanelUI();
    syncDeltaLegsToggleUi();
    syncPlaneMotionModeUI();
  }

  const btnSiteLab = el("btn-site-model-lab");
  const btnSiteLine = el("btn-site-model-line");
  const btnSiteLs = el("btn-site-model-lightspeed");
  if (btnSiteLab) btnSiteLab.addEventListener("click", () => setSiteModel("lab"));
  if (btnSiteLine) btnSiteLine.addEventListener("click", () => setSiteModel("line"));
  if (btnSiteLs) btnSiteLs.addEventListener("click", () => setSiteModel("lightspeed"));

  el("btn-play-pause").addEventListener("click", () => {
    setPlaying(!state.playing);
  });

  el("btn-reset").addEventListener("click", () => {
    state.t = 0;
    state.tRecorded = 0;
    setPlaying(false);
    showToast("Время сброшено, начальные условия сохранены");
  });

  function scrubSetTime(tNew) {
    const v = Math.max(0, Math.min(state.tRecorded, tNew));
    state.t = v;
  }

  function scrubStep(delta) {
    scrubSetTime(state.t + delta);
  }

  el("scrub-t").addEventListener("input", (e) => {
    const v = Number(e.target.value);
    state.t = Math.max(0, Math.min(state.tRecorded, v));
  });
  el("scrub-t").addEventListener("pointerdown", () => {
    state.scrubDragging = true;
  });
  window.addEventListener("pointerup", () => {
    state.scrubDragging = false;
  });
  window.addEventListener("pointercancel", () => {
    state.scrubDragging = false;
  });

  el("scrub-start").addEventListener("click", () => scrubSetTime(0));
  el("scrub-end").addEventListener("click", () => scrubSetTime(state.tRecorded));
  el("scrub-back-5").addEventListener("click", () => scrubStep(-5));
  el("scrub-back-1").addEventListener("click", () => scrubStep(-1));
  el("scrub-fwd-1").addEventListener("click", () => scrubStep(1));
  el("scrub-fwd-5").addEventListener("click", () => scrubStep(5));

  document.querySelectorAll("#timescale-group .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#timescale-group .seg-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      const ts = Number(btn.dataset.ts);
      if (!Number.isFinite(ts)) return;
      state.timeScale = ts;
    });
  });

  function setFrame(f) {
    if (f === state.frame) return;
    const oldFrame = state.frame;
    state.frame = f;
    document.querySelectorAll(".frame-btn").forEach((b) => {
      const on = b.dataset.frame === f;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    startFrameTransition(oldFrame);
    syncRailsFromState();
    updatePlanePanelUI();
  }

  document.querySelectorAll(".frame-btn").forEach((btn) => {
    btn.addEventListener("click", () => setFrame(btn.dataset.frame));
  });

  const PRESETS = {
    rest: () => ({
      x0a: -15,
      x0b: 15,
      va: 0,
      vb: 0,
      aa: 0,
      ab: 0,
      y0a: 0,
      y0b: 0,
      vya: 0,
      vyb: 0,
      aya: 0,
      ayb: 0,
    }),
    chase: () => ({
      x0a: -40,
      x0b: -10,
      va: 15,
      vb: 6,
      aa: 0,
      ab: 0,
      y0a: 0,
      y0b: 0,
      vya: 0,
      vyb: 0,
      aya: 0,
      ayb: 0,
    }),
    same: () => ({
      x0a: -25,
      x0b: 20,
      va: 10,
      vb: 10,
      aa: 0,
      ab: 0,
      y0a: 0,
      y0b: 0,
      vya: 0,
      vyb: 0,
      aya: 0,
      ayb: 0,
    }),
    headon: () => ({
      x0a: -35,
      x0b: 35,
      va: 12,
      vb: -10,
      aa: 0,
      ab: 0,
      y0a: 0,
      y0b: 0,
      vya: 0,
      vyb: 0,
      aya: 0,
      ayb: 0,
    }),
    faster: () => ({
      x0a: -30,
      x0b: 5,
      va: 18,
      vb: 6,
      aa: 0,
      ab: 0,
      y0a: 0,
      y0b: 0,
      vya: 0,
      vyb: 0,
      aya: 0,
      ayb: 0,
    }),
    negative: () => ({
      x0a: 30,
      x0b: -25,
      va: -8,
      vb: 10,
      aa: 0,
      ab: 0,
      y0a: 0,
      y0b: 0,
      vya: 0,
      vyb: 0,
      aya: 0,
      ayb: 0,
    }),
    "plane-cross": () => ({
      x0a: -38,
      y0a: -6,
      va: 14,
      vya: 2,
      aa: 0,
      aya: 0,
      x0b: -8,
      y0b: 26,
      vb: 4,
      vyb: -14,
      ab: 0,
      ayb: 0,
    }),
    "plane-overtake": () => ({
      x0a: -45,
      y0a: 2,
      va: 16,
      vya: 6,
      aa: -0.35,
      aya: 0,
      x0b: -5,
      y0b: -4,
      vb: 11,
      vyb: 1,
      ab: 0,
      ayb: 0,
    }),
    "plane-drift": () => ({
      x0a: -25,
      y0a: 0,
      va: 8,
      vya: 3,
      aa: 1.2,
      aya: 0,
      x0b: 18,
      y0b: 12,
      vb: 10.3,
      vyb: -9,
      ab: -0.6,
      ayb: 0,
    }),
  };

  function applyPreset(name) {
    const gen = PRESETS[name];
    if (!gen) return;
    if (String(name).startsWith("plane-")) {
      if (state.siteModel === "line") {
        showToast("В режиме «движение по прямой» сценарии для плоскости недоступны.");
        return;
      }
      if (state.dimensionMode !== "plane") setDimensionMode("plane");
    }
    const p = gen();
    Object.assign(state, p);
    if (isPlane()) {
      syncPolarFromComponents();
      applyPolarVelocity("all");
    }
    writeStateToSliders();
    state.t = 0;
    state.tRecorded = 0;
    showToast("Сценарий загружен");
    resizeCanvases();
    syncRailsFromState();
    updatePlanePanelUI();
    syncDeltaLegsToggleUi();
    syncPlaneMotionModeUI();
  }

  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
  });

  el("chk-traces").addEventListener("change", (e) => {
    state.traces = e.target.checked;
  });
  el("chk-relative").addEventListener("change", (e) => {
    state.relativeDelta = e.target.checked;
  });
  el("chk-tooltips").addEventListener("change", (e) => {
    state.tooltips = e.target.checked;
  });

  function syncPlaneMotionModeUI() {
    const btn = el("btn-path-mode");
    const hint = el("plane-path-hint");
    if (!btn) return;
    const on = isPlane() && state.planeMotionMode === "path";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    if (!isPlane()) {
      if (hint) hint.textContent = "";
      const tools = el("plane-path-tools");
      if (tools) tools.hidden = true;
      return;
    }
    const tools = el("plane-path-tools");
    if (tools) tools.hidden = !on;
    if (hint) {
      hint.textContent = on ? "Подсказка: Shift + drag — перемещение · Wheel — масштаб · Перо по старту — замкнуть · Рука: скрыть разметку" : "";
    }
  }

  const btnPathMode = el("btn-path-mode");
  if (btnPathMode) {
    btnPathMode.addEventListener("click", () => {
      if (!isPlane()) return;
      state.planeMotionMode = state.planeMotionMode === "path" ? "ray" : "path";
      if (state.planeMotionMode === "path") {
        ensurePlanePath("a");
        ensurePlanePath("b");
        if (state.planePathA && state.planePathA[0]) {
          state.x0a = state.planePathA[0].x;
          state.y0a = state.planePathA[0].y;
        }
        if (state.planePathB && state.planePathB[0]) {
          state.x0b = state.planePathB[0].x;
          state.y0b = state.planePathB[0].y;
        }
        fitPlaneViewToAll();
        state.planeView.mode = "manual";
      } else {
        state.planeView.mode = "auto";
        state.planeSelectedCar = null; // clean view on exit
      }
      state.planeAngleDrag = false;
      state.planePathDrag = null;
      state.t = 0;
      state.tRecorded = 0;
      syncRailsFromState();
      updatePlanePanelUI();
      syncPlaneMotionModeUI();
    });
  }

  el("btn-scroll-sim").addEventListener("click", () => {
    el("sim-section").scrollIntoView({ behavior: "smooth" });
  });

  function showToast(msg) {
    const t = el("toast-hint");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    t.classList.add("is-visible");
    clearTimeout(showToast._id);
    showToast._id = setTimeout(() => {
      t.classList.remove("is-visible");
      setTimeout(() => {
        t.hidden = true;
      }, 400);
    }, 2400);
  }

  window.addEventListener("resize", () => {
    resizeCanvases();
  });

  // --- Init ---
  syncChartTitles();
  syncPolarFromComponents();
  syncLinePlaneSliderUi();
  resizeCanvases();
  requestAnimationFrame(() => resizeCanvases());
  updateMetrics();
  syncPlaybackButton();
  syncScrubUI();
  syncRailsFromState();
  updatePlanePanelUI();
  syncDeltaLegsToggleUi();
  syncPlaneMotionModeUI();
  syncSiteModelUi();

  requestAnimationFrame(tick);
})();

/** Hero mini-canvas: фигуры Лиссажу — x=A cos(ωₓt), y=B sin(ωᵧt); целое отношение 5:4, замкнутая траектория. */
// ============================================================
// Hero canvas: gravitational N-body orbit simulation
// Shows a central "star" with 3 orbiting "planets" — real physics.
// ============================================================
/* ─── Hero: Neural-net sphere → global background ─── */
(function initHeroNeuralSphere() {
  "use strict";
  var stage = document.querySelector(".hero__bg");
  var canvas = document.getElementById("hero-orbit-canvas");
  if (!stage || !canvas) return;
  var ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  /* ── Force scroll to top on every page load ── */
  window.scrollTo(0, 0);
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  /* ── Safari / perf detection ── */
  var ua = navigator.userAgent;
  var isSafari = /Safari/.test(ua) && !/Chrome/.test(ua) && !/Chromium/.test(ua);
  var renderDPR = isSafari ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);

  var W = 0, H = 0, rafId = 0;
  var prefersReduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── Fibonacci-sphere nodes ── */
  var NODE_COUNT = isSafari ? 100 : 140;
  var nodes = [];
  var goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (var i = 0; i < NODE_COUNT; i++) {
    var y = 1 - (i / (NODE_COUNT - 1)) * 2;
    var r = Math.sqrt(1 - y * y);
    var theta = goldenAngle * i;
    nodes.push({ x: Math.cos(theta) * r, y: y, z: Math.sin(theta) * r });
  }

  /* ── k-nearest-neighbour edges ── */
  var edges = [];
  var edgeSet = {};
  for (var i = 0; i < nodes.length; i++) {
    var dists = [];
    for (var j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      var dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, dz = nodes[i].z - nodes[j].z;
      dists.push({ j: j, d: dx * dx + dy * dy + dz * dz });
    }
    dists.sort(function(a, b) { return a.d - b.d; });
    for (var k = 0; k < 3 && k < dists.length; k++) {
      var jj = dists[k].j;
      var key = Math.min(i, jj) + "-" + Math.max(i, jj);
      if (!edgeSet[key]) { edgeSet[key] = 1; edges.push({ a: Math.min(i, jj), b: Math.max(i, jj) }); }
    }
  }
  edgeSet = null;

  /* ── Adjacency list for pulse routing ── */
  var adjacency = new Array(nodes.length);
  for (var i = 0; i < nodes.length; i++) adjacency[i] = [];
  for (var i = 0; i < edges.length; i++) {
    adjacency[edges[i].a].push(i);
    adjacency[edges[i].b].push(i);
  }

  /* ── Pulses ── */
  var PULSE_COUNT = isSafari ? 12 : 20;
  var pulses = [];
  function spawnPulse() {
    return { edge: Math.floor(Math.random() * edges.length), t: Math.random(),
             speed: 0.001 + Math.random() * 0.002, dir: Math.random() < 0.5 ? 1 : -1,
             life: 0, maxLife: 3000 + Math.random() * 5000 };
  }
  for (var i = 0; i < PULSE_COUNT; i++) pulses.push(spawnPulse());

  /* ── Starfield ── */
  var STAR_COUNT = isSafari ? 35 : 55;
  var stars = [];
  for (var i = 0; i < STAR_COUNT; i++) {
    var sx = (Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1;
    var sy = (Math.sin(i * 269.5 + 183.3) * 43758.5453) % 1;
    sx = ((sx % 1) + 1) % 1; sy = ((sy % 1) + 1) % 1;
    var sz = ((Math.sin(i * 78.233) * 43758.5453) % 1 + 1) % 1;
    stars.push({ x: sx, y: sy, a: 0.06 + sz * 0.18, s: 0.4 + sz * 0.5 });
  }

  /* ── State ── */
  var angleY = 0, angleX = -0.15, FOV = 1200, last = 0;
  var rotationImpulse = 0;
  var cssScale = 1, cssScaleTarget = 1;
  var cssOpacity = 1, cssOpacityTarget = 1;

  /* ── DOM refs ── */
  var heroEl = document.querySelector(".hero");
  var introOverlay = document.getElementById("intro-overlay");
  var introFlash = document.getElementById("intro-flash");
  var introCanvas = document.getElementById("intro-canvas");
  var introCtx = introCanvas ? introCanvas.getContext("2d", { alpha: true }) : null;

  /* ══════════════════════════════════════════════════
     CINEMATIC INTRO — state machine
     Renders on introCanvas (on the overlay, z-index 9999)
     Main canvas stays hidden until overlay fades
     ══════════════════════════════════════════════════ */
  var PHASE_DUR = [400, 400, 1200, 1800, 1500, 700];
  var introPhase = 0, phaseElapsed = 0;
  var introComplete = false;
  var introRadiusMul = 0, introGlow = 0, introSpinRate = 0;
  var introGlowShrink = 0; // 0=normal, 1=fully concentrated
  var introDotSize = 0, introDotAlpha = 0;
  var introRevealed = false; // has hero--revealed been set?

  if (heroEl && !prefersReduced) {
    heroEl.classList.add("hero--intro");
    // Hide main canvas during intro
    stage.style.visibility = "hidden";
  } else {
    introPhase = 6; introComplete = true; introRadiusMul = 1;
    if (introOverlay) { introOverlay.classList.add("is-fading"); }
    if (heroEl) heroEl.classList.add("hero--revealed");
  }

  function easeOutCubic(t) { return 1 - (1 - t) * (1 - t) * (1 - t); }
  function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function easeOutExpo(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }

  function advanceIntro(dt) {
    phaseElapsed += dt;
    var dur = PHASE_DUR[introPhase] || 500;
    var t = Math.min(1, phaseElapsed / dur);

    switch (introPhase) {
      case 0: // Black
        introDotAlpha = 0; introDotSize = 0; introRadiusMul = 0; introGlow = 0; introSpinRate = 0;
        if (t >= 1) { introPhase = 1; phaseElapsed = 0; }
        break;

      case 1: // Dot blink
        if (t < 0.35) introDotAlpha = easeOutCubic(t / 0.35) * 0.75;
        else if (t < 0.55) introDotAlpha = 0.75 * (1 - (t - 0.35) / 0.2);
        else introDotAlpha = easeOutCubic((t - 0.55) / 0.45) * 0.55;
        introDotSize = 2.5; introRadiusMul = 0;
        introGlow = introDotAlpha * 0.12;
        if (t >= 1) { introPhase = 2; phaseElapsed = 0; }
        break;

      case 2: // Brighten — dot grows, gains light, starts to pulse
        var bt = easeOutCubic(t);
        introDotAlpha = 0.55 + bt * 0.45 + Math.sin(phaseElapsed * 0.014) * 0.12 * bt;
        introDotSize = 2.5 + bt * 5;
        introSpinRate = bt * 0.003;
        introRadiusMul = bt * 0.04;
        introGlow = 0.12 + bt * 0.55;
        if (t >= 1) { introPhase = 3; phaseElapsed = 0; }
        break;

      case 3: // Expansion — sphere emerges, spins fast, light intensifies
        var et = easeInOutQuad(t);
        introRadiusMul = 0.04 + et * 0.86;
        introSpinRate = 0.003 + (1 - et) * 0.01;
        introDotAlpha = Math.max(0, 1 - et * 1.8);
        introDotSize = 7 * (1 - et);
        introGlow = 0.67 + et * 0.28;
        if (t >= 1) { introPhase = 4; phaseElapsed = 0; }
        break;

      case 4: // Settle — spin decelerates, glow concentrates into center
        var st = easeOutCubic(t);
        introRadiusMul = 0.9 + st * 0.1;
        var spinT = t * t * (3 - 2 * t);
        introSpinRate = 0.003 * (1 - spinT) + 0.00012 * spinT;
        introDotAlpha = 0;
        // Glow concentrates: brightness stays, radius shrinks
        var concentrate = Math.max(0, (t - 0.3) / 0.7); // 0→1 over last 70%
        var cc = concentrate * concentrate; // ease-in curve
        introGlow = 0.95 - st * 0.15;           // brightness fades slowly
        introGlowShrink = cc;                     // radius shrinks 0→1
        if (t >= 1) { introPhase = 5; phaseElapsed = 0; }
        break;

      case 5: // Burst + reveal
        introRadiusMul = 1; introSpinRate = 0.00012;
        var bt5 = easeOutCubic(t);
        introGlow = 0.8 * (1 - bt5);             // fade to 0
        introGlowShrink = 1 - bt5 * 0.5;         // release shrink gradually
        // Trigger burst
        if (t > 0.05 && introFlash && !introFlash.classList.contains("is-flash")) {
          introFlash.classList.add("is-flash");
        }
        // Reveal hero content
        if (t > 0.2 && !introRevealed) {
          introRevealed = true;
          if (heroEl) {
            heroEl.classList.remove("hero--intro");
            heroEl.classList.add("hero--revealed");
            var heroCaps = heroEl.querySelector(".hero__caps");
            var heroFooter = heroEl.querySelector(".hero__footer");
            [heroCaps, heroFooter].forEach(function(el) {
              if (!el) return;
              el.addEventListener("animationend", function() { el.style.animation = "none"; }, { once: true });
            });
          }
          stage.style.visibility = "visible";
          if (introOverlay) introOverlay.classList.add("is-fading");
        }
        if (t >= 1) {
          introPhase = 6; introComplete = true; introGlow = 0;
          if (introOverlay) setTimeout(function() { introOverlay.classList.add("is-hidden"); }, 1200);
          if (introFlash) setTimeout(function() { introFlash.style.display = "none"; }, 1500);
        }
        break;
    }
  }

  /* ── Render sphere on a given context ── */
  function renderSphere(c, w, h, radiusMul, glowVal, dotAlpha, dotSize, showStars, glowShrink) {
    c.clearRect(0, 0, w, h);
    var cx = w * 0.5, cy = h * 0.5;
    var baseR = Math.min(w, h) * 0.42;
    var rad = baseR * radiusMul;
    var vis = radiusMul > 0.02;

    // Project
    var cosYv = Math.cos(angleY), sinYv = Math.sin(angleY);
    var cosXv = Math.cos(angleX), sinXv = Math.sin(angleX);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var x1 = n.x * cosYv - n.z * sinYv;
      var z1 = n.x * sinYv + n.z * cosYv;
      var y1 = n.y * cosXv - z1 * sinXv;
      var z2 = n.y * sinXv + z1 * cosXv;
      var d = Math.max(50, FOV + z2 * rad);
      var s = FOV / d;
      projected[i].x = cx + x1 * rad * s;
      projected[i].y = cy + y1 * rad * s;
      projected[i].z = z2; projected[i].scale = s;
    }

    // Ambient glow (with optional concentration toward center)
    if (glowVal > 0.01) {
      var shrink = glowShrink || 0;
      // Radius shrinks as energy concentrates: 1.0→0.15 of normal
      var radiusFactor = 1 - shrink * 0.85;
      var gr = baseR * (0.8 + glowVal * 1.2) * radiusFactor;
      // Center gets brighter as glow concentrates
      var centerBoost = 1 + shrink * 1.5;
      var g = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(4, gr));
      g.addColorStop(0, "rgba(140, 195, 255, " + Math.min(1, glowVal * 0.45 * centerBoost).toFixed(3) + ")");
      g.addColorStop(0.3, "rgba(80, 140, 220, " + (glowVal * 0.25 * centerBoost * 0.7).toFixed(3) + ")");
      g.addColorStop(0.6, "rgba(40, 80, 180, " + (glowVal * 0.12).toFixed(3) + ")");
      g.addColorStop(1, "transparent");
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }

    // Stars
    if (showStars) {
      var sa = Math.min(1, glowVal * 1.5);
      for (var i = 0; i < stars.length; i++) {
        var st = stars[i];
        c.globalAlpha = st.a * sa;
        c.fillStyle = "rgba(255,255,255,0.2)";
        c.fillRect(st.x * w, st.y * h, st.s, st.s);
      }
      c.globalAlpha = 1;
    }

    // Grid
    if (vis && radiusMul > 0.5 && !isSafari) {
      var gs = Math.max(22, Math.floor(Math.min(w, h) / 11));
      c.strokeStyle = "rgba(255,255,255,0.025)";
      c.lineWidth = 1; c.beginPath();
      var ox = ((cx % gs) + gs) % gs, oy = ((cy % gs) + gs) % gs;
      for (var xx = ox; xx < w; xx += gs) { c.moveTo(xx + 0.5, 0); c.lineTo(xx + 0.5, h); }
      for (var yy = oy; yy < h; yy += gs) { c.moveTo(0, yy + 0.5); c.lineTo(w, yy + 0.5); }
      c.stroke();
    }

    // Dot
    if (dotAlpha > 0.01) {
      var hR = dotSize * 6 + glowVal * 35;
      if (hR > 2) {
        var hg = c.createRadialGradient(cx, cy, 0, cx, cy, hR);
        hg.addColorStop(0, "rgba(140, 200, 255, " + (dotAlpha * 0.55).toFixed(3) + ")");
        hg.addColorStop(0.35, "rgba(100, 160, 230, " + (dotAlpha * 0.2).toFixed(3) + ")");
        hg.addColorStop(1, "transparent");
        c.fillStyle = hg;
        c.fillRect(cx - hR, cy - hR, hR * 2, hR * 2);
      }
      c.globalAlpha = dotAlpha;
      c.fillStyle = "#b8e0ff";
      c.beginPath(); c.arc(cx, cy, Math.max(1.5, dotSize), 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;
    }

    // Sphere
    if (vis) {
      var sA = Math.min(1, (radiusMul - 0.02) / 0.15);

      // Back edges
      c.strokeStyle = "rgba(140, 175, 225, " + (0.10 * sA).toFixed(3) + ")";
      c.lineWidth = 0.6; c.beginPath();
      for (var i = 0; i < edges.length; i++) {
        var a = projected[edges[i].a], b = projected[edges[i].b];
        if ((a.z + b.z) * 0.5 >= -0.1) continue;
        c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
      }
      c.stroke();

      // Back nodes
      c.fillStyle = "rgba(180, 215, 245, " + (0.6 * sA).toFixed(3) + ")";
      for (var i = 0; i < projected.length; i++) {
        var p = projected[i];
        if (p.z >= -0.1) continue;
        c.globalAlpha = (0.15 + (p.z + 1) * 0.15) * sA;
        c.beginPath(); c.arc(p.x, p.y, Math.max(0.3, p.scale), 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = 1;

      // Front edges
      c.strokeStyle = "rgba(150, 195, 240, " + (0.25 * sA).toFixed(3) + ")";
      c.lineWidth = 1; c.beginPath();
      for (var i = 0; i < edges.length; i++) {
        var a = projected[edges[i].a], b = projected[edges[i].b];
        if ((a.z + b.z) * 0.5 < -0.1) continue;
        c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
      }
      c.stroke();

      // Pulses
      if (radiusMul > 0.3) {
        c.fillStyle = "rgba(126, 184, 212, 1)";
        for (var i = 0; i < pulses.length; i++) {
          var pl = pulses[i]; var e = edges[pl.edge];
          var a = projected[e.a], b = projected[e.b];
          if ((a.z + b.z) * 0.5 < -0.2) { pl.life += 16; if (pl.life > pl.maxLife) pulses[i] = spawnPulse(); continue; }
          c.globalAlpha = 0.85 * sA;
          c.beginPath(); c.arc(a.x + (b.x - a.x) * pl.t, a.y + (b.y - a.y) * pl.t,
            1.2 + (1 - Math.abs(pl.t - 0.5) * 2) * 0.8, 0, Math.PI * 2); c.fill();
          c.globalAlpha = 1;
        }
      }

      // Front nodes
      for (var i = 0; i < projected.length; i++) {
        var p = projected[i];
        if (p.z < -0.1) continue;
        c.globalAlpha = (0.45 + (p.z + 1) * 0.3) * sA;
        c.fillStyle = p.z > 0.5 ? "rgba(126, 184, 212, 1)" : "rgba(180, 215, 245, 0.75)";
        c.beginPath(); c.arc(p.x, p.y, Math.max(0.6, 1.8 * p.scale), 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = 1;
    }
  }

  /* ── Pre-allocated projection buffer ── */
  var projected = new Array(NODE_COUNT);
  for (var i = 0; i < NODE_COUNT; i++) projected[i] = { x: 0, y: 0, z: 0, scale: 1 };

  /* ══════════════════════════════════════
     MAIN RENDER TICK
     ══════════════════════════════════════ */
  function tick(now) {
    var dt = Math.min(50, last ? now - last : 16);
    last = now;

    // Advance intro
    if (!introComplete) {
      advanceIntro(dt);
      angleY += dt * introSpinRate;
      angleX = -0.15 + Math.sin(now * 0.00007) * 0.04;
    } else if (!prefersReduced) {
      angleY += dt * 0.00012;
      angleX = -0.15 + Math.sin(now * 0.00007) * 0.04;
    }

    // Update pulses
    for (var i = 0; i < pulses.length; i++) {
      var pl = pulses[i]; var e = edges[pl.edge];
      pl.t += pl.speed * dt * pl.dir;
      pl.life += dt;
      if (pl.t >= 1 || pl.t <= 0) {
        var atNode = pl.t >= 1 ? e.b : e.a;
        var adj = adjacency[atNode]; var cands = [];
        for (var ci = 0; ci < adj.length; ci++) { if (adj[ci] !== pl.edge) cands.push(adj[ci]); }
        if (cands.length > 0) {
          var ni = cands[Math.floor(Math.random() * cands.length)];
          var ne = edges[ni]; pl.edge = ni;
          pl.t = ne.a === atNode ? 0 : 1; pl.dir = ne.a === atNode ? 1 : -1;
        } else pulses[i] = spawnPulse();
      }
      if (pl.life > pl.maxLife) pulses[i] = spawnPulse();
    }

    // CSS scale lerp (main canvas)
    var lf = Math.min(1, dt * 0.006);
    cssScale += (cssScaleTarget - cssScale) * lf;
    cssOpacity += (cssOpacityTarget - cssOpacity) * lf;
    stage.style.transform = "scale(" + cssScale.toFixed(4) + ")";
    stage.style.opacity = cssOpacity.toFixed(3);

    // Render
    if (!introComplete && introCtx) {
      // Render on intro canvas (visible on overlay)
      renderSphere(introCtx, W, H, introRadiusMul, introGlow, introDotAlpha, introDotSize, introPhase >= 2, introGlowShrink);
    }
    if (introComplete || introRevealed) {
      // Render on main canvas (visible after overlay fades)
      renderSphere(ctx, W, H, 1, 0.3, 0, 0, true);
    }

    rafId = requestAnimationFrame(tick);
  }

  /* ── Resize ── */
  function sizeCanvas(c, cw, ch) {
    var pw = Math.round(cw * renderDPR), ph = Math.round(ch * renderDPR);
    c.width = pw; c.height = ph;
    c.style.width = cw + "px"; c.style.height = ch + "px";
    var cx = c.getContext("2d");
    if (cx) cx.setTransform(renderDPR, 0, 0, renderDPR, 0, 0);
  }

  function resizeAndRestart() {
    cancelAnimationFrame(rafId);
    rafId = 0; last = 0;
    var cw = Math.max(1, window.innerWidth);
    var ch = Math.max(1, window.innerHeight);
    sizeCanvas(canvas, cw, ch);
    if (introCanvas) sizeCanvas(introCanvas, cw, ch);
    // Re-grab contexts after resize
    ctx = canvas.getContext("2d");
    ctx.setTransform(renderDPR, 0, 0, renderDPR, 0, 0);
    if (introCanvas) {
      introCtx = introCanvas.getContext("2d");
      introCtx.setTransform(renderDPR, 0, 0, renderDPR, 0, 0);
    }
    W = cw; H = ch;
    if (cw < 32 || ch < 32) return;
    if (prefersReduced) {
      introComplete = true; introRadiusMul = 1; introPhase = 6;
      angleY = 0.5; tick(1000); cancelAnimationFrame(rafId); return;
    }
    rafId = requestAnimationFrame(tick);
  }
  window.addEventListener("resize", resizeAndRestart);
  resizeAndRestart();

  window.addEventListener("beforeunload", function() { cancelAnimationFrame(rafId); }, { once: true });

  /* ── Parallax scroll: caps slide off, sphere expands via CSS scale ── */
  (function heroParallax() {
    var hero = document.querySelector(".hero");
    var caps = document.querySelector(".hero__caps");
    var footer = document.querySelector(".hero__footer");
    var fadeTops = document.querySelectorAll(".hero__bg-fade-top, .hero__bg-fade-bottom");
    if (!hero || !caps) return;

    var heroH = 0, simTop = 0;
    function cacheLayout() {
      heroH = hero.offsetHeight;
      var sim = document.getElementById("sim-section");
      simTop = sim ? (sim.getBoundingClientRect().top + window.scrollY) : heroH;
    }
    cacheLayout();
    window.addEventListener("resize", cacheLayout);

    function onScroll() {
      var scrollY = window.scrollY;
      // Caps: done by 8% of hero
      var capsEnd = heroH * 0.08;
      var capsProg = Math.min(1, scrollY / capsEnd);
      var capsEased = 1 - (1 - capsProg) * (1 - capsProg);
      caps.style.transform = "translate3d(0," + (capsEased * heroH * 0.25) + "px,0)";
      caps.style.opacity = (1 - capsEased).toFixed(3);
      caps.style.pointerEvents = capsProg > 0.8 ? "none" : "";
      if (footer) {
        footer.style.transform = "translate3d(0," + (capsEased * heroH * 0.18) + "px,0)";
        footer.style.opacity = (1 - capsEased).toFixed(3);
        footer.style.pointerEvents = capsProg > 0.8 ? "none" : "";
      }
      // Sphere scale
      var sphereProg = Math.max(0, Math.min(1, scrollY / simTop));
      cssScaleTarget = 1 + sphereProg * 2.5;
      cssOpacityTarget = 1 - sphereProg * 0.4;
      var fadeOp = Math.max(0, 1 - sphereProg * 2);
      fadeTops.forEach(function(el) { el.style.opacity = fadeOp.toFixed(3); });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  })();

})();

/**
 * Lightspeed longread — independent IIFE module.
 * Self-contained: own state, own RAF cycles, own canvases.
 * Activated via `body.is-lightspeed` class set by setSiteModel.
 */
(function lightspeedLongread() {
  "use strict";
  const root = document.getElementById("longread-c-root");
  if (!root) return;

  // Точная скорость света, м/с
  const C = 299792458;

  // ---------- math helpers ----------
  function gamma(beta) {
    const b = Math.abs(beta);
    if (b >= 1) return Infinity;
    return 1 / Math.sqrt(1 - b * b);
  }
  function relAddVel(u, v) {
    return (u + v) / (1 + (u * v) / (C * C));
  }
  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function fmtNum(n, d) {
    if (!Number.isFinite(n)) return "∞";
    const dd = d == null ? 2 : d;
    if (Math.abs(n) >= 1e9) return n.toExponential(2);
    return n.toFixed(dd);
  }
  function fmtSci(n) {
    if (!Number.isFinite(n)) return "∞";
    if (Math.abs(n) < 1000) return n.toFixed(2);
    return n.toExponential(2);
  }

  // ---------- DOM helpers ----------
  function el(tag, attrs, kids) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v == null) return;
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "text") node.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else node.setAttribute(k, String(v));
      });
    }
    if (kids) {
      kids.forEach((c) => {
        if (c == null) return;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function makeStageHead(label) {
    return el("div", { class: "ls-stage__head" }, [
      el("span", null, [el("span", { class: "ls-stage__dot" }), label]),
    ]);
  }

  function makeCanvasWrap(canvas) {
    return el("div", { class: "ls-canvas-wrap" }, [canvas]);
  }

  function makeSlider(opts) {
    const valueEl = el("span", { class: "ls-field__value" }, [opts.format ? opts.format(opts.value) : String(opts.value)]);
    const input = el("input", {
      type: "range",
      min: String(opts.min),
      max: String(opts.max),
      step: String(opts.step),
      value: String(opts.value),
      "aria-label": opts.label,
    });
    input.addEventListener("input", () => {
      const v = Number(input.value);
      valueEl.textContent = opts.format ? opts.format(v) : String(v);
      if (opts.onInput) opts.onInput(v);
    });
    const labelText = opts.labelHtml
      ? el("span", { class: "ls-field__label", html: opts.labelHtml })
      : el("span", { class: "ls-field__label" }, [opts.label]);
    const field = el("label", { class: "ls-field" }, [
      el("span", { class: "ls-field__top" }, [labelText, valueEl]),
      input,
    ]);
    return {
      field,
      input,
      get value() { return Number(input.value); },
      set value(v) { input.value = String(v); valueEl.textContent = opts.format ? opts.format(v) : String(v); },
    };
  }

  function makeReadout(label, mod) {
    const valueEl = el("span", { class: "ls-readout__value" }, ["—"]);
    const card = el("div", { class: "ls-readout" + (mod ? " ls-readout--" + mod : "") }, [
      el("span", { class: "ls-readout__label" }, [label]),
      valueEl,
    ]);
    return {
      card,
      set(v) { valueEl.textContent = v; },
    };
  }

  // ---------- canvas DPR helper ----------
  function setupCanvas(canvas, opts) {
    const aspectRatio = (opts && opts.aspect) || 16 / 9;
    function resize() {
      const w = canvas.clientWidth;
      if (w <= 0) return null;
      const aspectH = Math.round(w / aspectRatio);
      // Use parent container height if it's taller (from grid stretch)
      const parent = canvas.parentElement;
      const parentH = parent ? parent.clientHeight : 0;
      const h = parentH > aspectH ? parentH : aspectH;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.height = h + "px";
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      if (typeof ctx.imageSmoothingQuality === "string") ctx.imageSmoothingQuality = "high";
      return { w, h, ctx };
    }
    return { resize };
  }

  // ---------- RAF scheduler with IntersectionObserver ----------
  const sims = [];
  function startSim(rec) {
    if (rec.raf) return;
    rec.lastTs = 0;
    function loop(ts) {
      if (!rec.visible) {
        rec.raf = null;
        return;
      }
      const rawDt = rec.lastTs ? Math.min(0.05, (ts - rec.lastTs) / 1000) : 0;
      rec.lastTs = ts;
      const dt = rec.paused ? 0 : rawDt * (rec.timeScale || 1);
      try { rec.sim.tick && rec.sim.tick(dt, ts); } catch (e) { console.error(e); }
      rec.raf = requestAnimationFrame(loop);
    }
    rec.raf = requestAnimationFrame(loop);
  }
  function stopSim(rec) {
    if (rec.raf) cancelAnimationFrame(rec.raf);
    rec.raf = null;
    rec.lastTs = 0;
  }

  let isLightspeedActive = document.body.classList.contains("is-lightspeed");
  const io = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          const rec = sims.find((r) => r.host === e.target);
          if (!rec) return;
          rec.visible = isLightspeedActive && e.isIntersecting;
          if (rec.visible) {
            if (rec.sim.resize) { try { rec.sim.resize(); } catch (e2) {} }
            startSim(rec);
          } else stopSim(rec);
        });
      }, { rootMargin: "200px 0px", threshold: 0.05 })
    : null;

  function registerSim(host, sim) {
    const rec = { host, sim, visible: false, raf: null, lastTs: 0, paused: false, timeScale: 1 };
    sims.push(rec);
    if (io) io.observe(host);
    else { rec.visible = isLightspeedActive; if (rec.visible) startSim(rec); }
    return rec;
  }

  // ---------- Transport controls (play/pause, reset, speed) ----------
  function makeTransport(host, rec, onReset) {
    // Play/pause button (same design as main model)
    const btnPlay = el("button", {
      type: "button",
      class: "icon-btn icon-btn--playpause is-playing",
      title: "Пауза",
      "aria-label": "Пауза",
    }, [
      el("span", { class: "transport__glyph transport__glyph--play", "aria-hidden": "true" }, ["▶"]),
      el("span", { class: "transport__glyph transport__glyph--pause", "aria-hidden": "true" }, ["❚❚"]),
    ]);

    function syncBtn() {
      btnPlay.classList.toggle("is-playing", !rec.paused);
      btnPlay.classList.toggle("is-paused", rec.paused);
      btnPlay.title = rec.paused ? "Запустить" : "Пауза";
    }

    btnPlay.addEventListener("click", () => {
      rec.paused = !rec.paused;
      syncBtn();
    });

    // Reset button
    const btnReset = el("button", {
      type: "button",
      class: "icon-btn",
      title: "Сброс",
      "aria-label": "Сброс",
    }, ["↺"]);
    btnReset.addEventListener("click", () => {
      rec.paused = false;
      syncBtn();
      if (onReset) onReset();
    });

    const transportRow = el("div", { class: "transport" }, [btnPlay, btnReset]);

    // Speed selector (segmented buttons, same design as main model)
    const speeds = [
      { label: "×0.5", value: 0.5 },
      { label: "×1", value: 1 },
      { label: "×2", value: 2 },
      { label: "×4", value: 4 },
    ];
    const segBtns = speeds.map((s) => {
      const btn = el("button", {
        type: "button",
        class: "seg-btn" + (s.value === 1 ? " is-active" : ""),
        "data-ts": String(s.value),
      }, [s.label]);
      btn.addEventListener("click", () => {
        segBtns.forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        rec.timeScale = s.value;
      });
      return btn;
    });
    const speedGroup = el("div", { class: "segmented" }, segBtns);
    const speedField = el("label", { class: "ls-field" }, [
      el("span", { class: "ls-field__top" }, [
        el("span", { class: "ls-field__label" }, ["Скорость"]),
      ]),
      speedGroup,
    ]);

    const container = el("div", { class: "ls-transport-block" }, [transportRow, speedField]);
    host.appendChild(container);
    return { btnPlay, btnReset, syncBtn };
  }

  // Reaction to site-model switching
  document.addEventListener("ls:siteModelChange", (e) => {
    const model = e.detail && e.detail.model;
    isLightspeedActive = model === "lightspeed";
    if (!isLightspeedActive) {
      sims.forEach((rec) => { rec.visible = false; stopSim(rec); });
    } else {
      // Force re-evaluation of intersection by toggling observation
      sims.forEach((rec) => {
        if (rec.sim.resize) { try { rec.sim.resize(); } catch (e2) {} }
      });
    }
  });

  // ResizeObserver for the root → resize all visible canvases
  const ro = "ResizeObserver" in window
    ? new ResizeObserver(() => {
        sims.forEach((rec) => {
          if (rec.sim.resize) { try { rec.sim.resize(); } catch (e2) {} }
        });
      })
    : null;
  if (ro) ro.observe(root);

  // ============================================================
  // GLAVA 1: Kinetic energy chart
  // ============================================================
  function createKEnergyChart(host) {
    host.appendChild(makeStageHead("Кинетическая энергия (m = 1 кг)"));
    const canvas = el("canvas", { "aria-label": "График кинетической энергии классической и релятивистской" });
    host.appendChild(makeCanvasWrap(canvas));

    const sl = makeSlider({
      label: "v / c",
      min: 0,
      max: 0.9999,
      step: 0.0001,
      value: 0.5,
      format: (v) => v.toFixed(4) + "·c",
      onInput: () => render(),
    });
    host.appendChild(el("div", { class: "ls-controls ls-controls--row" }, [sl.field]));

    const rRel = makeReadout("K релятив., Дж", "b");
    const rCls = makeReadout("K классика, Дж", "violet");
    const rGm = makeReadout("γ", "accent");
    const rRatio = makeReadout("K_рел / K_кл", "a");
    host.appendChild(el("div", { class: "ls-readouts" }, [rRel.card, rCls.card, rGm.card, rRatio.card]));

    host.appendChild(el("div", { class: "ls-formula ls-formula--mint" }, ["K = (γ − 1) m c²    →    при v → c    K → ∞"]));

    const setup = setupCanvas(canvas, { aspect: 16 / 9 });
    let dim = null;

    // --- Численно стабильное (γ − 1):
    //   при больших β — стандартная формула 1/√(1−β²) − 1
    //   при малых β — ряд Тейлора, чтобы избежать катастрофического вычитания 1/√(...) − 1.
    function gammaMinusOne(beta) {
      const b = Math.abs(beta);
      const b2 = b * b;
      if (b2 >= 1) return Infinity;
      if (b2 < 1e-8) {
        // Taylor: γ − 1 = β²/2 + 3β⁴/8 + 5β⁶/16 + 35β⁸/128
        const b4 = b2 * b2;
        const b6 = b4 * b2;
        const b8 = b4 * b4;
        return 0.5 * b2 + 0.375 * b4 + 0.3125 * b6 + 0.2734375 * b8;
      }
      return 1 / Math.sqrt(1 - b2) - 1;
    }
    function kRelJ(beta, m) { return gammaMinusOne(beta) * m * C * C; }
    function kClsJ(beta, m) { const v = beta * C; return 0.5 * m * v * v; }

    // --- "Nice" tick step (1/2/5 × 10ⁿ) для оси Y, чтобы подписи были круглыми.
    function niceStep(span, targetTicks) {
      if (!Number.isFinite(span) || span <= 0) return 1;
      const raw = span / Math.max(1, targetTicks);
      const exp = Math.floor(Math.log10(raw));
      const base = raw / Math.pow(10, exp);
      let mult;
      if (base < 1.5) mult = 1;
      else if (base < 3.5) mult = 2;
      else if (base < 7.5) mult = 5;
      else mult = 10;
      return mult * Math.pow(10, exp);
    }

    // --- Подпись на оси Y в виде "n·10ᵏ" для крупных значений.
    const SUP_DIGITS = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "+": "" };
    function toSup(n) {
      return String(n).split("").map((c) => SUP_DIGITS[c] || c).join("");
    }
    function fmtAxisY(v) {
      if (v === 0) return "0";
      const exp = Math.floor(Math.log10(Math.abs(v)));
      if (exp >= 3 && exp <= 15) {
        // обычная нотация для разумных значений
        return v.toFixed(0);
      }
      const mant = v / Math.pow(10, exp);
      const mantStr = Math.abs(mant - Math.round(mant)) < 1e-9 ? String(Math.round(mant)) : mant.toFixed(1);
      return mantStr + "·10" + toSup(exp);
    }

    function arrowHead(ctx, x, y, dir, size) {
      const s = size || 7;
      ctx.beginPath();
      if (dir === "up") {
        ctx.moveTo(x, y);
        ctx.lineTo(x - s * 0.55, y + s);
        ctx.lineTo(x + s * 0.55, y + s);
      } else { // right
        ctx.moveTo(x, y);
        ctx.lineTo(x - s, y - s * 0.55);
        ctx.lineTo(x - s, y + s * 0.55);
      }
      ctx.closePath();
      ctx.fill();
    }

    function render() {
      if (!dim) return;
      const { w, h, ctx } = dim;
      const beta = sl.value;
      const m = 1;
      ctx.clearRect(0, 0, w, h);

      // Внутренние поля под оси и подписи
      const padL = 86, padR = 36, padT = 30, padB = 50;
      const dw = w - padL - padR;
      const dh = h - padT - padB;

      // --- Адаптивный yMax.
      // База: K_rel(0.95c) даёт классической прямой нормальный наклон.
      // Если текущая точка β выше этого, расширяем шкалу так, чтобы маркер
      // оставался в верхних ~85 % окна.
      const baseY = kRelJ(0.95, m);
      const markerHead = kRelJ(Math.min(beta, 0.985), m) * 1.18;
      let yMaxRaw = Math.max(baseY, markerHead);
      // Округляем yMax к "красивому" числу делений.
      const stepY = niceStep(yMaxRaw, 5);
      const yMax = Math.ceil(yMaxRaw / stepY) * stepY;

      // --- Сетка
      ctx.strokeStyle = "rgba(255,255,255,0.045)";
      ctx.lineWidth = 1;
      const xMajor = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
      xMajor.forEach((b) => {
        const x = padL + b * dw;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + dh); ctx.stroke();
      });
      for (let yv = 0; yv <= yMax + 1e-9; yv += stepY) {
        const y = padT + dh - (yv / yMax) * dh;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + dw, y); ctx.stroke();
      }

      // --- Оси (две: вертикальная Y и горизонтальная X) со стрелочками
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      // Y-axis
      ctx.moveTo(padL, padT - 14);
      ctx.lineTo(padL, padT + dh);
      // X-axis
      ctx.moveTo(padL, padT + dh);
      ctx.lineTo(padL + dw + 14, padT + dh);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      arrowHead(ctx, padL, padT - 14, "up", 8);
      arrowHead(ctx, padL + dw + 14, padT + dh, "right", 8);

      // --- Подписи осей
      ctx.fillStyle = "rgba(233,236,245,0.92)";
      ctx.font = "600 13px Outfit";
      ctx.textAlign = "left";
      ctx.fillText("K (Дж)", padL - 24, padT - 18);
      ctx.textAlign = "right";
      ctx.fillText("v / c", padL + dw + 6, padT + dh + 32);

      // --- Тики и подписи Y
      ctx.font = "11px JetBrains Mono, ui-monospace, monospace";
      ctx.fillStyle = "rgba(255,255,255,0.62)";
      ctx.textAlign = "right";
      for (let yv = 0; yv <= yMax + 1e-9; yv += stepY) {
        const y = padT + dh - (yv / yMax) * dh;
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL - 5, y); ctx.lineTo(padL, y); ctx.stroke();
        ctx.fillText(fmtAxisY(yv), padL - 9, y + 4);
      }

      // --- Тики и подписи X
      ctx.fillStyle = "rgba(255,255,255,0.62)";
      ctx.textAlign = "center";
      xMajor.forEach((b) => {
        const x = padL + b * dw;
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, padT + dh); ctx.lineTo(x, padT + dh + 5); ctx.stroke();
        ctx.fillText(b.toFixed(1), x, padT + dh + 18);
      });

      // --- Кривые
      // Семплинг плотный, со сгущением у v→c (нелинейная параметризация u → β).
      // Клиппинг: при выходе за yMax вычисляется точное место пересечения линейной
      // интерполяцией между предыдущей и текущей точкой, линия рисуется до этой
      // точки и обрывается. Это устраняет «загиб» вдоль верхней границы.
      function plotCurve(fn, color, dash) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.4;
        ctx.setLineDash(dash || []);
        const N = 1200;
        let started = false;
        let prevPx = 0, prevPy = 0, prevK = 0, prevB = 0, prevValid = false;
        for (let i = 0; i <= N; i++) {
          const u = i / N;
          // Сгущение у b→1: b = 1 − (1−u)^p
          const b = 1 - Math.pow(1 - u, 2.6);
          const bClamp = Math.min(b, 0.99995);
          const k = fn(bClamp);
          if (!Number.isFinite(k) || k < 0) continue;
          const px = padL + bClamp * dw;
          if (k > yMax) {
            // Аккуратно интерполируем точку пересечения границы yMax между prev и текущей.
            if (started && prevValid && prevK <= yMax) {
              const denom = (k - prevK);
              const t = denom > 1e-30 ? (yMax - prevK) / denom : 0;
              const ix = lerp(prevPx, px, t);
              const iy = padT;
              ctx.lineTo(ix, iy);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            return;
          }
          const py = padT + dh - (k / yMax) * dh;
          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
          prevPx = px; prevPy = py; prevK = k; prevB = bClamp; prevValid = true;
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      plotCurve((b) => kClsJ(b, m), "rgba(167,139,250,0.9)", [6, 5]);
      plotCurve((b) => kRelJ(b, m), "#d4a66a");

      // --- Асимптота v = c
      ctx.strokeStyle = "rgba(255,102,128,0.75)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 5]);
      const cx = padL + dw;
      ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, padT + dh); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(200,160,170,0.85)";
      ctx.font = "600 11px Outfit";
      ctx.textAlign = "center";
      ctx.fillText("v = c", cx, padT - 18);

      // --- Маркер на релятивистской кривой
      const kRel = kRelJ(beta, m);
      const kCls = kClsJ(beta, m);
      const px = padL + beta * dw;
      if (kRel <= yMax) {
        const py = padT + dh - (kRel / yMax) * dh;
        // Перекрестие пунктиром до осей
        ctx.strokeStyle = "rgba(255,255,255,0.32)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(px, padT + dh); ctx.lineTo(px, py);
        ctx.moveTo(padL, py); ctx.lineTo(px, py);
        ctx.stroke();
        ctx.setLineDash([]);
        // Сама точка
        ctx.fillStyle = "#d4a66a";
        ctx.beginPath(); ctx.arc(px, py, 5.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 1.6;
        ctx.stroke();
      } else {
        // Точка ушла за верх — рисуем стрелку «K → ∞» в верхней части графика.
        ctx.strokeStyle = "rgba(255,255,255,0.32)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(px, padT + dh); ctx.lineTo(px, padT + 22);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#d4a66a";
        ctx.font = "600 12px Outfit";
        ctx.textAlign = "center";
        ctx.fillText("K → ∞", px, padT + 4);
        ctx.beginPath();
        ctx.moveTo(px, padT + 8);
        ctx.lineTo(px - 4, padT + 16);
        ctx.lineTo(px + 4, padT + 16);
        ctx.closePath();
        ctx.fill();
      }

      // --- Легенда
      const legPad = 12;
      const legY = padT + 8;
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(padL + legPad, legY, 220, 38);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.strokeRect(padL + legPad, legY, 220, 38);
      ctx.fillStyle = "rgba(167,139,250,0.95)";
      ctx.fillRect(padL + legPad + 8, legY + 12, 16, 2);
      ctx.fillStyle = "rgba(233,236,245,0.85)";
      ctx.font = "11px Outfit";
      ctx.textAlign = "left";
      ctx.fillText("классика  ½ m v²", padL + legPad + 30, legY + 16);
      ctx.fillStyle = "#d4a66a";
      ctx.fillRect(padL + legPad + 8, legY + 28, 16, 2);
      ctx.fillStyle = "rgba(233,236,245,0.85)";
      ctx.fillText("релятивистика  (γ−1) m c²", padL + legPad + 30, legY + 32);

      // --- Числа: γ — стабильно, K — в полной точности.
      const gNow = 1 + gammaMinusOne(beta);
      rRel.set(fmtSci(kRel));
      rCls.set(fmtSci(kCls));
      rGm.set(gNow.toFixed(6));
      // Соотношение K_рел/K_кл аналитически = (γ−1) / (½β²); устойчиво при β > 0.
      const ratio = beta > 0 ? gammaMinusOne(beta) / (0.5 * beta * beta) : 1;
      rRatio.set(ratio.toFixed(4) + "×");
    }

    return {
      resize() { dim = setup.resize(); render(); },
      tick() { /* static; render on input */ },
    };
  }

  // ============================================================
  // GLAVA 2: Velocity addition (classical vs relativistic)
  // ============================================================
  function createVelocityAddition(host) {
    host.appendChild(makeStageHead("Постоянство скорости света: фонарь и машина"));
    const canvas = el("canvas", { "aria-label": "Два источника света: статичный фонарь и движущаяся машина — оба фотона летят одинаково" });
    host.appendChild(makeCanvasWrap(canvas));

    const slV = makeSlider({
      label: "Скорость машины v (доля c)",
      min: 0.05,
      max: 0.95,
      step: 0.01,
      value: 0.5,
      format: (v) => v.toFixed(2) + "·c",
      onInput: () => { animPhase = 0; render(); },
    });
    host.appendChild(el("div", { class: "ls-va-sliders" }, [slV.field]));

    const rLamp = makeReadout("Фотон от фонаря", "accent");
    const rCar  = makeReadout("Фотон от машины", "accent");
    const rGhost = makeReadout("Галилей предсказал бы", "violet");
    const rDelta = makeReadout("Разница позиций фотонов", "b");
    host.appendChild(el("div", { class: "ls-readouts" }, [rLamp.card, rCar.card, rGhost.card, rDelta.card]));

    host.appendChild(el("div", { class: "ls-formula ls-formula--mint" }, [
      "Скорость света не зависит от движения источника: c′ = c  (для любой v)",
    ]));

    const setup = setupCanvas(canvas, { aspect: 16 / 9 });
    let dim = null;
    let animPhase = 0;
    const CYCLE = 4.5;
    const HOLD  = 1.0;

    function hexToRgba(hex, a) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return "rgba(" + r + "," + g + "," + b + "," + a + ")";
    }

    // Луч света — волнообразная линия тёплого цвета (как свет фонаря)
    function drawLightBeam(ctx, fromX, toX, y, t) {
      if (toX <= fromX + 2) return;
      const beamLen = toX - fromX;
      // Градиент: затухает у хвоста, ярче у фронта
      const grad = ctx.createLinearGradient(fromX, 0, toX, 0);
      grad.addColorStop(0, "rgba(255,230,140,0)");
      grad.addColorStop(0.15, "rgba(255,220,100,0.25)");
      grad.addColorStop(0.7, "rgba(255,200,60,0.55)");
      grad.addColorStop(1, "rgba(255,230,140,0.85)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      const waveLen = 18;   // длина волны в px
      const amp = 5;        // амплитуда волны
      const speed = 120;    // скорость бега волны
      for (let px = 0; px <= beamLen; px += 1) {
        const xx = fromX + px;
        const phase = (px / waveLen) * Math.PI * 2 - t * speed;
        const yy = y + Math.sin(phase) * amp;
        if (px === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
      // Яркая головка луча
      const hg = ctx.createRadialGradient(toX, y, 0, toX, y, 14);
      hg.addColorStop(0, "rgba(255,245,200,0.95)");
      hg.addColorStop(0.4, "rgba(255,220,100,0.5)");
      hg.addColorStop(1, "rgba(255,200,60,0)");
      ctx.fillStyle = hg;
      ctx.fillRect(toX - 14, y - 14, 28, 28);
    }

    function drawLampPost(ctx, x, baseY) {
      // Столб
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.lineTo(x, baseY - 40);
      ctx.stroke();
      // Горизонтальная перекладина
      ctx.beginPath();
      ctx.moveTo(x, baseY - 40);
      ctx.lineTo(x + 14, baseY - 40);
      ctx.stroke();
      // Лампа (свечение)
      const lg = ctx.createRadialGradient(x + 14, baseY - 40, 0, x + 14, baseY - 40, 18);
      lg.addColorStop(0, "rgba(255,230,140,0.9)");
      lg.addColorStop(0.5, "rgba(255,200,60,0.3)");
      lg.addColorStop(1, "rgba(255,200,60,0)");
      ctx.fillStyle = lg;
      ctx.fillRect(x - 4, baseY - 58, 36, 36);
      // Корпус лампы
      ctx.fillStyle = "#d4c490";
      ctx.beginPath(); ctx.arc(x + 14, baseY - 40, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    function drawCar(ctx, x, baseY, color) {
      const carY = baseY - 16;
      ctx.fillStyle = hexToRgba(color, 0.16);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x - 28, carY - 12, 56, 22, 6);
      } else {
        ctx.rect(x - 28, carY - 12, 56, 22);
      }
      ctx.fill(); ctx.stroke();
      // Окна
      ctx.fillStyle = "rgba(94,243,192,0.4)";
      ctx.fillRect(x - 22, carY - 9, 18, 8);
      ctx.fillRect(x + 4, carY - 9, 22, 8);
      // Колёса
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath(); ctx.arc(x - 16, carY + 11, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 16, carY + 11, 4, 0, Math.PI * 2); ctx.fill();
      // Фара (источник света на крыше)
      const lg = ctx.createRadialGradient(x + 26, carY - 14, 0, x + 26, carY - 14, 10);
      lg.addColorStop(0, "rgba(255,230,140,0.85)");
      lg.addColorStop(0.5, "rgba(255,200,60,0.25)");
      lg.addColorStop(1, "rgba(255,200,60,0)");
      ctx.fillStyle = lg;
      ctx.fillRect(x + 16, carY - 24, 20, 20);
      ctx.fillStyle = "#d4c490";
      ctx.beginPath(); ctx.arc(x + 26, carY - 14, 3, 0, Math.PI * 2); ctx.fill();
    }

    function drawTrack(ctx, x0, trackY, w, padX) {
      ctx.fillStyle = "rgba(20,24,38,0.7)";
      ctx.fillRect(x0 + padX, trackY - 11, w - padX * 2, 22);
      ctx.strokeStyle = "rgba(77,225,255,0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0 + padX, trackY);
      ctx.lineTo(x0 + w - padX, trackY);
      ctx.stroke();
    }

    function render() {
      if (!dim) return;
      const { w, h, ctx } = dim;
      const beta = slV.value;
      ctx.clearRect(0, 0, w, h);

      const padX = 56;
      const halfH = h / 2;
      const topTrackY  = halfH * 0.62;
      const botTrackY  = halfH + halfH * 0.62;
      const startX = padX + 30;
      const endX   = w - padX - 24;
      const drawW  = endX - startX;

      const progress = clamp(animPhase / CYCLE, 0, 1);
      const holding = animPhase > CYCLE;

      // ===== Верхняя полоса: ФОНАРЬ (статичный) =====
      drawTrack(ctx, 0, topTrackY, w, 0);
      // Заголовок
      ctx.fillStyle = "rgba(94,243,192,0.95)";
      ctx.font = "600 13px Outfit";
      ctx.textAlign = "left";
      ctx.fillText("Фонарный столб (покоится)", padX, 22);

      // Фонарь (чуть левее стартовой линии)
      const lampX = startX - 36;
      const lampY = topTrackY - 40;  // позиция лампы
      drawLampPost(ctx, lampX, topTrackY);

      // Луч от фонаря (исходит от лампы)
      const beamTopFromX = lampX + 14;  // от корпуса лампы
      const beamTopToX = startX + progress * drawW;
      drawLightBeam(ctx, beamTopFromX, beamTopToX, lampY, animPhase);
      // Подпись
      if (beamTopToX > beamTopFromX + 40) {
        ctx.fillStyle = "rgba(255,230,140,0.85)";
        ctx.font = "10px Outfit";
        ctx.textAlign = "right";
        ctx.fillText("луч  c", beamTopToX - 8, lampY - 14);
      }

      // ===== Разделительная линия =====
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath(); ctx.moveTo(0, halfH); ctx.lineTo(w, halfH); ctx.stroke();

      // ===== Нижняя полоса: МАШИНА (движется) =====
      drawTrack(ctx, 0, botTrackY, w, 0);
      // Заголовок
      ctx.fillStyle = "rgba(77,225,255,0.95)";
      ctx.font = "600 13px Outfit";
      ctx.textAlign = "left";
      ctx.fillText("Машина (v = " + beta.toFixed(2) + "·c)", padX, halfH + 22);

      // Машина (стартует чуть левее стартовой линии)
      const carStartX = startX - 36;
      const carX = carStartX + progress * beta * drawW;
      drawCar(ctx, carX, botTrackY, "#7eb8d4");

      // Луч от машины (СТО: всегда c, совпадает с верхним)
      const carTopY = botTrackY - 16 - 14;  // крыша машины, где фара
      const beamBotToX = startX + progress * drawW;
      // Луч начинается от фары, но никогда не «позади» фронта
      const beamBotFromX = Math.min(carX + 26, beamBotToX - 2);
      drawLightBeam(ctx, beamBotFromX, beamBotToX, carTopY, animPhase);
      // Подпись (выше луча, чтобы не наезжала на призрак Галилея)
      if (beamBotToX > beamBotFromX + 40) {
        ctx.fillStyle = "rgba(255,230,140,0.85)";
        ctx.font = "10px Outfit";
        ctx.textAlign = "left";
        ctx.fillText("луч  c", beamBotFromX + 4, carTopY - 14);
      }

      // Призрак Галилея: (c + v) — где фотон был бы по классике
      const ghostFactor = 1 + beta;
      const ghostXraw = startX + progress * ghostFactor * drawW;
      const ghostX = Math.min(ghostXraw, endX);
      // Ghost dot
      ctx.fillStyle = "rgba(255,102,128,0.18)";
      ctx.beginPath(); ctx.arc(ghostX, botTrackY - 28, 6, 0, Math.PI * 2); ctx.fill();
      // Ghost trail
      ctx.strokeStyle = "rgba(255,102,128,0.5)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(startX, botTrackY - 28);
      ctx.lineTo(ghostX, botTrackY - 28);
      ctx.stroke();
      ctx.setLineDash([]);
      // Strikethrough X on ghost
      ctx.strokeStyle = "rgba(255,102,128,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ghostX - 7, botTrackY - 28 + 5);
      ctx.lineTo(ghostX + 7, botTrackY - 28 - 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ghostX - 7, botTrackY - 28 - 5);
      ctx.lineTo(ghostX + 7, botTrackY - 28 + 5);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,102,128,0.8)";
      ctx.font = "10px Outfit";
      ctx.textAlign = "right";
      ctx.fillText("Галилей: c + v = " + ghostFactor.toFixed(2) + "·c", ghostX - 4, botTrackY - 36);

      // ===== Вертикальная линия связи между головками лучей =====
      const syncX = startX + progress * drawW;
      ctx.strokeStyle = "rgba(255,230,140,0.45)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(syncX, lampY + 14);
      ctx.lineTo(syncX, carTopY - 14);
      ctx.stroke();
      ctx.setLineDash([]);

      // Метка «синхронно» посередине связующей линии
      const midY = (lampY + carTopY) / 2;
      ctx.fillStyle = "rgba(255,230,140,0.9)";
      ctx.font = "600 11px Outfit";
      ctx.textAlign = "center";
      ctx.fillText("синхронно", syncX, midY);

      // ===== Детектор справа =====
      ctx.strokeStyle = "rgba(94,243,192,0.5)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(endX, 16);
      ctx.lineTo(endX, h - 16);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(94,243,192,0.75)";
      ctx.font = "10px JetBrains Mono, ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.save();
      ctx.translate(endX + 14, h / 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillText("ДЕТЕКТОР", 0, 0);
      ctx.restore();

      // Вспышка при достижении детектора
      if (progress >= 0.98) {
        const flashA = holding ? Math.max(0, 1 - (animPhase - CYCLE) / 0.4) : 1;
        const fg = ctx.createRadialGradient(endX, lampY, 0, endX, lampY, 30);
        fg.addColorStop(0, "rgba(255,230,140," + (0.7 * flashA) + ")");
        fg.addColorStop(1, "rgba(255,230,140,0)");
        ctx.fillStyle = fg;
        ctx.fillRect(endX - 30, lampY - 30, 60, 60);
        const fg2 = ctx.createRadialGradient(endX, carTopY, 0, endX, carTopY, 30);
        fg2.addColorStop(0, "rgba(255,230,140," + (0.7 * flashA) + ")");
        fg2.addColorStop(1, "rgba(255,230,140,0)");
        ctx.fillStyle = fg2;
        ctx.fillRect(endX - 30, carTopY - 30, 60, 60);
        // Текст «одновременно!»
        ctx.fillStyle = "rgba(220,210,180," + (0.95 * flashA) + ")";
        ctx.font = "600 14px Outfit";
        ctx.textAlign = "center";
        ctx.fillText("Одновременно!", w / 2, midY + 4);
      }

      // Вспышка при старте (эмиссия)
      if (progress < 0.12) {
        const emitA = 1 - progress / 0.12;
        // Верхний источник (от лампы)
        const eg1 = ctx.createRadialGradient(beamTopFromX, lampY, 0, beamTopFromX, lampY, 24);
        eg1.addColorStop(0, "rgba(255,230,140," + (0.7 * emitA) + ")");
        eg1.addColorStop(1, "rgba(255,230,140,0)");
        ctx.fillStyle = eg1;
        ctx.fillRect(beamTopFromX - 24, lampY - 24, 48, 48);
        // Нижний источник (от фары машины)
        const eg2 = ctx.createRadialGradient(beamBotFromX, carTopY, 0, beamBotFromX, carTopY, 24);
        eg2.addColorStop(0, "rgba(255,230,140," + (0.7 * emitA) + ")");
        eg2.addColorStop(1, "rgba(255,230,140,0)");
        ctx.fillStyle = eg2;
        ctx.fillRect(beamBotFromX - 24, carTopY - 24, 48, 48);
      }

      // ===== Линия «старт» =====
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(startX, 16);
      ctx.lineTo(startX, h - 16);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "10px JetBrains Mono, ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("старт", startX, h - 6);

      // ===== Readouts =====
      rLamp.set("c  (всегда)");
      rCar.set("c  (всегда)");
      rGhost.set("c + v = " + ghostFactor.toFixed(2) + "·c");
      rDelta.set("0  (фотоны синхронны)");
    }

    return {
      resize() { dim = setup.resize(); render(); },
      tick(dt) {
        animPhase += dt;
        if (animPhase > CYCLE + HOLD) animPhase = 0;
        render();
      },
      reset() { animPhase = 0; },
    };
  }

  // ============================================================
  // GLAVA 3: Photon clock (rest vs moving)
  // ============================================================
  function createPhotonClock(host) {
    host.appendChild(makeStageHead("Фотонные часы: тот же фотон, разные пути"));
    const canvas = el("canvas", { "aria-label": "Фотонные часы: ракета (вид со стороны) и часы в руках наблюдателя" });
    host.appendChild(makeCanvasWrap(canvas));

    const slV = makeSlider({
      label: "v / c (скорость ракеты)",
      min: 0,
      max: 0.95,
      step: 0.001,
      value: 0.866,             // даёт γ ≈ 2.0 — наглядное соотношение 1 : 2
      format: (v) => v.toFixed(3) + "·c",
      onInput: () => { simTime = 0; render(); },
    });
    host.appendChild(el("div", { class: "ls-controls ls-controls--row" }, [slV.field]));

    const rGm = makeReadout("γ = 1/√(1 − v²/c²)", "accent");
    const rT0 = makeReadout("T₀ = 2L/c (покой)", "a");
    const rTm = makeReadout("T = γ · T₀ (движение)", "b");
    const rTickRest = makeReadout("Тиков покоящихся", "a");
    const rTickMove = makeReadout("Тиков движущихся", "b");
    const rRatio = makeReadout("Отставание движущихся", "violet");
    host.appendChild(el("div", { class: "ls-readouts" }, [rGm.card, rT0.card, rTm.card, rTickRest.card, rTickMove.card, rRatio.card]));

    host.appendChild(el("div", { class: "ls-formula ls-formula--mint", html:
      "Скорость фотона <strong>одна и та же</strong>: c. Один <strong>тик</strong> — это полный цикл, два касания зеркал. "
      + "Путь в покое — 2L; путь в движении — диагональ длиной 2L·γ. Скорость одна, путь длиннее — значит в γ раз дольше один тик.",
    }));

    // ---- константы анимации ----
    // Скорость фотона на сцене (пикс/с) — ОДНА И ТА ЖЕ для обеих сцен.
    // Это и есть постулат СТО, выраженный в визуальной форме.
    const CS_PX = 96;             // пикс/с — скорость света на сцене
    const LS_PX = 56;             // пикс — расстояние между зеркалами (умещается внутри окна ракеты)
    const T_HIT_REST = LS_PX / CS_PX;   // период одного УДАРА о зеркало в покое (≈0.583 c)
    const T_TICK_REST = 2 * T_HIT_REST; // период одного ТИКА в покое (полный цикл)

    const setup = setupCanvas(canvas, { aspect: 16 / 9 });
    let dim = null;
    let simTime = 0;
    // Интенсивность пламени дюз. Плавно подтягивается к β через exp-lerp,
    // поэтому при дёрганье слайдера тяга меняется без рывков, а при v = 0
    // полностью исчезает.
    let flameIntensity = 0;

    function hexToRgba(hex, a) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return "rgba(" + r + "," + g + "," + b + "," + a + ")";
    }

    function drawStars(ctx, x0, y0, sw, sh, count, salt, drift) {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      for (let i = 0; i < count; i++) {
        const a = Math.sin((i + 1) * 12.9898 + salt) * 43758.5453;
        const b = Math.sin((i + 1) * 78.233 + salt + 1) * 43758.5453;
        const baseX = x0 + (a - Math.floor(a)) * sw;
        // Параллакс: дальние звёзды дрейфуют медленнее, ближние быстрее.
        // depth ∈ [0.2, 1.0]. Применяем drift (сколько пикс. сдвига дальних звёзд).
        const depth = 0.25 + (Math.abs(b - Math.floor(b)) * 0.7);
        const sxRaw = baseX - drift * depth;
        // Циклическая обмотка по ширине, чтобы звёзды появлялись слева снова
        const sx = ((sxRaw - x0) % sw + sw) % sw + x0;
        const sy = y0 + (Math.abs(b - Math.floor(b))) * sh;
        const r = (0.4 + (i % 6) * 0.18) * (0.4 + depth * 0.8);
        ctx.fillRect(sx, sy, r, r);
      }
    }

    function drawMirror(ctx, cx, cy, color) {
      // Стилизованный «брус»-зеркало с неоновой подсветкой.
      const c = color || "#7dc4a8";
      ctx.fillStyle = hexToRgba(c, 0.18);
      ctx.strokeStyle = hexToRgba(c, 0.85);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(cx - 24, cy - 3, 48, 6, 2);
      } else {
        ctx.rect(cx - 24, cy - 3, 48, 6);
      }
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = hexToRgba(c, 0.6);
      ctx.fillRect(cx - 22, cy - 1.5, 44, 1.2);
    }

    function drawPhotonGlow(ctx, cx, cy, color) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 20);
      g.addColorStop(0, "rgba(255,255,255,0.95)");
      g.addColorStop(0.4, hexToRgba(color, 0.7));
      g.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - 22, cy - 22, 44, 44);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, cy, 4.2, 0, Math.PI * 2); ctx.fill();
    }

    function drawLMarker(ctx, x, yTop, yBot, color) {
      const c = color || "rgba(255,255,255,0.55)";
      ctx.strokeStyle = c;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yTop); ctx.lineTo(x, yBot);
      ctx.moveTo(x - 4, yTop + 4); ctx.lineTo(x, yTop); ctx.lineTo(x + 4, yTop + 4);
      ctx.moveTo(x - 4, yBot - 4); ctx.lineTo(x, yBot); ctx.lineTo(x + 4, yBot - 4);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "italic 600 14px Outfit";
      ctx.textAlign = "left";
      ctx.fillText("L", x + 8, (yTop + yBot) / 2 + 5);
    }

    // ---- Дизайн ракеты ----
    // Корпус — металлическая капсула с неоновой обводкой.
    // Носовой конус — обтекаемый. Плавники — стреловидные.
    // Окно — тёмный иллюминатор с мятной окантовкой.
    // Дюзы — двойные с плавной тягой.
    function drawRocket(ctx, cx, cy, length, flameI) {
      const bodyW = length || 150;
      const bodyH = 88;
      const noseOffset = 7;
      const x = cx - bodyW * 0.5 + noseOffset;
      const y = cy - bodyH / 2;
      const fi = clamp(flameI == null ? 0 : flameI, 0, 1);

      // Двойное пламя (FIRST — behind everything)
      if (fi > 1e-3) {
        const lenMax = 140;
        const flameLen = lenMax * fi;
        const halfThick = 5.5 * fi + 1.6;
        const a0 = Math.min(0.95, 0.55 + 0.45 * fi);
        const a1 = Math.min(0.7, 0.25 + 0.5 * fi);
        function drawJet(yc) {
          const fg = ctx.createLinearGradient(x, yc, x - flameLen, yc);
          fg.addColorStop(0, "rgba(212,166,106," + a0.toFixed(3) + ")");
          fg.addColorStop(0.45, "rgba(167,139,250," + a1.toFixed(3) + ")");
          fg.addColorStop(1, "rgba(167,139,250,0)");
          ctx.fillStyle = fg;
          ctx.beginPath();
          ctx.moveTo(x + 2, yc - halfThick);
          ctx.lineTo(x - flameLen, yc);
          ctx.lineTo(x + 2, yc + halfThick);
          ctx.closePath();
          ctx.fill();
        }
        drawJet(cy - bodyH * 0.25);
        drawJet(cy + bodyH * 0.25);
        // Nozzle glow
        const glowR = 12 + 16 * fi;
        [cy - bodyH * 0.25, cy + bodyH * 0.25].forEach(function(yc) {
          const glow = ctx.createRadialGradient(x, yc, 0, x, yc, glowR);
          glow.addColorStop(0, "rgba(212,166,106," + (0.15 + 0.15 * fi).toFixed(2) + ")");
          glow.addColorStop(1, "rgba(212,166,106,0)");
          ctx.fillStyle = glow;
          ctx.fillRect(x - glowR, yc - glowR, glowR * 2, glowR * 2);
        });
      }

      // Стреловидные хвостовые плавники
      ctx.fillStyle = "rgba(44,56,88,0.9)";
      ctx.strokeStyle = "rgba(77,225,255,0.6)";
      ctx.lineWidth = 1;
      // Top fin
      ctx.beginPath();
      ctx.moveTo(x + 18, y + 2);
      ctx.lineTo(x - 6, y - 6);
      ctx.lineTo(x - 22, y - 22);
      ctx.lineTo(x + 4, y + 8);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // Bottom fin
      ctx.beginPath();
      ctx.moveTo(x + 18, y + bodyH - 2);
      ctx.lineTo(x - 6, y + bodyH + 6);
      ctx.lineTo(x - 22, y + bodyH + 22);
      ctx.lineTo(x + 4, y + bodyH - 8);
      ctx.closePath();
      ctx.fill(); ctx.stroke();

      // Корпус — металлическая капсула
      const bodyGrad = ctx.createLinearGradient(x, y, x, y + bodyH);
      bodyGrad.addColorStop(0, "rgba(28,36,60,0.95)");
      bodyGrad.addColorStop(0.3, "rgba(44,56,88,0.95)");
      bodyGrad.addColorStop(0.5, "rgba(52,64,100,0.95)");
      bodyGrad.addColorStop(0.7, "rgba(40,52,82,0.95)");
      bodyGrad.addColorStop(1, "rgba(18,24,44,0.95)");
      ctx.fillStyle = bodyGrad;
      ctx.strokeStyle = "rgba(77,225,255,0.75)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, bodyW, bodyH, 14);
      } else { ctx.rect(x, y, bodyW, bodyH); }
      ctx.fill(); ctx.stroke();

      // Hull panel lines (subtle detail)
      ctx.strokeStyle = "rgba(77,225,255,0.12)";
      ctx.lineWidth = 0.8;
      [0.33, 0.66].forEach(function(frac) {
        ctx.beginPath();
        ctx.moveTo(x + bodyW * frac, y + 6);
        ctx.lineTo(x + bodyW * frac, y + bodyH - 6);
        ctx.stroke();
      });

      // Highlight strip along top edge
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 14, y + 1);
      ctx.lineTo(x + bodyW - 14, y + 1);
      ctx.stroke();

      // Носовой конус — острый, вытянутый
      const noseTip = x + bodyW + 56;
      const noseGrad = ctx.createLinearGradient(x + bodyW, y, noseTip, cy);
      noseGrad.addColorStop(0, "rgba(44,56,88,0.95)");
      noseGrad.addColorStop(0.5, "rgba(60,80,120,0.95)");
      noseGrad.addColorStop(1, "rgba(77,225,255,0.7)");
      ctx.fillStyle = noseGrad;
      ctx.strokeStyle = "rgba(77,225,255,0.75)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + bodyW - 4, y + 6);
      ctx.quadraticCurveTo(x + bodyW + 20, y + bodyH * 0.28, noseTip, cy);
      ctx.quadraticCurveTo(x + bodyW + 20, y + bodyH * 0.72, x + bodyW - 4, y + bodyH - 6);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // Nose tip highlight
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath(); ctx.arc(noseTip - 2, cy, 1.8, 0, Math.PI * 2); ctx.fill();

      // Nozzle housings (tail)
      ctx.fillStyle = "rgba(36,44,70,0.9)";
      ctx.strokeStyle = "rgba(77,225,255,0.5)";
      ctx.lineWidth = 1;
      [cy - bodyH * 0.25, cy + bodyH * 0.25].forEach(function(yc) {
        ctx.beginPath();
        ctx.moveTo(x + 2, yc - 6);
        ctx.lineTo(x - 8, yc - 8);
        ctx.lineTo(x - 8, yc + 8);
        ctx.lineTo(x + 2, yc + 6);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      });

      // Иллюминатор-окно
      const winPadX = 18;
      const winPadY = 10;
      const winX = x + winPadX;
      const winY = y + winPadY;
      const winW = bodyW - winPadX * 2 - 14;
      const winH = bodyH - winPadY * 2;
      const winGrad = ctx.createLinearGradient(winX, winY, winX, winY + winH);
      winGrad.addColorStop(0, "rgba(10,18,36,0.7)");
      winGrad.addColorStop(1, "rgba(6,10,24,0.8)");
      ctx.fillStyle = winGrad;
      ctx.strokeStyle = "rgba(94,243,192,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(winX, winY, winW, winH, 10);
      } else { ctx.rect(winX, winY, winW, winH); }
      ctx.fill(); ctx.stroke();
    }

    // Зигзаг в системе ракеты (камера движется вместе с ней).
    // Узлы зигзага — точки касания зеркал в моменты t_i = i * T_HIT_MOVE в лаб-кадре.
    // В лаб-кадре их x = xPhoton(t_i) = xRocket_lab(t_i).
    // На экране x_screen = (xPhoton_lab - xRocket_lab(simTime)) + xRocketScreen
    //                    = vsPx · (t_i − simTime) + xRocketScreen
    // → узлы дрейфуют влево относительно ракеты со скоростью vs.
    function drawZigzagTrailFollowing(ctx, xRocketScreen, vsPx, T_HIT_MOVE, simTime, yLow, yHigh, color, leftBound, rightBound) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = "round";
      ctx.beginPath();
      const lastNode = Math.floor(simTime / T_HIT_MOVE + 1e-9);
      // Сколько узлов рисуем, чтобы зигзаг не уходил далеко за левый край
      // (узлы старше t_now − maxAge сек уже за левым краем canvas).
      const maxAge = vsPx > 1e-6 ? (xRocketScreen - leftBound) / vsPx + T_HIT_MOVE : 1e9;
      const minNode = Math.max(0, Math.ceil((simTime - maxAge) / T_HIT_MOVE - 1));
      let started = false;
      for (let i = minNode; i <= lastNode; i++) {
        const tNode = i * T_HIT_MOVE;
        const dxNode = vsPx * (tNode - simTime);
        const xNode = xRocketScreen + dxNode;
        const yNode = (i % 2 === 0) ? yLow : yHigh;
        if (!started) { ctx.moveTo(xNode, yNode); started = true; }
        else ctx.lineTo(xNode, yNode);
      }
      // финальный частичный сегмент — от последнего узла до текущей позиции фотона (она всегда у ракеты)
      const localT = simTime - lastNode * T_HIT_MOVE;
      if (localT > 0 || !started) {
        const localFrac = T_HIT_MOVE > 0 ? clamp(localT / T_HIT_MOVE, 0, 1) : 0;
        const yPrev = (lastNode % 2 === 0) ? yLow : yHigh;
        const yNext = (lastNode % 2 === 0) ? yHigh : yLow;
        const yNow = lerp(yPrev, yNext, localFrac);
        if (!started) ctx.moveTo(xRocketScreen, yNow);
        else ctx.lineTo(xRocketScreen, yNow);
      }
      ctx.stroke();
    }

    function drawMovingScene(ctx, x0, y0, sw, sh, beta, g, t) {
      // Фон — космос
      const sky = ctx.createLinearGradient(0, y0, 0, y0 + sh);
      sky.addColorStop(0, "rgba(8,12,28,1)");
      sky.addColorStop(1, "rgba(2,4,12,1)");
      ctx.fillStyle = sky;
      ctx.fillRect(x0, y0, sw, sh);

      const T_HIT_MOVE = T_HIT_REST * g;
      const vsPx = beta * CS_PX;

      // Звёзды дрейфуют назад с параллаксом, скорость = скорости ракеты.
      // Это создаёт ощущение бесконечного полёта.
      drawStars(ctx, x0, y0, sw, sh, 110, 7.13, vsPx * t);

      // Камера зафиксирована на ракете. Ракета ровно по центру —
      // её фотонные часы стоят строго над часами в нижней сцене.
      const padX = 56;
      const xRocket = x0 + sw * 0.5;
      const yMid = y0 + sh * 0.55;
      const yHigh = yMid - LS_PX / 2;
      const yLow = yMid + LS_PX / 2;

      // Корпус ракеты — ПЕРВЫЙ слой (под траекторией и часами)
      drawRocket(ctx, xRocket, yMid, 150, flameIntensity);

      // Зигзаг (тянется ВЛЕВО от ракеты, безначально) — ПОВЕРХ ракеты,
      // потому что фокус модели — на траектории, а не на корпусе.
      drawZigzagTrailFollowing(ctx, xRocket, vsPx, T_HIT_MOVE, t, yLow, yHigh,
        "rgba(212,166,106,0.85)", x0 + 4, x0 + sw);

      // Зеркала в ракете — поверх корпуса
      drawMirror(ctx, xRocket, yHigh, "#7dc4a8");
      drawMirror(ctx, xRocket, yLow, "#7dc4a8");

      // L-маркер (справа от часов)
      drawLMarker(ctx, xRocket + 40, yHigh, yLow);

      // Положение фотона.
      // В лаб-кадре фотон движется ВМЕСТЕ с ракетой по горизонтали (одна и та же скорость v),
      // поэтому в системе ракеты он стоит на месте по x. По y движется между зеркалами
      // со скоростью c/γ (так получается, чтобы полная скорость в лаб-кадре = c).
      const hitIdx = Math.floor(t / T_HIT_MOVE + 1e-9);
      const localT = t - hitIdx * T_HIT_MOVE;
      const localFrac = T_HIT_MOVE > 0 ? clamp(localT / T_HIT_MOVE, 0, 1) : 0;
      const goingUp = hitIdx % 2 === 0;
      const yPh = goingUp ? lerp(yLow, yHigh, localFrac) : lerp(yHigh, yLow, localFrac);

      // Фотон — последним
      drawPhotonGlow(ctx, xRocket, yPh, "#d4a66a");

      // Подписи
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = "600 13px Outfit";
      ctx.textAlign = "left";
      ctx.fillText("Часы в ракете (наблюдатель снаружи)", x0 + 14, y0 + 22);

      // Один тик = два касания зеркал ⇒ floor(t / (2·T_HIT_MOVE))
      const ticksMove = Math.floor(t / (2 * T_HIT_MOVE) + 1e-9);
      ctx.fillStyle = "rgba(212,166,106,0.95)";
      ctx.font = "600 14px JetBrains Mono, ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.fillText("Тиков: " + ticksMove, x0 + sw - 18, y0 + 26);

      // Бэйдж скорости света — ОДИНАКОВЫЙ в обеих сценах
      ctx.fillStyle = "rgba(94,243,192,0.85)";
      ctx.font = "11px JetBrains Mono, ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.fillText("скорость фотона: c = " + CS_PX + " пикс/с (та же, что и снизу)",
        x0 + sw - 18, y0 + sh - 10);

      // Подпись пути
      ctx.fillStyle = "rgba(212,166,106,0.85)";
      ctx.font = "11px Outfit";
      ctx.textAlign = "left";
      const pathK = (2 * g).toFixed(2);
      ctx.fillText(
        "путь за тик = " + pathK + "·L  (диагонали, в γ = " + g.toFixed(2) + " раз длиннее)",
        x0 + 14, y0 + sh - 10,
      );
    }

    function drawRestScene(ctx, x0, y0, sw, sh, t) {
      const bg = ctx.createLinearGradient(0, y0, 0, y0 + sh);
      bg.addColorStop(0, "rgba(6,10,20,0.95)");
      bg.addColorStop(1, "rgba(2,4,10,1)");
      ctx.fillStyle = bg;
      ctx.fillRect(x0, y0, sw, sh);
      drawStars(ctx, x0, y0, sw, sh, 30, 17.71, 0);

      const cx = x0 + sw * 0.5;
      const yMid = y0 + sh * 0.55;
      const yHigh = yMid - LS_PX / 2;
      const yLow = yMid + LS_PX / 2;

      // Вертикальный «след» — путь фотона = 2L (один цикл)
      ctx.strokeStyle = "rgba(94,243,192,0.7)";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, yLow); ctx.lineTo(cx, yHigh);
      ctx.stroke();
      ctx.setLineDash([]);

      drawMirror(ctx, cx, yHigh, "#7dc4a8");
      drawMirror(ctx, cx, yLow, "#7dc4a8");
      drawLMarker(ctx, cx + 40, yHigh, yLow);

      // Фотон
      const hitIdx = Math.floor(t / T_HIT_REST + 1e-9);
      const localT = t - hitIdx * T_HIT_REST;
      const localFrac = clamp(localT / T_HIT_REST, 0, 1);
      const goingUp = hitIdx % 2 === 0;
      const yPh = goingUp ? lerp(yLow, yHigh, localFrac) : lerp(yHigh, yLow, localFrac);
      drawPhotonGlow(ctx, cx, yPh, "#7dc4a8");

      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = "600 13px Outfit";
      ctx.textAlign = "left";
      ctx.fillText("Часы в руках (покоятся)", x0 + 14, y0 + 22);

      // Один тик = два удара ⇒ floor(t / (2·T_HIT_REST))
      const ticksRest = Math.floor(t / T_TICK_REST + 1e-9);
      ctx.fillStyle = "rgba(94,243,192,0.95)";
      ctx.font = "600 14px JetBrains Mono, ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.fillText("Тиков: " + ticksRest, x0 + sw - 18, y0 + 26);

      ctx.fillStyle = "rgba(94,243,192,0.85)";
      ctx.font = "11px JetBrains Mono, ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.fillText("скорость фотона: c = " + CS_PX + " пикс/с", x0 + sw - 18, y0 + sh - 10);

      ctx.fillStyle = "rgba(94,243,192,0.85)";
      ctx.font = "11px Outfit";
      ctx.textAlign = "left";
      ctx.fillText("путь за тик = 2·L  (минимальный, вертикальный)", x0 + 14, y0 + sh - 10);
    }

    function render() {
      if (!dim) return;
      const { w, h, ctx } = dim;
      const beta = slV.value;
      const g = gamma(beta);

      ctx.clearRect(0, 0, w, h);

      // Верх — ракета
      drawMovingScene(ctx, 0, 0, w, h * 0.55, beta, g, simTime);
      // Разделитель
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, h * 0.55); ctx.lineTo(w, h * 0.55); ctx.stroke();
      // Низ — покой
      drawRestScene(ctx, 0, h * 0.55, w, h * 0.45, simTime);

      // Числа
      const ticksRest = Math.floor(simTime / T_TICK_REST + 1e-9);
      const T_TICK_MOVE = T_TICK_REST * g;
      const ticksMove = Math.floor(simTime / T_TICK_MOVE + 1e-9);
      rGm.set(g.toFixed(3));
      rT0.set("1.000 (ед.)");
      rTm.set(g.toFixed(3) + " (ед.)");
      rTickRest.set(String(ticksRest));
      rTickMove.set(String(ticksMove));
      rRatio.set("в " + g.toFixed(3) + " раз");
    }

    return {
      resize() { dim = setup.resize(); render(); },
      tick(dt) {
        simTime += dt;
        // simTime растёт бесконечно, без сброса — симуляция непрерывная.
        // Численное переполнение double актуально лишь после многих часов работы;
        // на всякий случай мягко удерживаем simTime в разумных пределах.
        if (simTime > 1e6) simTime = simTime % (T_TICK_REST * 1024);

        // Экспоненциальное приближение интенсивности пламени к текущей β.
        // Кривая корня: при v = 0 → 0 (тяга выключена); при малой v уже заметная
        // тяга; на пределе — максимум. Это лучше, чем линейная, потому что
        // ответ на малых скоростях гораздо нагляднее.
        const beta = slV.value;
        const target = beta <= 0 ? 0 : Math.sqrt(beta);
        const k = 1 - Math.exp(-dt * 6);
        flameIntensity += (target - flameIntensity) * k;

        render();
      },
      reset() { simTime = 0; flameIntensity = 0; },
    };
  }

  // ============================================================
  // GLAVA 4: Atom chain
  // ============================================================
  function createAtomChain(host) {
    host.appendChild(makeStageHead("Почему обычные часы тоже замедляются"));
    const canvas = el("canvas", { "aria-label": "Сигнал между атомами: прямой в покое, дуга при движении" });
    host.appendChild(makeCanvasWrap(canvas));

    const sl = makeSlider({
      label: "Скорость часов v (доля c)",
      min: 0,
      max: 0.95,
      step: 0.01,
      value: 0.0,
      format: (v) => v.toFixed(2) + "·c",
      onInput: () => render(),
    });
    host.appendChild(el("div", { class: "ls-controls ls-controls--row" }, [sl.field]));

    const rGm = makeReadout("γ (Лоренц-фактор)", "accent");
    const rPathRest = makeReadout("Путь сигнала (покой)", "a");
    const rPathMove = makeReadout("Путь сигнала (движение)", "b");
    const rRatio = makeReadout("Замедление стрелки", "violet");
    host.appendChild(el("div", { class: "ls-readouts" }, [rGm.card, rPathRest.card, rPathMove.card, rRatio.card]));

    host.appendChild(el("div", { class: "ls-formula ls-formula--mint" }, [
      "Скорость сигнала = const,  путь дуги > прямой  →  стрелка тикает медленнее",
    ]));

    const setup = setupCanvas(canvas, { aspect: 16 / 8 });
    let dim = null;
    let phase = 0;
    let ticksRest = 0;
    let ticksMove = 0;
    let flashRestT = 0;   // время с последнего тика (покой) для вспышки
    let flashMoveT = 0;   // время с последнего тика (движение) для вспышки
    const FLASH_DUR = 0.4; // длительность вспышки в секундах

    const N = 8;
    // Длина дуги при beta=0 совпадает с прямой → SEG_TIME одинаков.
    // При beta>0 дуга длиннее → сигнал проходит тот же сегмент дольше.
    // Сигнал всегда движется с постоянной «линейной скоростью» по своему пути.

    // Длина полуволны-дуги для заданного arcH:
    // Аппроксимация длины sin-дуги на отрезке [0, spacing]:
    //   L = ∫₀¹ sqrt(dx² + dy²) ≈ spacing · sqrt(1 + (π·arcH/spacing)²/2)
    // Но нам проще: при beta=0, arcH=0, L=spacing (прямая).
    // arcH = maxArc * beta, где maxArc — высота дуги при beta→1.
    // Длину считаем численно для точности.

    function arcLength(spacing, arcH, steps) {
      let len = 0;
      let px = 0, py = 0;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = t * spacing;
        const y = Math.sin(t * Math.PI) * arcH;
        len += Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
        px = x; py = y;
      }
      return len;
    }

    // Найти высоту дуги, при которой arcLength/spacing = targetRatio (т.е. γ)
    // Бинарный поиск по arcH
    function findArcH(spacing, targetRatio) {
      if (targetRatio <= 1.001) return 0;
      let lo = 0, hi = spacing * 4;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        const ratio = arcLength(spacing, mid, 40) / spacing;
        if (ratio < targetRatio) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }

    // Вычислить корректную высоту дуги и время сегмента для данного beta
    // maxVisualH ограничивает высоту дуги, чтобы не залезала на надписи
    function getArcParams(spacing, beta, maxVisualH) {
      const g = gamma(beta);
      let arcH = findArcH(spacing, g);
      // Ограничиваем визуальную высоту, но время всегда точное (γ)
      if (maxVisualH && arcH > maxVisualH) arcH = maxVisualH;
      const segTimeCurved = SEG_TIME_REST * g;  // скорость сигнала const → время = d·γ / c
      return { arcH, segTimeCurved, g };
    }

    const SEG_TIME_REST = 0.5;  // базовое время на один сегмент в покое
    const TOTAL_SEGS = N - 1;
    const TICK_TIME_REST = TOTAL_SEGS * SEG_TIME_REST;

    function render() {
      if (!dim) return;
      const { w, h, ctx } = dim;
      const beta = sl.value;
      const g = gamma(beta);
      ctx.clearRect(0, 0, w, h);

      const halfH = h / 2;

      drawScene(ctx, 0, 0, w, halfH, false, beta, g);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath(); ctx.moveTo(0, halfH); ctx.lineTo(w, halfH); ctx.stroke();
      drawScene(ctx, 0, halfH, w, halfH, true, beta, g);

      rGm.set(g === Infinity ? "∞" : g.toFixed(4));
      rPathRest.set("d (прямая)");
      rPathMove.set("d · " + g.toFixed(2) + " (дуга)");
      const ratio = ticksMove > 0 ? (ticksRest / ticksMove).toFixed(2) : "—";
      rRatio.set(ratio === "—" ? "—" : "×" + ratio);
    }

    function drawScene(ctx, x0, y0, sw, sh, isBottom, beta, g) {
      const padX = 40;
      const clockR = Math.min(sh * 0.26, 30);
      const clockCx = x0 + padX + clockR + 4;
      const clockCy = y0 + sh / 2;

      // Заголовок
      const color = isBottom ? "#d4a66a" : "#7eb8d4";
      const colorA = isBottom ? "rgba(212,166,106," : "rgba(77,225,255,";
      ctx.fillStyle = colorA + "0.95)";
      ctx.font = "600 12px Outfit";
      ctx.textAlign = "left";
      ctx.fillText(
        isBottom
          ? "Движущиеся часы (v = " + beta.toFixed(2) + "·c)"
          : "Часы в покое",
        clockCx + clockR + 12, y0 + 18
      );

      // Циферблат
      ctx.strokeStyle = colorA + "0.5)";
      ctx.fillStyle = "rgba(20,24,38,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(clockCx, clockCy, clockR, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI / 2 + i * (Math.PI / 6);
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = i % 3 === 0 ? 1.6 : 0.8;
        ctx.beginPath();
        ctx.moveTo(clockCx + Math.cos(a) * (clockR - 5), clockCy + Math.sin(a) * (clockR - 5));
        ctx.lineTo(clockCx + Math.cos(a) * (clockR - 1), clockCy + Math.sin(a) * (clockR - 1));
        ctx.stroke();
      }
      const ticks = isBottom ? ticksMove : ticksRest;
      const handAngle = -Math.PI / 2 + (ticks % 12) * (Math.PI / 6);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(clockCx, clockCy);
      ctx.lineTo(clockCx + Math.cos(handAngle) * (clockR - 7), clockCy + Math.sin(handAngle) * (clockR - 7));
      ctx.stroke();
      ctx.lineCap = "butt";
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(clockCx, clockCy, 2.5, 0, Math.PI * 2); ctx.fill();

      // --- Цепочка атомов (статична, не двигается!) ---
      const chainLeft = clockCx + clockR + 50;
      const chainRight = x0 + sw - padX;
      const chainW = chainRight - chainLeft;
      const spacing = chainW / (N - 1);
      const chainY = y0 + sh * 0.65;

      // Физически корректная высота дуги: arcLength/spacing = γ
      // Ограничиваем высоту: не больше расстояния от chainY до заголовка (с запасом)
      const maxVisH = chainY - y0 - 36;
      const ap = getArcParams(spacing, beta, maxVisH);
      const arcH = ap.arcH;

      // Фаза сигнала
      const segTime = isBottom ? ap.segTimeCurved : SEG_TIME_REST;
      const effPhase = phase / segTime;
      const segIdx = Math.floor(effPhase) % TOTAL_SEGS;
      const localT = effPhase - Math.floor(effPhase);

      // Линия-стрелка под атомами (показывает, что это стрелка часов)
      // Базовая полупрозрачная линия
      ctx.strokeStyle = colorA + "0.12)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(chainLeft, chainY);
      ctx.lineTo(chainRight, chainY);
      ctx.stroke();
      // Наконечник стрелки (полупрозрачный)
      ctx.fillStyle = colorA + "0.15)";
      ctx.beginPath();
      ctx.moveTo(chainRight, chainY);
      ctx.lineTo(chainRight - 10, chainY - 5);
      ctx.lineTo(chainRight - 10, chainY + 5);
      ctx.closePath(); ctx.fill();
      // Подсвеченные (уже «переключенные») сегменты — от 0 до segIdx
      if (segIdx > 0) {
        ctx.strokeStyle = colorA + "0.6)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(chainLeft, chainY);
        ctx.lineTo(chainLeft + segIdx * spacing, chainY);
        ctx.stroke();
        // Наконечник пройденной части
        const tipX = chainLeft + segIdx * spacing;
        ctx.fillStyle = colorA + "0.5)";
        ctx.beginPath();
        ctx.moveTo(tipX + 4, chainY);
        ctx.lineTo(tipX - 4, chainY - 3);
        ctx.lineTo(tipX - 4, chainY + 3);
        ctx.closePath(); ctx.fill();
      }

      // Рисуем атомы
      for (let i = 0; i < N; i++) {
        const ax = chainLeft + i * spacing;
        const isActive = (i === segIdx || i === segIdx + 1);

        if (isActive) {
          const glowR = 16;
          const glow = ctx.createRadialGradient(ax, chainY, 0, ax, chainY, glowR);
          glow.addColorStop(0, colorA + "0.25)");
          glow.addColorStop(1, colorA + "0)");
          ctx.fillStyle = glow;
          ctx.fillRect(ax - glowR, chainY - glowR, glowR * 2, glowR * 2);
        }

        ctx.fillStyle = isActive ? "rgba(94,243,192,0.3)" : "rgba(94,243,192,0.12)";
        ctx.strokeStyle = isActive ? "rgba(94,243,192,0.9)" : "rgba(94,243,192,0.4)";
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(ax, chainY, 7, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();

        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.font = "8px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), ax, chainY + 20);
      }

      // Подпись
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "10px Outfit";
      ctx.textAlign = "center";
      ctx.fillText("← стрелка часов (атомы) →", (chainLeft + chainRight) / 2, chainY + 32);

      // --- Путь и сигнал ---
      const srcX = chainLeft + segIdx * spacing;
      const tgtX = chainLeft + (segIdx + 1) * spacing;

      if (!isBottom || arcH < 0.5) {
        // Прямой путь
        const px = lerp(srcX, tgtX, localT);

        // Пунктирная линия пути
        ctx.strokeStyle = colorA + "0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(srcX, chainY - 14); ctx.lineTo(tgtX, chainY - 14); ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = colorA + "0.7)";
        ctx.font = "600 11px Outfit";
        ctx.textAlign = "center";
        ctx.fillText("d", (srcX + tgtX) / 2, chainY - 18);

        // Фотон
        const grad = ctx.createRadialGradient(px, chainY, 0, px, chainY, 12);
        grad.addColorStop(0, "rgba(255,255,255,0.95)");
        grad.addColorStop(0.4, colorA + "0.6)");
        grad.addColorStop(1, colorA + "0)");
        ctx.fillStyle = grad;
        ctx.fillRect(px - 12, chainY - 12, 24, 24);
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(px, chainY, 3, 0, Math.PI * 2); ctx.fill();
      } else {
        // Дуговой путь: сигнал бежит по дуге с той же скоростью,
        // но путь длиннее → медленнее добирается до следующего атома

        // Позиция сигнала вдоль дуги (параметрически по длине дуги)
        // localT — доля пройденного пути по дуге (от 0 до 1)
        // Находим x,y на дуге по localT (аппроксимация по длине)
        function posOnArc(t) {
          return { x: lerp(srcX, tgtX, t), y: chainY - Math.sin(t * Math.PI) * arcH };
        }

        // Пунктирная дуга — полный путь
        ctx.strokeStyle = colorA + "0.35)";
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        for (let s = 0; s <= 30; s++) {
          const t = s / 30;
          const p = posOnArc(t);
          if (s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Подпись на дуге
        ctx.fillStyle = colorA + "0.85)";
        ctx.font = "600 11px Outfit";
        ctx.textAlign = "center";
        ctx.fillText("d · γ = d · " + g.toFixed(2), (srcX + tgtX) / 2, chainY - arcH - 8);

        // Пунктирная горизонталь «d (в покое)» для сравнения
        ctx.strokeStyle = "rgba(77,225,255,0.2)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(srcX, chainY - 14); ctx.lineTo(tgtX, chainY - 14); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(77,225,255,0.45)";
        ctx.font = "10px Outfit";
        ctx.textAlign = "center";
        ctx.fillText("d (покой)", (srcX + tgtX) / 2, chainY - 18);

        // Пройденная часть дуги — сплошная яркая
        ctx.strokeStyle = colorA + "0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        const steps = Math.max(1, Math.round(localT * 30));
        for (let s = 0; s <= steps; s++) {
          const t = s / 30;
          const p = posOnArc(t);
          if (s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();

        // Фотон на дуге
        const pos = posOnArc(localT);
        const grad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 12);
        grad.addColorStop(0, "rgba(255,255,255,0.95)");
        grad.addColorStop(0.4, colorA + "0.6)");
        grad.addColorStop(1, colorA + "0)");
        ctx.fillStyle = grad;
        ctx.fillRect(pos.x - 12, pos.y - 12, 24, 24);
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2); ctx.fill();
      }

      // Вспышка стрелки при тике (сигнал дошёл до последнего атома)
      const flashT = isBottom ? flashMoveT : flashRestT;
      if (flashT > 0 && flashT < FLASH_DUR) {
        const flashA = 1 - flashT / FLASH_DUR;
        // Подсветка всей линии стрелки
        ctx.strokeStyle = colorA + (0.5 * flashA) + ")";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(chainLeft, chainY);
        ctx.lineTo(chainRight, chainY);
        ctx.stroke();
        // Свечение вдоль каждого атома
        for (let i = 0; i < N; i++) {
          const ax = chainLeft + i * spacing;
          const gr = ctx.createRadialGradient(ax, chainY, 0, ax, chainY, 14);
          gr.addColorStop(0, colorA + (0.4 * flashA) + ")");
          gr.addColorStop(1, colorA + "0)");
          ctx.fillStyle = gr;
          ctx.fillRect(ax - 14, chainY - 14, 28, 28);
        }
      }

      // Счётчик тиков
      ctx.fillStyle = colorA + "0.85)";
      ctx.font = "600 11px Outfit";
      ctx.textAlign = "right";
      ctx.fillText("тиков: " + ticks, x0 + sw - padX, y0 + 18);
    }

    return {
      resize() { dim = setup.resize(); render(); },
      tick(dt) {
        const beta = sl.value;
        const g = gamma(beta);
        const prev = phase;
        phase += dt;

        // Обновляем таймеры вспышек
        flashRestT += dt;
        flashMoveT += dt;

        // Тик в покое: каждые TICK_TIME_REST секунд
        const prevTR = Math.floor(prev / TICK_TIME_REST);
        const currTR = Math.floor(phase / TICK_TIME_REST);
        const newTicksRest = currTR - prevTR;
        if (newTicksRest > 0) { ticksRest += newTicksRest; flashRestT = 0; }

        // Тик при движении: время = TICK_TIME_REST * γ (путь длиннее в γ раз)
        const tickTimeMove = TICK_TIME_REST * g;
        if (Number.isFinite(tickTimeMove) && tickTimeMove > 0) {
          const prevTM = Math.floor(prev / tickTimeMove);
          const currTM = Math.floor(phase / tickTimeMove);
          const newTicksMove = currTM - prevTM;
          if (newTicksMove > 0) { ticksMove += newTicksMove; flashMoveT = 0; }
        }

        if (phase > 1e6) phase = 0;
        render();
      },
      reset() { phase = 0; ticksRest = 0; ticksMove = 0; flashRestT = 99; flashMoveT = 99; },
    };
  }

  // ============================================================
  // GLAVA 5: Muons
  // ============================================================
  function createMuons(host) {
    host.appendChild(makeStageHead("Поток мионов: классика и СТО"));
    const canvas = el("canvas", { "aria-label": "Атмосфера и поток мионов вниз" });
    host.appendChild(makeCanvasWrap(canvas));

    const slH = makeSlider({
      label: "Высота рождения, км",
      min: 5,
      max: 30,
      step: 0.5,
      value: 15,
      format: (v) => v.toFixed(1) + " км",
      onInput: () => render(),
    });
    const slBeta = makeSlider({
      label: "v / c",
      min: 0.5,
      max: 0.9999,
      step: 0.0001,
      value: 0.995,
      format: (v) => v.toFixed(4) + "·c",
      onInput: () => render(),
    });
    host.appendChild(el("div", { class: "ls-controls" }, [slH.field, slBeta.field]));

    const rTime = makeReadout("Время полёта (Земля)", "violet");
    const rTau = makeReadout("Собственное время мюона", "a");
    const rGm = makeReadout("γ", "accent");
    const rCls = makeReadout("Долетели (классика)", "b");
    const rRel = makeReadout("Долетели (СТО)", "accent");
    host.appendChild(el("div", { class: "ls-readouts" }, [rTime.card, rTau.card, rGm.card, rCls.card, rRel.card]));
    host.appendChild(el("div", { class: "ls-formula ls-formula--mint" }, ["t = h/v,   τ = t/γ,   N(t) = N₀·2^(−t/T₁/₂),   T₁/₂ = 1.56 мкс"]));

    const setup = setupCanvas(canvas, { aspect: 16 / 8 });
    let dim = null;
    let phase = 0;
    const N_MUONS = 160;
    // Each muon has a random "lifetime in own frame" from exponential distribution
    // and random horizontal offset. We deterministically seed by index for repeatability.
    const muons = [];
    function rand(seed) { let s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); }
    for (let i = 0; i < N_MUONS; i++) {
      muons.push({
        x: rand(i * 7 + 1),                   // horizontal 0..1
        tau0: -Math.log(1 - rand(i * 13 + 11)) * (1.56e-6 / Math.LN2), // exp lifetime via 2^(-t/T)
        spawnPh: rand(i * 19 + 5),
      });
    }

    function render() {
      if (!dim) return;
      const { w, h, ctx } = dim;
      const hKm = slH.value;
      const beta = slBeta.value;
      const v = beta * C;
      const g = gamma(beta);
      const halfLife = 1.56e-6;
      const tFly = (hKm * 1000) / v;
      const tauFly = tFly / g;

      ctx.clearRect(0, 0, w, h);
      // Sky gradient
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "rgba(60,90,160,0.25)");
      sky.addColorStop(0.6, "rgba(20,30,60,0.45)");
      sky.addColorStop(1, "rgba(8,16,32,0.85)");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // Earth surface
      ctx.fillStyle = "rgba(40,60,55,0.9)";
      ctx.fillRect(0, h - 14, w, 14);
      ctx.strokeStyle = "rgba(94,243,192,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, h - 14); ctx.lineTo(w, h - 14); ctx.stroke();

      // Top "spawn" line
      const padTop = 20;
      ctx.strokeStyle = "rgba(167,139,250,0.5)";
      ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(0, padTop); ctx.lineTo(w, padTop); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(167,139,250,0.85)";
      ctx.font = "11px Outfit";
      ctx.textAlign = "left";
      ctx.fillText("высота " + hKm.toFixed(1) + " км", 10, padTop - 6);

      // Animation: cycle period — full descent
      const cycle = 4; // sec real time per descent
      const baseY = h - 14;
      const trackH = baseY - padTop;

      let aliveCls = 0, aliveRel = 0;
      for (let i = 0; i < muons.length; i++) {
        const m = muons[i];
        const localPh = (phase / cycle + m.spawnPh) % 1;
        const yPx = padTop + localPh * trackH;
        const xPx = 12 + m.x * (w - 24);
        // Time elapsed since spawn (lab frame)
        const tElapsed = localPh * tFly;
        const tauElapsed = tElapsed / g;

        const aliveClassic = Math.pow(0.5, tElapsed / halfLife) > Math.pow(0.5, m.tau0 / halfLife * 1.0); // simpler: per-muon proper time threshold m.tau0
        // easier: exponential lifetime sample m.tau0 (in proper time). In CLASSIC interpretation the muon's clock IS the lab clock.
        const aliveCl = tElapsed < m.tau0;       // classic: no time dilation, decay by lab-time
        const aliveRl = tauElapsed < m.tau0;     // SR: decay by proper time
        if (aliveCl) aliveCls++;
        if (aliveRl) aliveRel++;

        // Draw muon (left half — classic, right half — SR)
        const isLeft = i % 2 === 0;
        const xLeft = (xPx - 12) * 0.5 + 12;
        const xRight = ((xPx - 12) * 0.5) + (w / 2) + 6;
        const drawX = isLeft ? xLeft : xRight;

        const alive = isLeft ? aliveCl : aliveRl;
        if (alive) {
          ctx.fillStyle = isLeft ? "rgba(255,102,128,0.85)" : "rgba(94,243,192,0.85)";
          ctx.beginPath(); ctx.arc(drawX, yPx, 2, 0, Math.PI * 2); ctx.fill();
        } else if (localPh < 0.95) {
          // brief decay flash
          ctx.fillStyle = "rgba(212,166,106,0.35)";
          ctx.beginPath(); ctx.arc(drawX, yPx, 1.4, 0, Math.PI * 2); ctx.fill();
        }
      }

      // Half-frame divider
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.beginPath(); ctx.moveTo(w / 2, padTop); ctx.lineTo(w / 2, baseY); ctx.stroke();
      ctx.font = "600 12px Outfit";
      ctx.fillStyle = "rgba(255,102,128,0.85)";
      ctx.textAlign = "center";
      ctx.fillText("Без СТО (классика)", w * 0.25, padTop + 14);
      ctx.fillStyle = "rgba(94,243,192,0.85)";
      ctx.fillText("С учётом СТО", w * 0.75, padTop + 14);

      // Update readouts
      const fracCl = Math.pow(0.5, tFly / halfLife);
      const fracRl = Math.pow(0.5, tauFly / halfLife);
      rTime.set(fmtSci(tFly * 1e6) + " мкс");
      rTau.set(fmtSci(tauFly * 1e6) + " мкс");
      rGm.set(g === Infinity ? "∞" : g.toFixed(3));
      rCls.set((fracCl * 100).toFixed(2) + " %");
      rRel.set((fracRl * 100).toFixed(2) + " %");
    }

    return {
      resize() { dim = setup.resize(); render(); },
      tick(dt) { phase += dt; render(); },
      reset() { phase = 0; tBot = 0; tTop = 0; },
    };
  }

  // ============================================================
  // GLAVA 6: All processes (split-screen, slowed by 1/γ on top)
  // ============================================================
  function createAllProcesses(host) {
    host.appendChild(makeStageHead("Замедляются все процессы одинаково"));
    const canvas = el("canvas", { "aria-label": "Сравнение пяти процессов в покое и в движении" });
    host.appendChild(makeCanvasWrap(canvas));

    const sl = makeSlider({
      label: "v / c (для движущейся системы)",
      min: 0,
      max: 0.99,
      step: 0.01,
      value: 0.95,
      format: (v) => v.toFixed(2) + "·c",
      onInput: () => render(),
    });
    host.appendChild(el("div", { class: "ls-controls ls-controls--row" }, [sl.field]));

    const rGm = makeReadout("γ", "accent");
    const rSlow = makeReadout("Замедление сверху", "b");
    host.appendChild(el("div", { class: "ls-readouts" }, [rGm.card, rSlow.card]));
    host.appendChild(el("div", { class: "ls-formula" }, ["В верхней системе все процессы замедлены в γ раз для внешнего наблюдателя"]));

    const setup = setupCanvas(canvas, { aspect: 16 / 8 });
    let dim = null;
    let tBot = 0;
    let tTop = 0;

    function render() {
      if (!dim) return;
      const { w, h, ctx } = dim;
      const beta = sl.value;
      const g = gamma(beta);
      ctx.clearRect(0, 0, w, h);

      const rowH = h / 2;
      drawRow(ctx, 0, 0, w, rowH, true, beta, tTop);
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.beginPath(); ctx.moveTo(0, rowH); ctx.lineTo(w, rowH); ctx.stroke();
      drawRow(ctx, 0, rowH, w, rowH, false, beta, tBot);

      rGm.set(g === Infinity ? "∞" : g.toFixed(3));
      rSlow.set("в " + g.toFixed(2) + " раз");
    }

    function drawRow(ctx, x0, y0, sw, sh, moving, beta, t) {
      const bg = ctx.createLinearGradient(0, y0, 0, y0 + sh);
      if (moving) {
        bg.addColorStop(0, "rgba(167,139,250,0.10)");
        bg.addColorStop(1, "rgba(167,139,250,0.02)");
      } else {
        bg.addColorStop(0, "rgba(94,243,192,0.06)");
        bg.addColorStop(1, "rgba(94,243,192,0.02)");
      }
      ctx.fillStyle = bg;
      ctx.fillRect(x0, y0, sw, sh);

      ctx.fillStyle = moving ? "rgba(167,139,250,0.85)" : "rgba(94,243,192,0.85)";
      ctx.font = "600 12px Outfit";
      ctx.textAlign = "left";
      ctx.fillText(moving ? "Движущаяся система · v = " + beta.toFixed(2) + "·c" : "Покоящаяся система · Земля", x0 + 14, y0 + 22);

      const N = 5;
      const padX = 30;
      const cellW = (sw - padX * 2) / N;
      const titles = ["Колебания", "Реакции", "Распады", "Взаимодействия", "Часы"];
      for (let i = 0; i < N; i++) {
        const cx = x0 + padX + cellW * (i + 0.5);
        const cy = y0 + sh / 2 + 6;
        drawProcess(ctx, cx, cy, cellW * 0.78, sh * 0.55, i, t, moving);
        ctx.font = "11px Outfit";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillText(titles[i], cx, y0 + sh - 8);
      }
    }

    function drawProcess(ctx, cx, cy, ww, hh, kind, t, moving) {
      const stroke = moving ? "rgba(167,139,250,0.85)" : "rgba(94,243,192,0.85)";
      const accent = moving ? "rgba(167,139,250,0.4)" : "rgba(94,243,192,0.4)";
      switch (kind) {
        case 0: {
          const arm = Math.min(hh, ww) * 0.42;
          const ang = Math.sin(t * 2.0) * 0.7;
          const px = cx + Math.sin(ang) * arm;
          const py = cy + Math.cos(ang) * arm;
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(cx, cy - arm * 0.6); ctx.lineTo(px, py); ctx.stroke();
          ctx.fillStyle = stroke;
          ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 1: {
          // Реакции: ядро + две частицы на эллиптических орбитах
          const r1 = Math.min(hh, ww) * 0.28;
          const r2 = r1 * 1.4;
          const tilt2 = Math.PI / 5;
          // Орбита 1
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.ellipse(cx, cy, r1, r1 * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
          // Орбита 2 (наклонённая)
          ctx.beginPath(); ctx.ellipse(cx, cy, r2, r2 * 0.4, tilt2, 0, Math.PI * 2); ctx.stroke();
          // Ядро
          ctx.fillStyle = stroke;
          ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
          // Частица 1 — строго по орбите 1
          const a1 = t * 2.4;
          const p1x = cx + Math.cos(a1) * r1;
          const p1y = cy + Math.sin(a1) * r1 * 0.5;
          ctx.fillStyle = "#d4a66a";
          ctx.beginPath(); ctx.arc(p1x, p1y, 3.5, 0, Math.PI * 2); ctx.fill();
          // Частица 2 — строго по орбите 2 (наклонённой)
          const a2 = -t * 1.6 + 1;
          const cosT = Math.cos(tilt2), sinT = Math.sin(tilt2);
          const lx = Math.cos(a2) * r2, ly = Math.sin(a2) * r2 * 0.4;
          const p2x = cx + lx * cosT - ly * sinT;
          const p2y = cy + lx * sinT + ly * cosT;
          ctx.fillStyle = "#7eb8d4";
          ctx.beginPath(); ctx.arc(p2x, p2y, 3.5, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 2: {
          // Распады: частицы вылетают из-под центрального ядра по кругу и гаснут
          const maxR = Math.min(hh, ww) * 0.44;
          const nParts = 6;
          const period = 3.5;
          const coreR = 8;
          // Сначала частицы (под ядром)
          for (let s = 0; s < nParts; s++) {
            const delay = (s / nParts) * period * 0.7;
            const localT = ((t - delay) % period + period) % period;
            if (localT > period * 0.8) continue;
            const progress = localT / (period * 0.8);
            const ang = (s / nParts) * Math.PI * 2 + 0.3;
            const r = coreR + progress * (maxR - coreR);  // стартует от края ядра
            const alpha = Math.max(0, 1 - progress);
            const x = cx + Math.cos(ang) * r;
            const y = cy + Math.sin(ang) * r;
            ctx.fillStyle = "rgba(212,166,106," + alpha.toFixed(2) + ")";
            ctx.beginPath(); ctx.arc(x, y, 2.5 + (1 - progress) * 1.5, 0, Math.PI * 2); ctx.fill();
          }
          // Ядро поверх частиц (пульсирует слегка)
          const pulse = coreR + Math.sin(t * 3) * 1.5;
          ctx.fillStyle = stroke;
          ctx.beginPath(); ctx.arc(cx, cy, pulse, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 3: {
          // Взаимодействия: расходящиеся волны, цвет зависит от системы
          const baseR = Math.min(hh, ww) * 0.45;
          const waveColor = moving ? "167,139,250" : "94,243,192";
          for (let i = 0; i < 3; i++) {
            const ph = (t * 0.7 + i / 3) % 1;
            const r = ph * baseR;
            ctx.strokeStyle = "rgba(" + waveColor + "," + (0.7 * (1 - ph)).toFixed(2) + ")";
            ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
          }
          ctx.fillStyle = stroke;
          ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 4: {
          const r = Math.min(hh, ww) * 0.42;
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = accent;
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
            ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
            ctx.stroke();
          }
          const a = -Math.PI / 2 + (t / 6) * Math.PI * 2;
          ctx.strokeStyle = "#d4a66a";
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6)); ctx.stroke();
          ctx.fillStyle = stroke;
          ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
          break;
        }
      }
    }

    return {
      resize() { dim = setup.resize(); render(); },
      tick(dt) {
        const g = gamma(sl.value);
        tBot += dt;
        tTop += dt / g;
        render();
      },
      reset() { tBot = 0; tTop = 0; },
    };
  }

  // ============================================================
  // GLAVA 7: Pythagoras → γ
  // ============================================================
  function createPythagoras(host) {
    host.appendChild(makeStageHead("Прямоугольный треугольник и фактор Лоренца"));
    const canvas = el("canvas", { "aria-label": "Треугольник и фотоны — вывод фактора Лоренца" });
    host.appendChild(makeCanvasWrap(canvas));

    const sl = makeSlider({
      label: "v / c",
      min: 0.05,
      max: 0.95,
      step: 0.01,
      value: 0.5,
      format: (v) => v.toFixed(2) + "·c",
      onInput: () => {},
    });
    host.appendChild(el("div", { class: "ls-controls ls-controls--row" }, [sl.field]));

    const rT = makeReadout("T (собств.)", "a");
    const rTp = makeReadout("T′ (наблюд.)", "b");
    const rGm = makeReadout("γ = T′ / T", "accent");
    host.appendChild(el("div", { class: "ls-readouts" }, [rT.card, rTp.card, rGm.card]));

    const setup = setupCanvas(canvas, { aspect: 16 / 9 });
    let dim = null;
    let animTime = 0;

    /* ---- Canvas math-rendering helpers ---- */

    // Draw horizontal fraction bar + numerator + denominator, centered at (cx, cy)
    // Returns { w, h } — bounding box
    function drawFraction(ctx, cx, cy, numText, denText, fontSize, color) {
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = fontSize + "px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const numW = ctx.measureText(numText).width;
      const denW = ctx.measureText(denText).width;
      const barW = Math.max(numW, denW) + 10;
      const gap = fontSize * 0.35;
      // numerator
      ctx.fillText(numText, cx, cy - gap - fontSize * 0.35);
      // bar
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - barW / 2, cy);
      ctx.lineTo(cx + barW / 2, cy);
      ctx.stroke();
      // denominator
      ctx.fillText(denText, cx, cy + gap + fontSize * 0.35);
      ctx.restore();
      return { w: barW, h: fontSize * 2 + gap * 2 };
    }

    // Draw √(content) with overbar, returns width
    function drawSqrt(ctx, x, y, content, fontSize, color) {
      ctx.save();
      ctx.fillStyle = color;
      ctx.font = fontSize + "px JetBrains Mono, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const contentW = ctx.measureText(content).width;
      const sqrtW = fontSize * 0.65;
      const totalW = sqrtW + contentW + 4;
      // √ symbol
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + sqrtW * 0.25, y + 2);
      ctx.lineTo(x + sqrtW * 0.5, y - fontSize * 0.6);
      ctx.lineTo(x + sqrtW * 0.8, y - fontSize * 0.6);
      // overbar
      ctx.lineTo(x + sqrtW + contentW + 4, y - fontSize * 0.6);
      ctx.stroke();
      // content text
      ctx.fillText(content, x + sqrtW, y);
      ctx.restore();
      return totalW;
    }

    // Draw a mirror (horizontal bar with hatching)
    function drawMirror(ctx, cx, cy, mw, isTop) {
      const mh = 5;
      ctx.fillStyle = "rgba(140,160,190,0.7)";
      ctx.fillRect(cx - mw / 2, cy - mh / 2, mw, mh);
      ctx.strokeStyle = "rgba(140,160,190,0.5)";
      ctx.lineWidth = 0.8;
      const hatchDir = isTop ? 1 : -1;
      for (let i = 0; i < mw; i += 5) {
        ctx.beginPath();
        ctx.moveTo(cx - mw / 2 + i, cy - mh / 2);
        ctx.lineTo(cx - mw / 2 + i + 4 * hatchDir, cy + mh / 2);
        ctx.stroke();
      }
    }

    // Draw photon dot with glow
    function drawPhoton(ctx, x, y, r, color) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
      glow.addColorStop(0, color);
      glow.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }

    function render(dt) {
      if (!dim) return;
      const { w, h, ctx } = dim;
      const beta = sl.value;
      const g = gamma(beta);

      animTime += (dt || 0.016);

      ctx.clearRect(0, 0, w, h);

      // ---- Layout ----
      // Left 62%: triangle scene (centered). Right 38%: formulas.
      const splitX = w * 0.62;
      const triPadL = 40, triPadR = 20, triPadT = 30, triPadB = 45;
      const drawH = h - triPadT - triPadB;
      const drawW = splitX - triPadL - triPadR;

      // ---- Scale triangle to always fit ----
      // Vertical leg = 1 (normalized), horizontal = beta*gamma, hypotenuse = gamma
      const vLeg = 1;
      const hLeg = beta * g;
      const scaleY = drawH / vLeg;
      const scaleX = drawW / Math.max(hLeg, 0.3);
      const scale = Math.min(scaleX, scaleY);

      const vertPx = vLeg * scale;
      const horzPx = hLeg * scale;

      // Center the triangle in the available area
      const triOffX = triPadL + (drawW - horzPx) / 2;
      const triOffY = triPadT + (drawH - vertPx) / 2;

      // Triangle corners: A = bottom-left (right angle), B = top-left, C = bottom-right
      const ax = triOffX;
      const ay = triOffY + vertPx;
      const bx = triOffX;
      const by = triOffY;
      const cx2 = triOffX + horzPx;
      const cy2 = triOffY + vertPx;

      // Hypotenuse length in pixels
      const hypPx = Math.sqrt((cx2 - bx) * (cx2 - bx) + (cy2 - by) * (cy2 - by));

      // ---- Background ----
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "rgba(8,12,28,1)");
      bg.addColorStop(1, "rgba(4,6,18,1)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // ---- Divider line between triangle and formulas ----
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(splitX - 10, 10);
      ctx.lineTo(splitX - 10, h - 10);
      ctx.stroke();

      // ---- Clip triangle area so it never overflows into formulas ----
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, splitX - 14, h);
      ctx.clip();

      // ---- Right angle mark ----
      const markSize = Math.min(12, vertPx * 0.06);
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ax + markSize, ay);
      ctx.lineTo(ax + markSize, ay - markSize);
      ctx.lineTo(ax, ay - markSize);
      ctx.stroke();

      // ---- Triangle sides ----
      // Vertical leg: c·T (cyan) — photon inside ship
      ctx.strokeStyle = "#7eb8d4";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ax, ay); ctx.stroke();

      // Horizontal leg: v·T' (orange) — ship displacement
      ctx.strokeStyle = "#d4a66a";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(cx2, cy2); ctx.stroke();
      ctx.setLineDash([]);
      // Arrow at end
      const arrSz = 7;
      ctx.fillStyle = "#d4a66a";
      ctx.beginPath();
      ctx.moveTo(cx2, cy2);
      ctx.lineTo(cx2 - arrSz, cy2 - arrSz * 0.5);
      ctx.lineTo(cx2 - arrSz, cy2 + arrSz * 0.5);
      ctx.closePath();
      ctx.fill();

      // Hypotenuse: c·T' (mint) — photon seen by observer
      ctx.strokeStyle = "#7dc4a8";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(cx2, cy2); ctx.stroke();

      // ---- Mirrors ----
      const mirrorW = Math.min(42, horzPx * 0.12 + 20);
      drawMirror(ctx, bx + 2, by - 3, mirrorW, true);
      drawMirror(ctx, ax + 2, ay + 3, mirrorW, false);
      // Second position mirror (ship moved)
      if (horzPx > 40) {
        drawMirror(ctx, cx2 - 2, cy2 + 3, mirrorW, false);
      }

      // ---- Photon animation ----
      // Both photons move at speed c (same px/sec speed)
      // Vertical path = vertPx, diagonal path = hypPx
      // Vertical time = vertPx/c, Diagonal time = hypPx/c = gamma * vertPx/c
      // Cycle = diagonal time. Vertical finishes first.
      const cSpeed = 180; // px/sec (represents c)
      const vertTime = vertPx / cSpeed;
      const diagTime = hypPx / cSpeed;
      const cycleTime = diagTime + 0.3; // small pause after diagonal arrives

      const phase = animTime % cycleTime;

      // Vertical photon (cyan): B → A, then waits
      const vertPhase = clamp(phase / vertTime, 0, 1);
      const vpx = bx;
      const vpy = lerp(by, ay, vertPhase);

      // Diagonal photon (mint): B → C
      const diagPhase = clamp(phase / diagTime, 0, 1);
      const dpx = lerp(bx, cx2, diagPhase);
      const dpy = lerp(by, cy2, diagPhase);

      // Draw photon trails
      if (vertPhase < 1) {
        ctx.strokeStyle = "rgba(77,225,255,0.25)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(vpx, vpy); ctx.stroke();
      }
      if (diagPhase < 1) {
        ctx.strokeStyle = "rgba(94,243,192,0.25)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(dpx, dpy); ctx.stroke();
      }

      // Photon dots
      drawPhoton(ctx, vpx, vpy, 4, vertPhase >= 1 ? "rgba(77,225,255,0.5)" : "rgba(77,225,255,1)");
      drawPhoton(ctx, dpx, dpy, 4, diagPhase >= 1 ? "rgba(94,243,192,0.5)" : "rgba(94,243,192,1)");

      // "Arrived" markers
      if (vertPhase >= 1 && diagPhase < 1) {
        // Vertical arrived, diagonal still going — highlight the time difference
        ctx.fillStyle = "rgba(77,225,255,0.7)";
        ctx.font = "600 10px Outfit";
        ctx.textAlign = "left";
        ctx.fillText("✓ T прошло", ax + 16, ay - 4);
      }

      // ---- Side labels ----
      ctx.font = "600 13px Outfit";

      // Vertical: c·T
      ctx.fillStyle = "#7eb8d4";
      ctx.textAlign = "right";
      ctx.save();
      ctx.translate(bx - 14, (by + ay) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.fillText("c · T", 0, 0);
      ctx.restore();

      // Horizontal: v·T'
      ctx.fillStyle = "#d4a66a";
      if (horzPx > 100) {
        ctx.textAlign = "center";
        ctx.fillText("v · T′", (ax + cx2) / 2, ay + 20);
      } else {
        ctx.textAlign = "left";
        ctx.fillText("v · T′", cx2 + 8, ay + 4);
      }

      // Hypotenuse: c·T'
      ctx.fillStyle = "#7dc4a8";
      const hypMidX = (bx + cx2) / 2;
      const hypMidY = (by + cy2) / 2;
      const hypAngle = Math.atan2(cy2 - by, cx2 - bx);
      ctx.save();
      ctx.translate(hypMidX, hypMidY);
      ctx.rotate(hypAngle);
      ctx.textAlign = "center";
      ctx.fillText("c · T′", 0, -12);
      ctx.restore();

      // ---- Context labels ----
      ctx.font = "11px Outfit";
      ctx.fillStyle = "rgba(77,225,255,0.6)";
      ctx.textAlign = "left";
      ctx.fillText("внутри корабля", bx + mirrorW / 2 + 10, by - 8);

      ctx.fillStyle = "rgba(212,166,106,0.6)";
      ctx.textAlign = "left";
      ctx.fillText("внешний наблюдатель", triPadL, h - 10);

      ctx.restore(); // end triangle clip

      // ==== RIGHT SIDE: Formula derivation ====
      const fx = splitX + 8;
      const fy0 = 28;
      const lineH = 0; // we'll position manually
      const fSize = Math.min(13, w * 0.018);
      const fSizeSm = fSize * 0.92;

      ctx.textBaseline = "middle";

      // Title
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "600 " + (fSize + 1) + "px Outfit";
      ctx.textAlign = "left";
      ctx.fillText("Теорема Пифагора:", fx, fy0);

      // Step 1: (cT')² = (cT)² + (vT')²
      let sy = fy0 + fSize * 2.5;
      ctx.fillStyle = "rgba(233,236,245,0.9)";
      ctx.font = fSize + "px JetBrains Mono, monospace";
      ctx.textAlign = "left";

      // Color-code the equation
      const drawStep1 = (y) => {
        let cx3 = fx;
        ctx.fillStyle = "rgba(233,236,245,0.9)";
        ctx.fillText("(", cx3, y); cx3 += ctx.measureText("(").width;
        ctx.fillStyle = "#7dc4a8";
        ctx.fillText("cT′", cx3, y); cx3 += ctx.measureText("cT′").width;
        ctx.fillStyle = "rgba(233,236,245,0.9)";
        ctx.fillText(")² = (", cx3, y); cx3 += ctx.measureText(")² = (").width;
        ctx.fillStyle = "#7eb8d4";
        ctx.fillText("cT", cx3, y); cx3 += ctx.measureText("cT").width;
        ctx.fillStyle = "rgba(233,236,245,0.9)";
        ctx.fillText(")² + (", cx3, y); cx3 += ctx.measureText(")² + (").width;
        ctx.fillStyle = "#d4a66a";
        ctx.fillText("vT′", cx3, y); cx3 += ctx.measureText("vT′").width;
        ctx.fillStyle = "rgba(233,236,245,0.9)";
        ctx.fillText(")²", cx3, y);
      };
      drawStep1(sy);

      // Step 2: c²T'² − v²T'² = c²T²
      sy += fSize * 2.2;
      ctx.fillStyle = "rgba(233,236,245,0.75)";
      ctx.font = fSize + "px JetBrains Mono, monospace";
      ctx.fillText("c²T′² − v²T′² = c²T²", fx, sy);

      // Step 3: T'²(c² − v²) = c²T²
      sy += fSize * 2.2;
      ctx.fillText("T′²(c² − v²) = c²T²", fx, sy);

      // Step 4: T'² = T² / (1 − v²/c²)  — as a proper fraction
      sy += fSize * 3;
      ctx.fillStyle = "rgba(233,236,245,0.75)";
      ctx.font = fSize + "px JetBrains Mono, monospace";
      ctx.textAlign = "left";
      const s4prefix = "T′² = ";
      ctx.fillText(s4prefix, fx, sy);
      const s4prefW = ctx.measureText(s4prefix).width;
      drawFraction(ctx, fx + s4prefW + 30, sy, "T²", "1 − v²/c²", fSizeSm, "rgba(233,236,245,0.8)");

      // Step 5: T' = T / √(1 − v²/c²)  — fraction with sqrt in denominator
      sy += fSize * 4;
      ctx.fillStyle = "#7dc4a8";
      ctx.font = "600 " + (fSize + 1) + "px JetBrains Mono, monospace";
      ctx.textAlign = "left";
      const s5prefix = "T′ = ";
      ctx.fillText(s5prefix, fx, sy);
      const s5prefW = ctx.measureText(s5prefix).width;

      // Draw fraction with sqrt denominator
      ctx.save();
      const fracCx = fx + s5prefW + 36;
      ctx.fillStyle = "#7dc4a8";
      ctx.font = (fSize + 1) + "px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Numerator
      ctx.fillText("T", fracCx, sy - fSize * 0.85);
      // Fraction bar
      const barContent = "1 − v²/c²";
      const sqrtTotalW = fSize * 0.65 + ctx.measureText(barContent).width + 4;
      const barW5 = Math.max(ctx.measureText("T").width, sqrtTotalW) + 12;
      ctx.strokeStyle = "#7dc4a8";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(fracCx - barW5 / 2, sy);
      ctx.lineTo(fracCx + barW5 / 2, sy);
      ctx.stroke();
      // Denominator with √
      drawSqrt(ctx, fracCx - sqrtTotalW / 2, sy + fSize * 0.9, barContent, fSizeSm, "#7dc4a8");
      ctx.restore();

      // Step 6: T' = γ · T  — boxed result
      sy += fSize * 4.5;
      ctx.fillStyle = "#d4a66a";
      ctx.font = "700 " + (fSize + 3) + "px JetBrains Mono, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const resultText = "T′ = γ · T";
      const resultW = ctx.measureText(resultText).width;
      // Box
      ctx.strokeStyle = "rgba(212,166,106,0.6)";
      ctx.lineWidth = 1.5;
      const boxPad = 10;
      ctx.strokeRect(fx - boxPad, sy - fSize - boxPad / 2, resultW + boxPad * 2, fSize * 2 + boxPad);
      ctx.fillStyle = "rgba(212,166,106,0.06)";
      ctx.fillRect(fx - boxPad, sy - fSize - boxPad / 2, resultW + boxPad * 2, fSize * 2 + boxPad);
      ctx.fillStyle = "#d4a66a";
      ctx.fillText(resultText, fx, sy);

      // Gamma definition below box
      sy += fSize * 2.5 + boxPad;
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = (fSize - 1) + "px JetBrains Mono, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const gDefPrefix = "γ = ";
      ctx.fillText(gDefPrefix, fx, sy);
      const gDefPrefW = ctx.measureText(gDefPrefix).width;

      // Small fraction: 1 / √(1 − v²/c²)
      const gFracCx = fx + gDefPrefW + 28;
      ctx.fillText("1", gFracCx, sy - fSize * 0.6);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1;
      const gBarW = fSize * 0.65 + ctx.measureText("1 − v²/c²").width + 16;
      ctx.beginPath();
      ctx.moveTo(gFracCx - gBarW / 2 + 8, sy);
      ctx.lineTo(gFracCx + gBarW / 2 - 8, sy);
      ctx.stroke();
      drawSqrt(ctx, gFracCx - (fSize * 0.65 + ctx.measureText("1 − v²/c²").width + 4) / 2,
        sy + fSize * 0.7, "1 − v²/c²", fSize - 2, "rgba(255,255,255,0.55)");

      // Computed value
      const gComputedX = gFracCx + gBarW / 2 + 10;
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = (fSize - 1) + "px JetBrains Mono, monospace";
      ctx.fillText("= " + g.toFixed(3), gComputedX, sy);

      // ---- Numeric example at bottom right ----
      const exY = h - 18;
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.font = "11px Outfit";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("При v = " + beta.toFixed(2) + "c:  γ = " + g.toFixed(3) +
        "  →  время замедляется в " + g.toFixed(2) + "× раз", fx, exY);

      // ---- Update readouts ----
      rT.set("1.000");
      rTp.set(g.toFixed(3));
      rGm.set(g.toFixed(3));
    }

    return {
      resize() { dim = setup.resize(); render(0); },
      tick(dt) { render(dt); },
      reset() { /* continuous animation, no state to reset */ },
    };
  }

  // ============================================================
  // GLAVA 8: γ-plot
  // ============================================================
  function createGammaPlot(host) {
    host.appendChild(makeStageHead("Фактор Лоренца γ(v/c)"));
    const canvas = el("canvas", { "aria-label": "График фактора Лоренца с движущейся точкой" });
    host.appendChild(makeCanvasWrap(canvas));

    const sl = makeSlider({
      label: "v / c",
      min: 0,
      max: 0.999,
      step: 0.001,
      value: 0.5,
      format: (v) => v.toFixed(3) + "·c",
      onInput: () => { render(); updateTable(); },
    });
    host.appendChild(el("div", { class: "ls-controls ls-controls--row" }, [sl.field]));

    const tableRows = [
      { beta: 0.5, label: "0.5 c" },
      { beta: 0.866, label: "0.866 c" },
      { beta: 0.9, label: "0.9 c" },
      { beta: 0.99, label: "0.99 c" },
      { beta: 0.999, label: "0.999 c" },
    ];
    const tableEls = [];
    const tableContainer = el("div", { class: "ls-gamma-table" });
    tableRows.forEach((r) => {
      const beta = el("span", { class: "ls-gamma-table__beta" }, [r.label]);
      const gm = el("span", { class: "ls-gamma-table__gamma" }, ["γ = 1.000"]);
      const cell = el("div", { class: "ls-gamma-table__cell" }, [beta, gm]);
      tableContainer.appendChild(cell);
      tableEls.push({ cell, gamma: gm });
    });
    host.appendChild(tableContainer);

    function updateTable() {
      const cur = sl.value;
      tableRows.forEach((r, i) => {
        const g = gamma(r.beta);
        tableEls[i].gamma.textContent = "γ = " + g.toFixed(3);
        const isClose = Math.abs(cur - r.beta) < 0.005;
        tableEls[i].cell.classList.toggle("is-active", isClose);
      });
    }

    const setup = setupCanvas(canvas, { aspect: 16 / 9 });
    let dim = null;

    // Nice tick step (1/2/5 × 10ⁿ)
    function niceStep(span, targetTicks) {
      if (!Number.isFinite(span) || span <= 0) return 1;
      const raw = span / Math.max(1, targetTicks);
      const exp = Math.floor(Math.log10(raw));
      const base = raw / Math.pow(10, exp);
      let mult;
      if (base < 1.5) mult = 1;
      else if (base < 3.5) mult = 2;
      else if (base < 7.5) mult = 5;
      else mult = 10;
      return mult * Math.pow(10, exp);
    }

    function arrowHead(ctx, x, y, dir, size) {
      const s = size || 7;
      ctx.beginPath();
      if (dir === "up") {
        ctx.moveTo(x, y); ctx.lineTo(x - s * 0.55, y + s); ctx.lineTo(x + s * 0.55, y + s);
      } else {
        ctx.moveTo(x, y); ctx.lineTo(x - s, y - s * 0.55); ctx.lineTo(x - s, y + s * 0.55);
      }
      ctx.closePath(); ctx.fill();
    }

    function render() {
      if (!dim) return;
      const { w, h, ctx } = dim;
      const beta = sl.value;
      const g = gamma(beta);
      ctx.clearRect(0, 0, w, h);

      const padL = 60, padR = 36, padT = 30, padB = 50;
      const dw = w - padL - padR;
      const dh = h - padT - padB;

      // --- Adaptive yMax: base at γ(0.95)≈3.2, expands when marker is high
      const baseY = gamma(0.95);
      const markerHead = gamma(Math.min(beta, 0.9995)) * 1.18;
      const yMaxRaw = Math.max(baseY, markerHead);
      const stepY = niceStep(yMaxRaw, 5);
      const yMax = Math.ceil(yMaxRaw / stepY) * stepY;

      // helper: y pixel from gamma value
      const yPx = (gv) => padT + dh - (gv / yMax) * dh;
      const xPx = (b) => padL + b * dw;

      // --- Grid
      ctx.strokeStyle = "rgba(255,255,255,0.045)";
      ctx.lineWidth = 1;
      const xMajor = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
      xMajor.forEach((b) => {
        const x = xPx(b);
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + dh); ctx.stroke();
      });
      for (let yv = 0; yv <= yMax + 1e-9; yv += stepY) {
        const y = yPx(yv);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + dw, y); ctx.stroke();
      }

      // --- Axes with arrows
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padL, padT - 14);
      ctx.lineTo(padL, padT + dh);
      ctx.moveTo(padL, padT + dh);
      ctx.lineTo(padL + dw + 14, padT + dh);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      arrowHead(ctx, padL, padT - 14, "up", 8);
      arrowHead(ctx, padL + dw + 14, padT + dh, "right", 8);

      // --- Axis labels
      ctx.fillStyle = "rgba(233,236,245,0.92)";
      ctx.font = "600 13px Outfit";
      ctx.textAlign = "left";
      ctx.fillText("γ", padL - 8, padT - 18);
      ctx.textAlign = "right";
      ctx.fillText("v / c", padL + dw + 6, padT + dh + 34);

      // --- Y ticks & labels
      ctx.font = "11px JetBrains Mono, ui-monospace, monospace";
      ctx.fillStyle = "rgba(255,255,255,0.62)";
      ctx.textAlign = "right";
      for (let yv = 0; yv <= yMax + 1e-9; yv += stepY) {
        const y = yPx(yv);
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL - 5, y); ctx.lineTo(padL, y); ctx.stroke();
        const label = yv < 10 ? String(Math.round(yv)) : yv.toFixed(0);
        ctx.fillText(label, padL - 9, y + 4);
      }

      // --- X ticks & labels
      ctx.fillStyle = "rgba(255,255,255,0.62)";
      ctx.textAlign = "center";
      xMajor.forEach((b) => {
        const x = xPx(b);
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, padT + dh); ctx.lineTo(x, padT + dh + 5); ctx.stroke();
        ctx.fillText(b.toFixed(1), x, padT + dh + 18);
      });

      // --- Asymptote v = c (dashed red)
      ctx.strokeStyle = "rgba(255,102,128,0.7)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 5]);
      const asymX = xPx(1);
      ctx.beginPath(); ctx.moveTo(asymX, padT); ctx.lineTo(asymX, padT + dh); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,102,128,0.9)";
      ctx.font = "600 11px Outfit";
      ctx.textAlign = "right";
      ctx.fillText("v = c", asymX - 4, padT + 14);

      // --- Curve γ(β) with proper clipping
      ctx.save();
      ctx.beginPath();
      ctx.rect(padL, padT - 2, dw, dh + 4);
      ctx.clip();

      ctx.beginPath();
      ctx.strokeStyle = "#7dc4a8";
      ctx.lineWidth = 2.6;
      const N = 600;
      let first = true;
      for (let i = 0; i <= N; i++) {
        // Non-linear sampling: dense near v=c
        const u = i / N;
        const b = u < 0.85 ? u / 0.85 * 0.95 : 0.95 + (u - 0.85) / 0.15 * 0.0499;
        const gv = gamma(b);
        const px = xPx(b);
        const py = yPx(gv);
        if (first) { ctx.moveTo(px, py); first = false; }
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();

      // --- Reference dots for table values
      [0.5, 0.866, 0.9, 0.99, 0.999].forEach((b) => {
        const gv = gamma(b);
        if (gv > yMax) return;
        const px = xPx(b);
        const py = yPx(gv);
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(px, padT + dh); ctx.lineTo(px, py); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill();
      });

      // --- Active marker dot
      const markerPx = xPx(beta);
      const markerPy = clamp(yPx(g), padT - 2, padT + dh);
      const inView = g <= yMax;
      if (inView) {
        ctx.fillStyle = "#d4a66a";
        ctx.beginPath(); ctx.arc(markerPx, markerPy, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Dashed guide lines from dot to axes
        ctx.strokeStyle = "rgba(212,166,106,0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(markerPx, markerPy); ctx.lineTo(padL, markerPy);
        ctx.moveTo(markerPx, markerPy); ctx.lineTo(markerPx, padT + dh);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // --- Label for current γ
      ctx.fillStyle = "rgba(233,236,245,0.95)";
      ctx.font = "600 12px Outfit";
      if (inView) {
        const labelRight = markerPx > padL + dw * 0.8;
        ctx.textAlign = labelRight ? "right" : "left";
        const tx = labelRight ? markerPx - 10 : markerPx + 10;
        const ty = markerPy > padT + 20 ? markerPy - 10 : markerPy + 18;
        ctx.fillText("γ = " + g.toFixed(3), tx, ty);
      } else {
        // Off-chart: show value at top
        ctx.textAlign = "left";
        ctx.fillText("γ = " + g.toFixed(1) + " ↑", markerPx + 4, padT + 14);
      }

      // --- Legend
      ctx.fillStyle = "#7dc4a8";
      ctx.font = "11px Outfit";
      ctx.textAlign = "left";
      ctx.fillRect(padL + dw - 130, padT + 8, 12, 3);
      ctx.fillText("γ = 1 / √(1 − v²/c²)", padL + dw - 114, padT + 13);
    }

    return {
      resize() { dim = setup.resize(); render(); updateTable(); },
      tick() { /* static */ },
    };
  }

  // ============================================================
  // GLAVA 9: Rocket simulator (constant proper acceleration)
  // Две панели: Земля видит замедление двигателя, пилот — нет
  // ============================================================
  function createRocketSimulator(host) {
    host.appendChild(makeStageHead("Почему нельзя достичь скорости света"));
    const canvas = el("canvas", { "aria-label": "Два наблюдателя: Земля и пилот ракеты" });
    host.appendChild(makeCanvasWrap(canvas));

    const SEC_PER_YEAR = 365.25 * 86400;
    const M_PER_LIGHTYEAR = C * SEC_PER_YEAR;
    const TAU_MAX = 10;

    // ---------- Sliders ----------
    const slA = makeSlider({
      label: "Ускорение a",
      min: 1, max: 50, step: 0.1, value: 9.8,
      format: (v) => v.toFixed(1) + " м/с²  (" + (v / 9.8).toFixed(2) + " g)",
      onInput: () => { renderAll(); },
    });
    host.appendChild(el("div", { class: "ls-controls ls-controls--row" }, [slA.field]));

    // ---------- Transport (standard design) ----------
    const btnPlay = el("button", {
      type: "button",
      class: "icon-btn icon-btn--playpause is-paused",
      title: "Запустить разгон",
      "aria-label": "Запустить разгон",
    }, [
      el("span", { class: "transport__glyph transport__glyph--play", "aria-hidden": "true" }, ["▶"]),
      el("span", { class: "transport__glyph transport__glyph--pause", "aria-hidden": "true" }, ["❚❚"]),
    ]);
    const btnReset = el("button", {
      type: "button",
      class: "icon-btn",
      title: "Сброс",
      "aria-label": "Сброс",
    }, ["↺"]);
    const transportRow = el("div", { class: "transport" }, [btnPlay, btnReset]);

    // Speed selector
    const speedValues = [0.5, 1, 2, 4];
    let rocketTimeScale = 1;
    const segBtns = speedValues.map((sv) => {
      const btn = el("button", {
        type: "button",
        class: "seg-btn" + (sv === 1 ? " is-active" : ""),
        "data-ts": String(sv),
      }, ["×" + sv]);
      btn.addEventListener("click", () => {
        segBtns.forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        rocketTimeScale = sv;
      });
      return btn;
    });
    const speedGroup = el("div", { class: "segmented" }, segBtns);
    const speedField = el("label", { class: "ls-field" }, [
      el("span", { class: "ls-field__top" }, [el("span", { class: "ls-field__label" }, ["Скорость"])]),
      speedGroup,
    ]);

    host.appendChild(el("div", { class: "ls-transport-block" }, [transportRow, speedField]));

    // ---------- Readouts (4) ----------
    const rV      = makeReadout("v / c",       "accent");
    const rGm     = makeReadout("γ",           "b");
    const rTau    = makeReadout("τ (борт)",    "a");
    const rTEarth = makeReadout("t (Земля)",   "violet");
    host.appendChild(el("div", { class: "ls-readouts" }, [
      rV.card, rGm.card, rTau.card, rTEarth.card,
    ]));

    // ---------- Formula ----------
    host.appendChild(el("div", {
      class: "ls-formula ls-formula--mint",
      html:
        "v = c · tanh(aτ/c) &nbsp;⇒&nbsp; tanh &lt; 1 всегда &nbsp;⇒&nbsp; v &lt; c всегда. "
        + "&nbsp; Двигатель в системе Земли замедлён в γ раз — разгон асимптотически стремится к нулю.",
    }));

    // ---------- Charts (2) ----------
    const chart1 = el("canvas", { "aria-label": "v как функция собственного времени" });
    const chart2 = el("canvas", { "aria-label": "γ как функция собственного времени" });
    host.appendChild(el("div", { class: "ls-charts" }, [
      el("div", { class: "ls-chart" }, [el("span", { class: "ls-chart__title" }, ["v(τ) — скорость стремится к c, но не достигает"]), makeCanvasWrap(chart1)]),
      el("div", { class: "ls-chart" }, [el("span", { class: "ls-chart__title" }, ["γ(τ) — замедление времени растёт по cosh"]), makeCanvasWrap(chart2)]),
    ]));

    // ---------- Histogram ----------
    const histRanges = [];
    for (let i = 0; i < 9; i++) histRanges.push([i * 0.1, (i + 1) * 0.1]);
    histRanges.push([0.9, 0.99]);
    histRanges.push([0.99, 0.999]);
    const refDK = (gamma(0.1) - gamma(0)) * C * C;
    const histBars = histRanges.map(([a, b]) => {
      const dk = (gamma(b) - gamma(a)) * C * C;
      const ratio = dk / refDK;
      const isInf = b >= 0.999;
      const cls = isInf
        ? "ls-bar__rect ls-bar__rect--inf"
        : (b >= 0.9 ? "ls-bar__rect ls-bar__rect--hot"
        : (b >= 0.5 ? "ls-bar__rect ls-bar__rect--mid"
        : "ls-bar__rect"));
      const labelText = a.toFixed(2).replace(/\.?0+$/, "") + "→" + b.toFixed(2).replace(/\.?0+$/, "") + "c";
      const valueText = isInf ? "→∞" : (ratio < 1000 ? "×" + ratio.toFixed(1) : ratio.toExponential(1));
      const heightPct = isInf ? 100 : Math.min(100, Math.max(2, Math.log10(ratio + 1) * 30));
      const rect = el("div", { class: cls, style: "height: " + heightPct + "%;" });
      const value = el("div", { class: "ls-bar__value" }, [valueText]);
      const label = el("div", { class: "ls-bar__label" }, [labelText]);
      const bar = el("div", { class: "ls-bar" }, [rect, value, label]);
      return { bar, range: [a, b], ratio };
    });
    const histGrid = el("div", { class: "ls-bars" }, histBars.map((b) => b.bar));
    host.appendChild(el("div", { class: "ls-chart" }, [
      el("span", { class: "ls-chart__title" }, ["Энергия для каждого следующего +0.1 c (отношение к шагу 0→0.1c)"]),
      histGrid,
    ]));

    // ---------- Setup ----------
    const setup  = setupCanvas(canvas, { aspect: 16 / 9 });
    const setupC1 = setupCanvas(chart1, { aspect: 16 / 8 });
    const setupC2 = setupCanvas(chart2, { aspect: 16 / 8 });
    let dim = null, dc1 = null, dc2 = null;

    // ---------- State ----------
    const state = {
      tau: 0,
      playing: false,
      flameI: 0,       // smooth flame intensity (follows beta)
      starsPhase: 0,
    };

    // ---------- Transport ----------
    function syncRocketBtn() {
      btnPlay.classList.toggle("is-playing", state.playing);
      btnPlay.classList.toggle("is-paused", !state.playing);
      btnPlay.title = state.playing ? "Пауза" : "Запустить";
    }
    btnPlay.addEventListener("click", () => {
      if (state.tau >= TAU_MAX - 1e-6) { state.tau = 0; state.flameI = 0; state.starsPhase = 0; }
      state.playing = !state.playing;
      syncRocketBtn();
    });
    btnReset.addEventListener("click", () => {
      state.tau = 0;
      state.playing = false;
      state.flameI = 0;
      state.starsPhase = 0;
      syncRocketBtn();
      renderAll();
    });

    // ---------- Physics ----------
    function physics(tauYears, aMS2) {
      const tauSec = tauYears * SEC_PER_YEAR;
      const eta = (aMS2 * tauSec) / C;
      const v = C * Math.tanh(eta);
      const tEarthSec = (C / aMS2) * Math.sinh(eta);
      const xMeters = (C * C / aMS2) * (Math.cosh(eta) - 1);
      const g = Math.cosh(eta);
      return {
        tauYears, eta, v,
        beta: v / C,
        tEarthSec,
        tEarthYears: tEarthSec / SEC_PER_YEAR,
        xMeters,
        g,
      };
    }

    // ---------- Drawing helpers ----------
    function hexToRgba(hex, a) {
      const r = parseInt(hex.slice(1, 3), 16);
      const gg = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return "rgba(" + r + "," + gg + "," + b + "," + a + ")";
    }

    // --- Star field ---
    function drawStars(ctx, x0, y0, w, h, drift, seed) {
      const sd = seed || 0;
      const N = 100;
      for (let i = 0; i < N; i++) {
        const a = Math.sin((i + 1 + sd) * 12.9898 + 1.7) * 43758.5453;
        const b = Math.sin((i + 1 + sd) * 78.233 + 3.7) * 43758.5453;
        const baseX = x0 + (a - Math.floor(a)) * w;
        const depth = 0.2 + Math.abs(b - Math.floor(b)) * 0.8;
        const sxRaw = baseX - drift * depth;
        const sx = ((sxRaw - x0) % w + w) % w + x0;
        const sy = y0 + Math.abs(b - Math.floor(b)) * h;
        const r = (0.3 + (i % 5) * 0.15) * (0.5 + depth * 0.6);
        const alpha = 0.3 + depth * 0.5;
        ctx.fillStyle = "rgba(255,255,255," + alpha.toFixed(2) + ")";
        ctx.fillRect(sx, sy, r, r);
      }
    }

    // --- Small rocket (~50px), continuous flame ---
    function drawSmallRocket(ctx, cx, cy, facingRight, flameIntensity) {
      ctx.save();
      if (!facingRight) { ctx.translate(cx, cy); ctx.scale(-1, 1); ctx.translate(-cx, -cy); }
      const bw = 36, bh = 16;
      const x = cx - bw * 0.4;
      const y = cy - bh / 2;
      const fi = clamp(flameIntensity, 0, 1);

      // Engine flame FIRST (behind rocket body)
      if (fi > 0.01) {
        const flameLen = 14 + 70 * fi;
        const halfH = 2 + 5 * fi;
        const fg = ctx.createLinearGradient(x - 5, cy, x - 5 - flameLen, cy);
        fg.addColorStop(0, "rgba(212,166,106," + (0.7 + 0.3 * fi).toFixed(2) + ")");
        fg.addColorStop(0.3, "rgba(255,120,60," + (0.5 + 0.3 * fi).toFixed(2) + ")");
        fg.addColorStop(0.65, "rgba(167,139,250," + (0.3 * fi).toFixed(2) + ")");
        fg.addColorStop(1, "rgba(167,139,250,0)");
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.moveTo(x - 3, cy - halfH);
        ctx.lineTo(x - 5 - flameLen, cy);
        ctx.lineTo(x - 3, cy + halfH);
        ctx.closePath();
        ctx.fill();

        // Glow around nozzle
        const glowR = 10 + 14 * fi;
        const glow = ctx.createRadialGradient(x - 5, cy, 0, x - 5, cy, glowR);
        glow.addColorStop(0, "rgba(212,166,106," + (0.2 + 0.15 * fi).toFixed(2) + ")");
        glow.addColorStop(1, "rgba(212,166,106,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(x - 5 - glowR, cy - glowR, glowR * 2, glowR * 2);
      }

      // Nozzle (tail)
      ctx.fillStyle = "rgba(77,225,255,0.5)";
      ctx.beginPath();
      ctx.moveTo(x + 1, y + 2);
      ctx.lineTo(x - 5, y - 2);
      ctx.lineTo(x - 5, y + bh + 2);
      ctx.lineTo(x + 1, y + bh - 2);
      ctx.closePath();
      ctx.fill();

      // Body
      const bodyGrad = ctx.createLinearGradient(x, y, x, y + bh);
      bodyGrad.addColorStop(0, "rgba(28,38,64,0.95)");
      bodyGrad.addColorStop(0.5, "rgba(44,56,88,0.95)");
      bodyGrad.addColorStop(1, "rgba(20,28,48,0.95)");
      ctx.fillStyle = bodyGrad;
      ctx.strokeStyle = "rgba(77,225,255,0.8)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, bw, bh, 4);
      } else { ctx.rect(x, y, bw, bh); }
      ctx.fill(); ctx.stroke();

      // Nose cone
      ctx.fillStyle = "rgba(94,243,192,0.85)";
      ctx.strokeStyle = "rgba(94,243,192,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + bw - 2, y + 2);
      ctx.lineTo(x + bw + 14, cy);
      ctx.lineTo(x + bw - 2, y + bh - 2);
      ctx.closePath();
      ctx.fill(); ctx.stroke();

      // Porthole
      ctx.fillStyle = "rgba(77,225,255,0.15)";
      ctx.strokeStyle = "rgba(77,225,255,0.5)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(cx + 6, cy, 4, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();

      // Fins (small)
      ctx.fillStyle = "rgba(94,243,192,0.7)";
      ctx.beginPath();
      ctx.moveTo(x + 2, y);
      ctx.lineTo(x - 4, y - 6);
      ctx.lineTo(x + 8, y + 1);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + 2, y + bh);
      ctx.lineTo(x - 4, y + bh + 6);
      ctx.lineTo(x + 8, y + bh - 1);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    // --- Earth: large hemisphere at start, shrinks to small full circle ---
    function drawEarthHemisphere(ctx, laneH, beta) {
      // At beta=0: big hemisphere, center at left edge (half visible).
      // As beta grows: Earth shrinks AND slides right so full circle is visible.
      const maxR = laneH * 0.65;
      const minR = 8;
      // Плавный shrink: квадратичный закон — на малых скоростях Земля уменьшается медленно,
      // ускоряясь к высоким. Это делает старт при a=9.8 более натуральным.
      const rawShrink = beta > 0 ? Math.min(1, beta) : 0;
      const shrink = rawShrink * rawShrink;  // quadratic — more gradual at low beta
      const r = maxR - (maxR - minR) * shrink;
      // cx transitions from -r*0.05 (hemisphere, center near edge) to r+6 (full circle visible)
      const cx = lerp(-r * 0.05, r + 6, shrink);
      const cy = laneH * 0.5;

      // Atmosphere glow
      const haloR = r * 1.25;
      const halo = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, haloR);
      halo.addColorStop(0, "rgba(94,243,192,0.2)");
      halo.addColorStop(1, "rgba(94,243,192,0)");
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, Math.PI * 2); ctx.fill();

      // Sphere
      const sphere = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.05, cx, cy, r);
      sphere.addColorStop(0, "rgba(160,215,255,0.95)");
      sphere.addColorStop(0.35, "rgba(80,160,220,0.95)");
      sphere.addColorStop(0.7, "rgba(30,90,160,0.95)");
      sphere.addColorStop(1, "rgba(10,35,75,0.95)");
      ctx.fillStyle = sphere;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

      // Outline (mint)
      ctx.strokeStyle = "rgba(94,243,192,0.5)";
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

      // Continent patches (only when big enough)
      if (r > 18) {
        ctx.fillStyle = "rgba(110,180,140,0.5)";
        const patches = [[0.15, -0.25, 0.35], [0.3, 0.15, 0.28], [0.05, 0.35, 0.22], [0.4, -0.1, 0.18]];
        patches.forEach(([dx, dy, s]) => {
          const px = cx + dx * r;
          const py = cy + dy * r;
          ctx.beginPath();
          ctx.ellipse(px, py, s * r * 0.4, s * r * 0.25, 0.4, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // Label
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = r > 25 ? "11px Outfit" : "9px Outfit";
      ctx.textAlign = "center";
      ctx.fillText("Земля", Math.max(cx, r + 6), cy + r + (r > 25 ? 14 : 9));

      return { cx, cy, r };
    }

    // --- Analog clock (compact) ---
    function drawClock(ctx, cx, cy, r, years, color, label) {
      ctx.strokeStyle = hexToRgba(color, 0.7);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = hexToRgba(color, 0.05);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      // Ticks
      ctx.strokeStyle = hexToRgba(color, 0.35);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3));
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
      }
      // Hand
      const angle = -Math.PI / 2 + (years % 1) * Math.PI * 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * (r - 4), cy + Math.sin(angle) * (r - 4));
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, cy, 1.8, 0, Math.PI * 2); ctx.fill();
      // Label + value
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "10px Outfit";
      ctx.textAlign = "center";
      ctx.fillText(label, cx, cy + r + 11);
      ctx.fillStyle = color;
      ctx.font = "600 10px JetBrains Mono, ui-monospace, monospace";
      const str = years < 1e4 ? years.toFixed(2) + " лет" : years.toExponential(1) + " лет";
      ctx.fillText(str, cx, cy + r + 22);
    }

    // --- Speed gauge (vertical bar) ---
    function drawSpeedGauge(ctx, x0, y0, w, h, betaRaw) {
      const beta = Math.min(betaRaw, 0.999999); // never visually reach 1
      const pad = 12;
      const barW = 20;
      const barX = x0 + (w - barW) / 2;
      const barY = y0 + pad + 28;
      const barH = h - pad * 2 - 60;

      // Title
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "600 10px Outfit";
      ctx.textAlign = "center";
      ctx.fillText("v / c", x0 + w / 2, y0 + pad + 10);

      // Background track
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(barX, barY, barW, barH, 4);
      } else { ctx.rect(barX, barY, barW, barH); }
      ctx.fill(); ctx.stroke();

      // Fill
      const fillH = beta * barH;
      if (fillH > 0.5) {
        const fillY = barY + barH - fillH;
        ctx.save();
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(barX, barY, barW, barH, 4);
        } else { ctx.rect(barX, barY, barW, barH); }
        ctx.clip();

        const grad = ctx.createLinearGradient(0, barY + barH, 0, barY);
        grad.addColorStop(0, "#7eb8d4");
        grad.addColorStop(0.6, "#7dc4a8");
        grad.addColorStop(0.85, "#d4a66a");
        grad.addColorStop(0.97, "#c47080");
        ctx.fillStyle = grad;
        ctx.fillRect(barX, fillY, barW, fillH);
        ctx.restore();
      }

      // Asymptote at top
      ctx.strokeStyle = "rgba(255,102,128,0.7)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(barX - 4, barY);
      ctx.lineTo(barX + barW + 4, barY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,102,128,0.9)";
      ctx.font = "600 9px JetBrains Mono, ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("c", x0 + w / 2, barY - 4);

      // Current value
      ctx.fillStyle = "#fff";
      ctx.font = "600 11px JetBrains Mono, ui-monospace, monospace";
      ctx.textAlign = "center";
      const betaStr = beta < 0.001 ? beta.toFixed(4) : beta.toFixed(6);
      ctx.fillText(betaStr, x0 + w / 2, barY + barH + 16);

      // Scale marks on left
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "8px JetBrains Mono, ui-monospace, monospace";
      ctx.textAlign = "right";
      [0, 0.25, 0.5, 0.75, 1].forEach((p) => {
        const my = barY + barH - p * barH;
        ctx.fillRect(barX - 3, my - 0.5, 3, 1);
        if (p > 0 && p < 1) ctx.fillText(p.toFixed(2), barX - 5, my + 3);
      });
    }

    // ===========================================================
    //                     Главная сцена
    // ===========================================================
    function drawScene() {
      const { w, h, ctx } = dim;
      const ph = physics(state.tau, slA.value);
      ctx.clearRect(0, 0, w, h);

      const gaugeW = 56;
      const laneW = w - gaugeW;
      const laneH = h / 2;
      const divY = laneH;

      // ---- Background ----
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "rgba(8,12,28,1)");
      sky.addColorStop(1, "rgba(2,4,12,1)");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // ---- Divider ----
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, divY); ctx.lineTo(laneW, divY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(laneW, 0); ctx.lineTo(laneW, h);
      ctx.stroke();

      // Flame intensity: continuous, grows with beta
      const fi = state.flameI;

      // ==== TOP LANE: Earth observer ====
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, laneW, laneH);
      ctx.clip();

      // Stars (static — Earth frame)
      drawStars(ctx, 0, 0, laneW, laneH, 0, 0);

      // Lane label
      ctx.fillStyle = "rgba(77,225,255,0.8)";
      ctx.font = "600 11px Outfit";
      ctx.textAlign = "left";
      ctx.fillText("Наблюдатель на Земле", 12, 18);

      // Earth hemisphere (large, shrinks with speed)
      const earth = drawEarthHemisphere(ctx, laneH, ph.beta);

      // Light barrier (right edge) — dashed line labeled "c"
      const barrierX = laneW - 24;
      ctx.strokeStyle = "rgba(255,102,128,0.6)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(barrierX, 8);
      ctx.lineTo(barrierX, laneH - 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,102,128,0.85)";
      ctx.font = "600 10px Outfit";
      ctx.textAlign = "center";
      ctx.fillText("c", barrierX, laneH - 12);

      // Track: from right edge of Earth to barrier
      const trackStartX = Math.max(earth.cx + earth.r + 8, 50);
      const trackEndX = barrierX - 6;
      const trackY = laneH * 0.5;
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(trackStartX, trackY);
      ctx.lineTo(trackEndX, trackY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Rocket position: используем β напрямую для визуальной позиции.
      // β = v/c — реальная доля скорости света. Она плавно стремится к 1,
      // но никогда не достигает, что и создаёт визуальную асимптоту.
      // Множитель 0.97 гарантирует, что ракета не касается барьера c.
      const visualRatio = ph.beta * 0.97;
      const trackLen = trackEndX - trackStartX;
      const rocketX = trackStartX + visualRatio * trackLen;

      // Trail (gradient line from Earth to rocket)
      if (visualRatio > 0.001) {
        const trailStart = trackStartX;
        const tr = ctx.createLinearGradient(trailStart, trackY, rocketX, trackY);
        tr.addColorStop(0, "rgba(167,139,250,0.03)");
        tr.addColorStop(0.8, "rgba(167,139,250,0.35)");
        tr.addColorStop(1, "rgba(212,166,106,0.7)");
        ctx.strokeStyle = tr;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(trailStart, trackY);
        ctx.lineTo(rocketX, trackY);
        ctx.stroke();
      }

      // Rocket (Earth frame — continuous flame, grows with beta)
      drawSmallRocket(ctx, rocketX, trackY, true, fi);

      // Clock (Earth) — top center of lane
      const clockR = Math.min(18, laneH * 0.11);
      const clockEarthX = laneW / 2;
      const clockEarthY = 14 + clockR;
      drawClock(ctx, clockEarthX, clockEarthY, clockR,
        ph.tEarthYears, "#7eb8d4", "t (Земля)");

      // Speed label near rocket (above it, only when not overlapping clock)
      if (rocketX < clockEarthX - 60) {
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = "10px JetBrains Mono, ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText("v = " + ph.beta.toFixed(4) + "c", rocketX, trackY - 22);
      }

      // Annotation at high gamma
      if (ph.g > 2) {
        const annAlpha = Math.min(0.85, (ph.g - 2) * 0.15);
        ctx.fillStyle = "rgba(212,166,106," + annAlpha.toFixed(2) + ")";
        ctx.font = "10px Outfit";
        ctx.textAlign = "left";
        ctx.fillText("⏳ двигатель замедляется в " + ph.g.toFixed(1) + "× раз", 12, laneH - 12);
      }

      ctx.restore();

      // ==== BOTTOM LANE: Pilot ====
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, divY, laneW, laneH);
      ctx.clip();

      // Slight tint
      ctx.fillStyle = "rgba(212,166,106,0.015)";
      ctx.fillRect(0, divY, laneW, laneH);

      // Stars (streaming — pilot sees universe rush past)
      drawStars(ctx, 0, divY, laneW, laneH, state.starsPhase, 200);

      // Lane label
      ctx.fillStyle = "rgba(212,166,106,0.8)";
      ctx.font = "600 11px Outfit";
      ctx.textAlign = "left";
      ctx.fillText("Пилот ракеты", 12, divY + 18);

      // Rocket position (defined first so Earth can reference it)
      const pilotRocketX = laneW * 0.5;
      const pilotRocketY = divY + laneH * 0.5;

      // Earth in pilot frame — same scale as top lane, touching rocket at start.
      // Flies left fast on launch, synced with top-lane via beta.
      const pilotEarthMaxR = laneH * 0.65;
      // Right edge of Earth touching the rocket nozzle (cx - 14 = body left edge)
      const pilotEarthStartCx = pilotRocketX - 14 - pilotEarthMaxR;
      // Fly left — quick departure (Earth drops out of view fast at relativistic speeds)
      // Uses beta² for smoother initial movement, then rapid departure
      const betaSq = ph.beta * ph.beta;
      const pilotEarthCx = pilotEarthStartCx - betaSq * laneW * 3;
      const pilotEarthCy = divY + laneH * 0.5;
      if (pilotEarthCx + pilotEarthMaxR > -30) {
        const peHaloR = pilotEarthMaxR * 1.25;
        const peHalo = ctx.createRadialGradient(pilotEarthCx, pilotEarthCy, pilotEarthMaxR * 0.85, pilotEarthCx, pilotEarthCy, peHaloR);
        peHalo.addColorStop(0, "rgba(94,243,192,0.2)");
        peHalo.addColorStop(1, "rgba(94,243,192,0)");
        ctx.fillStyle = peHalo;
        ctx.beginPath(); ctx.arc(pilotEarthCx, pilotEarthCy, peHaloR, 0, Math.PI * 2); ctx.fill();
        const peSphere = ctx.createRadialGradient(pilotEarthCx - pilotEarthMaxR * 0.25, pilotEarthCy - pilotEarthMaxR * 0.25, pilotEarthMaxR * 0.05, pilotEarthCx, pilotEarthCy, pilotEarthMaxR);
        peSphere.addColorStop(0, "rgba(160,215,255,0.95)");
        peSphere.addColorStop(0.35, "rgba(80,160,220,0.95)");
        peSphere.addColorStop(0.7, "rgba(30,90,160,0.95)");
        peSphere.addColorStop(1, "rgba(10,35,75,0.95)");
        ctx.fillStyle = peSphere;
        ctx.beginPath(); ctx.arc(pilotEarthCx, pilotEarthCy, pilotEarthMaxR, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(94,243,192,0.5)";
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(pilotEarthCx, pilotEarthCy, pilotEarthMaxR, 0, Math.PI * 2); ctx.stroke();
        if (pilotEarthCx + pilotEarthMaxR > 10) {
          ctx.fillStyle = "rgba(110,180,140,0.5)";
          [[0.15,-0.25,0.35],[0.3,0.15,0.28],[0.05,0.35,0.22],[0.4,-0.1,0.18]].forEach(([dx,dy,s]) => {
            ctx.beginPath();
            ctx.ellipse(pilotEarthCx + dx * pilotEarthMaxR, pilotEarthCy + dy * pilotEarthMaxR, s * pilotEarthMaxR * 0.4, s * pilotEarthMaxR * 0.25, 0.4, 0, Math.PI * 2);
            ctx.fill();
          });
        }
      }
      drawSmallRocket(ctx, pilotRocketX, pilotRocketY, true, fi);

      // Clock (proper time) — top center of pilot lane
      const clockPilotX = laneW / 2;
      const clockPilotY = divY + 14 + clockR;
      drawClock(ctx, clockPilotX, clockPilotY, clockR,
        ph.tauYears, "#d4a66a", "τ (борт)");

      // Annotation — always normal
      ctx.fillStyle = "rgba(94,243,192,0.65)";
      ctx.font = "10px Outfit";
      ctx.textAlign = "left";
      ctx.fillText("✓ всё как обычно — постоянное ускорение", 12, divY + laneH - 12);

      // Acceleration readout
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "10px JetBrains Mono, ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.fillText("a = " + slA.value.toFixed(1) + " м/с² = const", laneW - 12, divY + laneH - 12);

      ctx.restore();

      // ==== SPEED GAUGE ====
      drawSpeedGauge(ctx, laneW, 0, gaugeW, h, ph.beta);

      // ==== Top-right main message ====
      ctx.fillStyle = ph.beta > 0.99 ? "rgba(255,102,128,0.95)" : "rgba(255,255,255,0.7)";
      ctx.font = "600 11px Outfit";
      ctx.textAlign = "right";
      const pct = Math.min(ph.beta * 100, 99.9999);
      let pctStr;
      if (pct < 1) pctStr = pct.toFixed(2);
      else if (pct < 99) pctStr = pct.toFixed(2);
      else if (pct < 99.99) pctStr = pct.toFixed(4);
      else pctStr = pct.toFixed(4);
      ctx.fillText("v = " + pctStr + "% от c  —  НИКОГДА 100%", laneW - 12, 18);
    }

    // ===========================================================
    //                     Charts
    // ===========================================================
    function plotXY(d, fn, xMin, xMax, yMin, yMax, color, marker, opts) {
      const o = opts || {};
      const { w, h, ctx } = d;
      ctx.clearRect(0, 0, w, h);
      const padL = 46, padR = 16, padT = 14, padB = 32;
      const dw = w - padL - padR;
      const dh = h - padT - padB;

      // Grid
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = padT + (i / 4) * dh;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + dw, y); ctx.stroke();
      }
      for (let i = 0; i <= 4; i++) {
        const x = padL + (i / 4) * dw;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + dh); ctx.stroke();
      }

      // Curve
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      let started = false;
      const N = 320;
      for (let i = 0; i <= N; i++) {
        const x = xMin + (xMax - xMin) * (i / N);
        const y = fn(x);
        if (!Number.isFinite(y)) continue;
        const px = padL + ((x - xMin) / (xMax - xMin)) * dw;
        const py = padT + dh - clamp((y - yMin) / (yMax - yMin), 0, 1) * dh;
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Asymptote
      if (o.asymptote) {
        ctx.strokeStyle = "rgba(255,102,128,0.7)";
        ctx.lineWidth = 1.4;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(padL, padT); ctx.lineTo(padL + dw, padT);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(255,102,128,0.95)";
        ctx.font = "600 10px Outfit";
        ctx.textAlign = "right";
        ctx.fillText(o.asymptoteLabel || "= " + yMax.toFixed(0), padL + dw - 4, padT + 12);
      }

      // Marker
      if (marker) {
        const mx = padL + ((marker.x - xMin) / (xMax - xMin)) * dw;
        const my = padT + dh - clamp((marker.y - yMin) / (yMax - yMin), 0, 1) * dh;
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(mx, padT + dh); ctx.lineTo(mx, my);
        ctx.moveTo(padL, my); ctx.lineTo(mx, my);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#d4a66a";
        ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      // Axis labels
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "10px JetBrains Mono, ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.fillText(o.yMaxLabel || (yMax === 1 ? "1.0" : yMax.toFixed(0)), padL - 5, padT + 6);
      ctx.fillText(o.yMinLabel || (yMin.toFixed ? yMin.toFixed(0) : "0"), padL - 5, padT + dh + 4);
      ctx.textAlign = "center";
      ctx.fillText(o.xMaxLabel || xMax.toFixed(1), padL + dw, padT + dh + 18);
      ctx.fillText(o.xMinLabel || xMin.toFixed(1), padL, padT + dh + 18);
      if (o.xLabel) {
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = "10px Outfit";
        ctx.fillText(o.xLabel, padL + dw / 2, padT + dh + 28);
      }
    }

    function drawChart1() {
      const a = slA.value;
      plotXY(dc1, (tauY) => {
        const eta = a * tauY * SEC_PER_YEAR / C;
        return Math.tanh(eta);
      }, 0, TAU_MAX, 0, 1, "#7eb8d4",
        { x: state.tau, y: Math.tanh(a * state.tau * SEC_PER_YEAR / C) },
        { asymptote: true, asymptoteLabel: "v → c", xLabel: "τ (борт), лет",
          xMaxLabel: TAU_MAX.toFixed(0) });
    }

    function drawChart2() {
      const a = slA.value;
      const etaMax = a * TAU_MAX * SEC_PER_YEAR / C;
      const gMax = Math.cosh(etaMax);
      plotXY(dc2, (tauY) => {
        const eta = a * tauY * SEC_PER_YEAR / C;
        return Math.cosh(eta);
      }, 0, TAU_MAX, 1, gMax, "#9b8ec2",
        { x: state.tau, y: Math.cosh(a * state.tau * SEC_PER_YEAR / C) },
        { xLabel: "τ (борт), лет",
          yMaxLabel: gMax > 1e4 ? gMax.toExponential(1) : gMax.toFixed(0),
          yMinLabel: "1",
          xMaxLabel: TAU_MAX.toFixed(0) });
    }

    // Histogram highlight
    function updateHistogram(currentBeta) {
      histBars.forEach(({ bar, range }) => {
        const [a, b] = range;
        const isPassed = currentBeta >= b - 1e-9;
        const isCurrent = !isPassed && currentBeta > a;
        bar.classList.toggle("is-passed", isPassed);
        bar.classList.toggle("is-current", isCurrent);
      });
    }

    // ---------- Format helpers ----------
    function fmtYears(y) {
      if (!Number.isFinite(y)) return "∞";
      if (Math.abs(y) >= 1e6) return y.toExponential(2) + " лет";
      if (Math.abs(y) >= 1e4) return y.toFixed(0) + " лет";
      return y.toFixed(2) + " лет";
    }
    function fmtBeta(b) {
      const capped = Math.min(b, 0.99999999);
      return capped.toFixed(8) + "·c";
    }
    function fmtGamma(g) {
      if (!Number.isFinite(g)) return "∞";
      if (g > 1e4) return g.toExponential(2);
      return g.toFixed(3);
    }

    function renderAll() {
      if (!dim || !dc1 || !dc2) return;
      const ph = physics(state.tau, slA.value);

      rV.set(fmtBeta(ph.beta));
      rGm.set(fmtGamma(ph.g));
      rTau.set(fmtYears(ph.tauYears));
      rTEarth.set(fmtYears(ph.tEarthYears));

      drawScene();
      drawChart1();
      drawChart2();
      updateHistogram(ph.beta);
    }

    return {
      resize() {
        dim = setup.resize();
        dc1 = setupC1.resize();
        dc2 = setupC2.resize();
        renderAll();
      },
      tick(dt) {
        const simSpeed = rocketTimeScale;
        if (state.playing) {
          state.tau = Math.min(TAU_MAX, state.tau + dt * 0.12 * simSpeed);
          if (state.tau >= TAU_MAX - 1e-6) {
            state.tau = TAU_MAX;
            state.playing = false;
            syncRocketBtn();
          }
        }

        const ph = physics(state.tau, slA.value);

        // Smooth flame: grows with sqrt(beta) for nice visual ramp-up
        const target = ph.beta > 0 ? 0.15 + 0.85 * Math.sqrt(ph.beta) : 0;
        const k = 1 - Math.exp(-dt * 4);
        state.flameI += (target - state.flameI) * k;

        // Star drift in pilot frame (proportional to beta)
        state.starsPhase += dt * ph.beta * 120 * simSpeed;

        renderAll();
      },
    };
  }

  // ============================================================
  // mountAll
  // ============================================================
  function mountAll() {
    const stages = root.querySelectorAll("[data-ls-stage]");
    stages.forEach((host) => {
      const kind = host.dataset.lsStage;
      let sim = null;
      try {
        if (kind === "kenergy") sim = createKEnergyChart(host);
        else if (kind === "velocity-addition") sim = createVelocityAddition(host);
        else if (kind === "photon-clock") sim = createPhotonClock(host);
        else if (kind === "atom-chain") sim = createAtomChain(host);
        else if (kind === "muons") sim = createMuons(host);
        else if (kind === "all-processes") sim = createAllProcesses(host);
        else if (kind === "pythagoras") sim = createPythagoras(host);
        else if (kind === "gamma-plot") sim = createGammaPlot(host);
        else if (kind === "rocket") sim = createRocketSimulator(host);
      } catch (e) {
        console.error("Failed to mount LS scene:", kind, e);
      }
      if (sim) {
        const rec = registerSim(host, sim);
        // Add transport controls to animated models (not static charts, not rocket which has its own)
        const animatedKinds = ["velocity-addition", "photon-clock", "atom-chain", "muons", "all-processes", "pythagoras"];
        if (animatedKinds.includes(kind)) {
          makeTransport(host, rec, sim.reset || null);
        }
      }
    });
    requestAnimationFrame(() => {
      sims.forEach((rec) => { if (rec.sim.resize) { try { rec.sim.resize(); } catch (e) {} } });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll);
  } else {
    mountAll();
  }
})();

