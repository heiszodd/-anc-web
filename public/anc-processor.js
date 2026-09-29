class FxLMSProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = "hardware";
    this.mu = 0.00015;
    this.output = 0.55;
    this.W = new Float32Array(96);
    this.x = new Float32Array(96);
    this.xf = new Float32Array(96);
    this.sec = new Float32Array([0.02, 0.08, 0.18, 0.28, 0.24, 0.12, 0.05, 0.02, 0.01]);
    this.secX = new Float32Array(this.sec.length);
    this.rng = 1;
    this.phase = 0;
    this.lastReport = 0;

    this.port.onmessage = (event) => {
      const d = event.data || {};
      if (d.type === "mode") this.mode = d.mode === "simulation" ? "simulation" : "hardware";
      if (d.type === "config") {
        this.mu = Math.max(0.000001, Math.min(0.001, Number(d.mu) || 0.00015));
        this.output = Math.max(0.05, Math.min(0.8, Number(d.output) || 0.55));
      }
    };
  }

  rand() {
    this.rng = (1664525 * this.rng + 1013904223) >>> 0;
    return (this.rng / 4294967296) * 2 - 1;
  }

  push(arr, value) {
    arr.copyWithin(1, 0);
    arr[0] = value;
  }

  dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;

    const ref = inputs[0]?.[0];
    const err = inputs[1]?.[0];

    let refPower = 0;
    let errPower = 0;

    for (let n = 0; n < output.length; n++) {
      let xRef;
      let e;

      if (this.mode === "simulation") {
        const tonal = 0.32 * Math.sin(this.phase);
        this.phase += 2 * Math.PI * 180 / sampleRate;
        const noise = 0.28 * this.rand() + tonal;
        xRef = noise;
        e = noise;
      } else {
        xRef = ref?.[n] ?? 0;
        // Single-mic mode has no independent error sensor. Use the microphone
        // level for monitoring only; do not adapt against the same signal.
        e = xRef;
      }

      this.push(this.x, xRef);

      const y = this.mode === "simulation" ? this.dot(this.W, this.x) : -xRef;
      const limited = Math.max(-1, Math.min(1, y * this.output));
      output[n] = limited;

      if (this.mode === "simulation") {
        const secondary = 0.72 * limited + 0.18 * (this.x[1] || 0) + 0.06 * (this.x[2] || 0);
        e = e + secondary;
      }

      this.push(this.secX, xRef);
      for (let k = 0; k < this.xf.length; k++) {
        let v = 0;
        for (let j = 0; j < this.sec.length; j++) {
          const idx = k + j;
          if (idx < this.x.length) v += this.sec[j] * this.x[idx];
        }
        this.xf[k] = v;
      }

      if (this.mode === "simulation") {
        const norm = 0.000001 + this.dot(this.xf, this.xf);
        const step = this.mu / norm;
        for (let k = 0; k < this.W.length; k++) this.W[k] -= step * e * this.xf[k];
      }

      refPower += xRef * xRef;
      errPower += e * e;
    }

    if (currentTime - this.lastReport > 0.1) {
      const refRms = Math.sqrt(refPower / output.length);
      const errRms = Math.sqrt(errPower / output.length);
      this.port.postMessage({
        type: "metrics",
        referenceLevel: Math.min(100, refRms * 180),
        residualLevel: Math.min(100, errRms * 180),
      });
      this.lastReport = currentTime;
    }

    return true;
  }
}

registerProcessor("anc-fxlms", FxLMSProcessor);
