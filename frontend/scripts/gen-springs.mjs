// Solves damped springs (damping / stiffness / mass, Remotion-style, per the
// claude-motion `motion-design` skill) into CSS `linear()` easing curves.
// Output is pasted into src/app/globals.css. Re-run after changing presets:
//   node scripts/gen-springs.mjs
const PRESETS = {
  settle: [14, 140, 0.8],   // default settle: general UI entering
  knob: [12, 190, 0.75],    // control snapping to a step
  pop: [10, 215, 0.7],      // callouts, badges, success dots
  elastic: [8, 200, 1],     // one hero moment, not more
};

function solve([c, k, m]) {
  const dt = 1 / 1000;
  let x = 0, v = 0, t = 0;
  const samples = [];
  let settledFor = 0;
  while (t < 3) {
    const a = (-k * (x - 1) - c * v) / m;
    v += a * dt;
    x += v * dt;
    t += dt;
    samples.push([t, x]);
    settledFor = Math.abs(x - 1) < 0.002 && Math.abs(v) < 0.02 ? settledFor + dt : 0;
    if (settledFor > 0.05) break;
  }
  const dur = t;
  const n = 40;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const target = (i / n) * dur;
    const s = samples.find(([ts]) => ts >= target) ?? samples[samples.length - 1];
    pts.push(i === n ? 1 : +s[1].toFixed(4));
  }
  pts[0] = 0;
  return { dur: Math.round(dur * 1000), curve: `linear(${pts.join(", ")})`, peak: Math.max(...samples.map((s) => s[1])) };
}

for (const [name, cfg] of Object.entries(PRESETS)) {
  const { dur, curve, peak } = solve(cfg);
  console.log(`  /* ${name}: d/k/m ${cfg.join("/")} -> ${dur}ms, peak ${peak.toFixed(3)} */`);
  console.log(`  --spring-${name}: ${curve};`);
  console.log(`  --spring-${name}-duration: ${dur}ms;`);
}
