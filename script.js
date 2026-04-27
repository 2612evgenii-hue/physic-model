/**
 * Galilean 1D relativity lab — physics + render + UI
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
    frame: "road", // 'road' | 'a' | 'b'
    playing: false,
    timeScale: 1,
    traces: true,
    relativeDelta: true,
    tooltips: false,
    lastTs: 0,
    // Visual transition when frame changes (lerp screen positions)
    transition: { active: false, start: 0, duration: 520, from: { a: 0, b: 0 }, to: { a: 0, b: 0 } },
    /** Max simulation time reached in this run (for pause / scrub review) */
    tRecorded: 0,
    /** While user drags the time slider, tick() must not overwrite the value */
    scrubDragging: false,
    /** Logical (CSS) canvas size — drawing uses these after DPR transform */
    canvasCss: { w: 1200, h: 520 },
  };

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
    road: "Координаты совпадают с лабораторной дорогой",
    a: "Начало в кузове A, она покоится, остальные движутся относительно неё",
    b: "Начало в кузове B, она покоится, остальные движутся относительно неё",
  };

  // --- DOM ---
  const canvas = document.getElementById("sim-canvas");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("canvas-overlay");

  /** Road-frame kinematics */
  function posRoad(t) {
    return {
      xa: state.x0a + state.va * t,
      xb: state.x0b + state.vb * t,
    };
  }

  /**
   * Transform to current frame (Galilean).
   * Returns positions and velocities in the selected frame.
   */
  function kinematicsInFrame(frame, t) {
    const { xa, xb } = posRoad(t);
    const va = state.va;
    const vb = state.vb;
    let xpa, xpb, vpa, vpb;
    if (frame === "road") {
      xpa = xa;
      xpb = xb;
      vpa = va;
      vpb = vb;
    } else if (frame === "a") {
      xpa = 0;
      xpb = xb - xa;
      vpa = 0;
      vpb = vb - va;
    } else {
      xpa = xa - xb;
      xpb = 0;
      vpa = va - vb;
      vpb = 0;
    }
    return { xa: xpa, xb: xpb, va: vpa, vb: vpb, xaRoad: xa, xbRoad: xb, vaRoad: va, vbRoad: vb };
  }

  function relativeVelocityAB() {
    return state.va - state.vb;
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

  function startFrameTransition(oldFrame) {
    const w = state.canvasCss.w;
    const before = projectCarsToScreen(oldFrame, state.t, w);
    const after = projectCarsToScreen(state.frame, state.t, w);
    state.transition = {
      active: true,
      start: performance.now(),
      duration: 520,
      from: { a: before.xa, b: before.xb },
      to: { a: after.xa, b: after.xb },
    };
  }

  // --- Drawing ---
  const COL_A = "#4de1ff";
  const COL_B = "#ffb24a";
  const COL_AXIS = "rgba(255,255,255,0.2)";
  const COL_GRID = "rgba(255,255,255,0.06)";

  function drawScene(ts) {
    const w = state.canvasCss.w;
    const h = state.canvasCss.h;
    ctx.clearRect(0, 0, w, h);

    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
    sky.addColorStop(0, "rgba(77, 225, 255, 0.08)");
    sky.addColorStop(0.5, "transparent");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h * 0.55);

    const roadY = h * 0.58;
    const laneH = h * 0.2;

    // Parallax stripes (motion cue — phase tied to observer frame)
    let phase = 0;
    if (state.frame === "road") phase = state.t * state.va * 0.12;
    else if (state.frame === "a") phase = state.t * (-state.va) * 0.12;
    else phase = state.t * (-state.vb) * 0.12;

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

    // Traces — analytic segment τ∈[0,t] in current frame (uniform motion → straight path in x′)
    if (state.traces && state.t > 1e-7) {
      const frame = state.frame;
      ctx.lineWidth = 2;
      [["a", COL_A], ["b", COL_B]].forEach(([key, col], idx) => {
        const k0 = kinematicsInFrame(frame, 0);
        const k1 = kinematicsInFrame(frame, state.t);
        const x0 = key === "a" ? k0.xa : k0.xb;
        const x1 = key === "a" ? k1.xa : k1.xb;
        const sx0 = xToCanvas(x0, b, drawableW, padL);
        const sx1 = xToCanvas(x1, b, drawableW, padL);
        const sy = axisY - 8 - idx * 3;
        ctx.beginPath();
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.35;
        ctx.moveTo(sx0, sy);
        ctx.lineTo(sx1, sy);
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
    if (state.transition.active) {
      const p = Math.min(1, (ts - state.transition.start) / state.transition.duration);
      const e = 1 - Math.pow(1 - p, 3);
      sxA = state.transition.from.a + (state.transition.to.a - state.transition.from.a) * e;
      sxB = state.transition.from.b + (state.transition.to.b - state.transition.from.b) * e;
      if (p >= 1) state.transition.active = false;
    }

    function drawCar(sx, color, label) {
      ctx.save();
      ctx.translate(sx, carY);
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
      ctx.moveTo(sx, carY + carH);
      ctx.lineTo(sx, axisY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    drawCar(sxA, COL_A, "A");
    drawCar(sxB, COL_B, "B");

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
      const byNearCar = carY - 62 - bh;
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
   * Plot time samples — analytical plotting (no sampled history buffer).
   * Motion is piecewise uniform: between slider changes, x(t)=x0+v*t is linear in t,
   * as are all Galilean transforms and Δx. Two points (t=0 and t=now) give an exact segment.
   */
  function analyticPlotTimes() {
    const t = state.t;
    if (t <= 0) {
      return [{ t: 0 }];
    }
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

    // Series — exact segments (analytic); markers at t=0 and current t
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

      points.forEach((p, idx) => {
        const y = s.yFn(p.t);
        if (!isFinite(y)) return;
        const px = tx(p.t);
        const py = ty(y);
        const r = idx === 0 && points.length > 1 ? 2.6 : 3.8;
        if (idx === 0 && points.length > 1) {
          c.fillStyle = "rgba(255,255,255,0.2)";
          c.strokeStyle = "rgba(255,255,255,0.45)";
        } else {
          c.fillStyle = s.color;
          c.strokeStyle = "rgba(255,255,255,0.4)";
        }
        c.lineWidth = 1;
        c.beginPath();
        c.arc(px, py, r, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      });
    });
  }

  function drawAllStudyCharts() {
    const pts = analyticPlotTimes();
    const frame = state.frame;

    document.querySelectorAll(".study-canvas").forEach((cv) => {
      const kind = cv.dataset.chart;
      const cssW = parseFloat(cv.dataset.cssW) || 400;
      const cssH = parseFloat(cv.dataset.cssH) || 200;
      const c = cv.getContext("2d");

      if (kind === "road-xt") {
        drawCartesianChart(c, cssW, cssH, {
          points: pts,
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
          points: pts,
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
      } else if (kind === "road-vt") {
        drawCartesianChart(c, cssW, cssH, {
          points: pts,
          xLabel: "t, с",
          yLabel: "v, м/с",
          showYZero: true,
          cursorT: state.t,
          series: [
            {
              color: COL_A,
              legend: "v_A",
              yFn: () => state.va,
            },
            {
              color: COL_B,
              legend: "v_B",
              yFn: () => state.vb,
            },
          ],
        });
      } else if (kind === "delta-xt") {
        drawCartesianChart(c, cssW, cssH, {
          points: pts,
          xLabel: "t, с",
          yLabel: "Δx, м",
          showYZero: true,
          cursorT: state.t,
          series: [
            {
              color: "rgba(167,139,250,0.95)",
              legend: "x_B − x_A",
              yFn: (t) => {
                const r = posRoad(t);
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

  function updateMetrics() {
    const k = kinematicsInFrame(state.frame, state.t);
    const { xaRoad, xbRoad, vaRoad, vbRoad } = k;

    el("disp-t").textContent = state.t.toFixed(2);
    el("disp-timescale").textContent = String(state.timeScale);

    el("m-xa-road").textContent = fmt(xaRoad, "м");
    el("m-xb-road").textContent = fmt(xbRoad, "м");
    el("m-va-road").textContent = fmt(vaRoad, "м/с");
    el("m-vb-road").textContent = fmt(vbRoad, "м/с");

    el("metric-frame-title").textContent = FRAME_TITLES[state.frame];
    el("metric-frame-sub").textContent = FRAME_SUBS[state.frame];
    el("m-xa-frame").textContent = fmt(k.xa, "м");
    el("m-xb-frame").textContent = fmt(k.xb, "м");
    el("m-va-frame").textContent = fmt(k.va, "м/с");
    el("m-vb-frame").textContent = fmt(k.vb, "м/с");

    const vrel = relativeVelocityAB();
    el("m-vrel-card").textContent = fmt(vrel, "м/с");
    el("m-dx").textContent = fmt(xbRoad - xaRoad, "м");
    el("disp-vrel").textContent = fmt(vrel, "м/с");

    const fill = el("vrel-fill");
    const vmax = 70;
    const pct = Math.min(1, Math.abs(vrel) / vmax) * 50;
    fill.style.width = pct + "%";
    fill.style.marginLeft = vrel >= 0 ? "50%" : 50 - pct + "%";

    el("frame-lock-label").textContent = FRAME_LABELS[state.frame];

    let note = "";
    if (state.frame === "a") note = "В системе A имеем v′A = 0, дорога «течёт» со скоростью −vA вдоль оси.";
    else if (state.frame === "b") note = "В системе B имеем v′B = 0, картина симметрична системе A.";
    else note = "В лабораторной системе видны обе скорости относительно шоссе.";
    el("m-frame-note").textContent = note;
  }

  function resizeStudyCanvases() {
    document.querySelectorAll(".study-canvas").forEach((cv) => {
      const wrap = cv.closest(".chart-block__canvas-wrap");
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = rect.width;
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
    const wrap = canvas.parentElement;
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = rect.width;
    const cssH = (cssW * 520) / 1200;
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
    drawAllStudyCharts();
    syncScrubUI();
    requestAnimationFrame(tick);
  }

  // --- Events ---
  function setPlaying(v) {
    state.playing = v;
    state.lastTs = 0;
    syncPlaybackButton();
  }

  function bindSlider(id, key, valId, isInt) {
    const input = el(id);
    const disp = el(valId);
    const updateDisp = () => {
      disp.textContent = isInt ? String(Number(input.value)) : Number(input.value).toFixed(1);
    };
    input.addEventListener("input", () => {
      state[key] = Number(input.value);
      updateDisp();
      state.t = 0;
      state.tRecorded = 0;
    });
    updateDisp();
  }

  bindSlider("x0a", "x0a", "val-x0a", false);
  bindSlider("x0b", "x0b", "val-x0b", false);
  bindSlider("va", "va", "val-va", false);
  bindSlider("vb", "vb", "val-vb", false);

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

  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.timeScale = Number(btn.dataset.ts);
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
  }

  document.querySelectorAll(".frame-btn").forEach((btn) => {
    btn.addEventListener("click", () => setFrame(btn.dataset.frame));
  });

  const PRESETS = {
    rest: () => ({ x0a: -15, x0b: 15, va: 0, vb: 0 }),
    chase: () => ({ x0a: -40, x0b: -10, va: 15, vb: 6 }),
    same: () => ({ x0a: -25, x0b: 20, va: 10, vb: 10 }),
    headon: () => ({ x0a: -35, x0b: 35, va: 12, vb: -10 }),
    faster: () => ({ x0a: -30, x0b: 5, va: 18, vb: 6 }),
    negative: () => ({ x0a: 30, x0b: -25, va: -8, vb: 10 }),
  };

  function applyPreset(name) {
    const p = PRESETS[name]();
    state.x0a = p.x0a;
    state.x0b = p.x0b;
    state.va = p.va;
    state.vb = p.vb;
    ["x0a", "x0b", "va", "vb"].forEach((id) => {
      el(id).value = String(state[id]);
      el(id).dispatchEvent(new Event("input"));
    });
    state.t = 0;
    state.tRecorded = 0;
    showToast("Сценарий загружен");
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

  el("btn-scroll-sim").addEventListener("click", () => {
    el("sim-section").scrollIntoView({ behavior: "smooth" });
  });

  function showToast(msg) {
    const t = el("toast-hint");
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
  resizeCanvases();
  requestAnimationFrame(() => resizeCanvases());
  updateMetrics();
  syncPlaybackButton();
  syncScrubUI();

  requestAnimationFrame(tick);

  // --- Hero mini-scene: smooth overtaking (rAF + easing; no CSS keyframe jerks) ---
  (function initHeroCars() {
    const stage = document.querySelector(".hero__stage");
    const carA = document.querySelector(".hero__car-wrap--a");
    const carB = document.querySelector(".hero__car-wrap--b");
    if (!stage || !carA || !carB) return;

    stage.classList.add("hero__stage--cars-js");

    const CAR_W = 64;
    /** Короче цикл — меньше ожидания между «кругами» */
    const CYCLE_A = 17;
    const prefersReduced =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function smoothstep(t) {
      const x = Math.max(0, Math.min(1, t));
      return x * x * (3 - 2 * x);
    }

    function smootherstep(t) {
      const x = Math.max(0, Math.min(1, t));
      return x * x * x * (x * (x * 6 - 15) + 10);
    }

    /** Near lane (closer to «камеру») vs far — bottom % of stage height */
    function bottomPctFromNear(near) {
      return (1 - near) * 0.265 + near * 0.165;
    }

    /** Main travel segment: smooth X + lane change with S-curves */
    function nearLaneAmountMain(t) {
      if (t < 0.26) return 1;
      if (t < 0.41) return 1 - smootherstep((t - 0.26) / (0.41 - 0.26));
      if (t < 0.55) return 0;
      if (t < 0.69) return smootherstep((t - 0.55) / (0.69 - 0.55));
      return 1;
    }

    /** u ∈ [0,1]; короткие fade, один smoothstep по X — без «липкого» въезда/выезда */
    const U_IN = 0.03;
    const U_OUT0 = 0.895;
    const U_OUT1 = 0.922;
    const U_OFF = 0.935;

    function stateCarA(u) {
      if (u >= U_OFF) {
        return { x: -0.11, near: 1, op: 0 };
      }
      if (u < U_IN) {
        const k = u / U_IN;
        return {
          x: -0.13 + 0.075 * smoothstep(k),
          near: 1,
          op: smoothstep(k),
        };
      }
      if (u > U_OUT0) {
        const k = (u - U_OUT0) / (U_OUT1 - U_OUT0);
        const xBefore = -0.055 + 1.14;
        return {
          x: xBefore + (1.24 - xBefore) * smoothstep(k),
          near: 1,
          op: 1 - smoothstep(k),
        };
      }
      const span = U_OUT0 - U_IN;
      const um = span > 1e-6 ? (u - U_IN) / span : 0;
      const x = -0.055 + 1.14 * smoothstep(um);
      const near = nearLaneAmountMain(um);
      return { x, near, op: 1 };
    }

    function zIndices(xa, na, xb) {
      const depthA = 8 + na * 35;
      const depthB = 8 + 35;
      let za = depthA;
      let zb = depthB;
      const overlap = Math.abs(xa - xb) < 0.09;
      if (overlap) {
        if (xa > xb) za += 12;
        else zb += 12;
      } else {
        if (xa > xb) za += 6;
        else zb += 6;
      }
      return [za, zb];
    }

    function placeCar(el, xNorm, near, opacity, z, w, h) {
      const bottomPct = bottomPctFromNear(near);
      const leftPx = xNorm * w - CAR_W / 2;
      el.style.opacity = String(opacity);
      el.style.zIndex = String(z);
      el.style.left = `${leftPx}px`;
      el.style.bottom = `${bottomPct * h}px`;
    }

    function frameHero(nowMs) {
      if (prefersReduced) {
        const w = stage.clientWidth;
        const h = stage.clientHeight;
        placeCar(carA, 0.42, 1, 1, 30, w, h);
        placeCar(carB, 0.48, 1, 1, 28, w, h);
        return;
      }

      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (w < 16 || h < 16) {
        requestAnimationFrame(frameHero);
        return;
      }

      const elapsed = nowMs / 1000;
      const u = (elapsed % CYCLE_A) / CYCLE_A;

      const sa = stateCarA(u);
      const xb = 0.398 + 0.072 * Math.sin(elapsed * 0.29);

      const [za, zb] = zIndices(sa.x, sa.near, xb);

      placeCar(carA, sa.x, sa.near, sa.op, za, w, h);
      placeCar(carB, xb, 1, 1, zb, w, h);

      requestAnimationFrame(frameHero);
    }

    frameHero(performance.now());
  })();
})();
