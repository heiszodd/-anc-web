class FxLMSProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "simulation";
    this.mu = 0.00015;
    this.output = 0.35;
    this.W = new Float32Array(64);
    this.x = new Float32Array(64);
    this.xf = new Float32Array(64);
    // Initial secondary-path estimate is only a conservative placeholder. Real
    // deployment needs an offline/online calibrated estimate for this headset.
    this.sec = new Float32Array([0.02, 0.08, 0.18, 0.28, 0.24, 0.12, 0.05, 0.02, 0.01]);
    this.simX = new Float32Array(64);
    this.simY = new Float32Array(9);
    this.rng = 1;
    this.phase = 0;
    this.lastReport = 0;
    this.port.onmessage = ({ data: d }) => {
      if (d?.type === "mode") this.mode = d.mode === "hardware" ? "hardware" : "simulation";
      if (d?.type === "config") {
        this.mu = Math.max(0, Math.min(0.0005, Number(d.mu) || 0));
        this.output = Math.max(0.01, Math.min(0.25, Number(d.output) || 0.01));
      }
    };
  }
  rand() { this.rng = (1664525 * this.rng + 1013904223) >>> 0; return (this.rng / 4294967296) * 2 - 1; }
  push(a, v) { a.copyWithin(1, 0); a[0] = v; }
  dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  process(inputs, outputs) {
    const out = outputs[0]?.[0];
    if (!out) return true;
    const ref = inputs[0]?.[0], err = inputs[1]?.[0];
    let rp = 0, ep = 0;
    for (let n = 0; n < out.length; n++) {
      let x, e, y;
      if (this.mode === "simulation") {
        const tone = 0.32 * Math.sin(this.phase); this.phase += 2 * Math.PI * 180 / sampleRate;
        x = 0.28 * this.rand() + tone; e = x;
      } else { x = ref?.[n] ?? 0; e = err?.[n] ?? 0; }
      this.push(this.x, x);
      y = this.dot(this.W, this.x);
      const limited = Math.max(-0.25, Math.min(0.25, y * this.output));
      out[n] = limited;
      if (this.mode === "simulation") {
        // Synthetic secondary path and correlated ambient source.
        this.push(this.simY, limited);
        let secondary = 0; for (let j = 0; j < this.simY.length; j++) secondary += this.sec[j] * this.simY[j];
        e += secondary;
      }
      // Filter reference through estimated secondary path: x_f = S_hat * x.
      for (let k = this.xf.length - 1; k >= 0; k--) {
        let v = 0; for (let j = 0; j < this.sec.length && k + j < this.x.length; j++) v += this.sec[j] * this.x[k + j];
        this.xf[k] = v;
      }
      const norm = 1e-5 + this.dot(this.xf, this.xf);
      // Normalized FxLMS, conservative bounded step and leakage for stability.
      const step = Math.min(0.0005, this.mu / norm);
      for (let k = 0; k < this.W.length; k++) {
        this.W[k] = Math.max(-2, Math.min(2, this.W[k] * 0.999999 - step * e * this.xf[k]));
      }
      rp += x * x; ep += e * e;
    }
    if (currentTime - this.lastReport > 0.1) {
      this.port.postMessage({ type: "metrics", referenceLevel: Math.min(100, Math.sqrt(rp / out.length) * 180), errorLevel: Math.min(100, Math.sqrt(ep / out.length) * 180) });
      this.lastReport = currentTime;
    }
    return true;
  }
}
registerProcessor("anc-fxlms", FxLMSProcessor);
