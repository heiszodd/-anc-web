"use client";

import { useEffect, useRef, useState } from "react";

type Status = "idle" | "starting" | "running" | "error";
type Mode = "hardware" | "simulation";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [mode, setMode] = useState<Mode>("hardware");
  const [message, setMessage] = useState("Ready");
  const [mu, setMu] = useState(0.00015);
  const [output, setOutput] = useState(0.55);
  const [level, setLevel] = useState(0);
  const [residual, setResidual] = useState(0);
  const [latency, setLatency] = useState("—");
  const [sampleRate, setSampleRate] = useState("—");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [referenceId, setReferenceId] = useState("");
  const [errorId, setErrorId] = useState("");
  const ctxRef = useRef<AudioContext | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const sourcesRef = useRef<MediaStreamAudioSourceNode[]>([]);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    workletRef.current?.disconnect();
    analyserRef.current?.disconnect();
    outputGainRef.current?.disconnect();
    sourcesRef.current.forEach((s) => s.disconnect());
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    ctxRef.current?.close();
    ctxRef.current = null;
    streamsRef.current = [];
    sourcesRef.current = [];
    workletRef.current = null;
    analyserRef.current = null;
    outputGainRef.current = null;
    setLevel(0);
    setResidual(0);
    setStatus("idle");
    setMessage("Ready");
    setLatency("—");
    setSampleRate("—");
  };

  const loadDevices = async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput"));
    } catch {
      setDevices([]);
    }
  };

  const start = async () => {
    if (status !== "idle" && status !== "error") return;
    setStatus("starting");
    setMessage(mode === "simulation" ? "Starting controlled ANC simulation…" : "Requesting two microphone inputs…");

    try {
      const ctx = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
      await ctx.audioWorklet.addModule("/anc-processor.js");

      const node = new AudioWorkletNode(ctx, "anc-fxlms", {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });

      let sources: MediaStreamAudioSourceNode[] = [];
      let streams: MediaStream[] = [];

      if (mode === "simulation") {
        node.port.postMessage({ type: "mode", mode: "simulation" });
      } else {
        if (!referenceId || !errorId) {
          throw new Error("Select a reference microphone and an error microphone first.");
        }
        if (referenceId === errorId) {
          throw new Error("Reference and error microphones must be different devices.");
        }

        const common = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
        const refStream = await navigator.mediaDevices.getUserMedia({ audio: { ...common, deviceId: { exact: referenceId } } });
        const errStream = await navigator.mediaDevices.getUserMedia({ audio: { ...common, deviceId: { exact: errorId } } });
        streams = [refStream, errStream];

        const ref = ctx.createMediaStreamSource(refStream);
        const err = ctx.createMediaStreamSource(errStream);
        ref.connect(node, 0, 0);
        err.connect(node, 0, 1);
        sources = [ref, err];
        node.port.postMessage({ type: "mode", mode: "hardware" });
      }

      const outputGain = ctx.createGain();
      outputGain.gain.value = mode === "simulation" ? 0.35 : output;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;

      node.connect(outputGain);
      outputGain.connect(analyser);
      analyser.connect(ctx.destination);

      await ctx.resume();
      node.port.postMessage({ type: "config", mu, output: mode === "simulation" ? 0.35 : output });

      ctxRef.current = ctx;
      streamsRef.current = streams;
      sourcesRef.current = sources;
      workletRef.current = node;
      outputGainRef.current = outputGain;
      analyserRef.current = analyser;

      setSampleRate(String(ctx.sampleRate));
      const l = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
      setLatency(l ? (l * 1000).toFixed(1) + " ms" : "browser default");
      setStatus("running");
      setMessage(mode === "simulation" ? "FxLMS simulation running" : "Experimental two-mic FxLMS running");

      node.port.onmessage = (event) => {
        if (event.data?.type === "metrics") {
          setLevel(event.data.referenceLevel ?? 0);
          setResidual(event.data.residualLevel ?? 0);
        }
      };
    } catch (err) {
      console.error(err);
      stop();
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not start ANC");
    }
  };

  useEffect(() => {
    loadDevices();
    return () => stop();
  }, []);

  useEffect(() => {
    if (!workletRef.current) return;
    workletRef.current.port.postMessage({ type: "config", mu, output });
    if (outputGainRef.current && mode === "hardware") outputGainRef.current.gain.value = output;
  }, [mu, output, mode]);

  return (
    <main className="shell">
      <header>
        <div>
          <div className="eyebrow">ACTIVE NOISE CONTROL LAB</div>
          <h1>ANC<span>/</span>WEB</h1>
        </div>
        <div className={"status status-" + status}><i /> {status === "running" ? "LIVE" : status === "starting" ? "STARTING" : status === "error" ? "ERROR" : "IDLE"}</div>
      </header>

      <section className="hero">
        <div className="orb"><div className="orb-core" /><div className="orb-ring" /></div>
        <div>
          <p className="kicker">FxLMS RESEARCH PROTOTYPE</p>
          <h2>Cancel the residual.</h2>
          <p className="sub">Reference mic → adaptive filter → headphones → error mic → feedback to the controller.</p>
        </div>
      </section>

      <section className="panel">
        <div className="mode-tabs">
          <button className={mode === "hardware" ? "selected" : ""} onClick={() => { stop(); setMode("hardware"); }}>Two-mic hardware</button>
          <button className={mode === "simulation" ? "selected" : ""} onClick={() => { stop(); setMode("simulation"); }}>Simulation</button>
        </div>

        {mode === "hardware" ? (
          <div className="device-grid">
            <label><span>REFERENCE MICROPHONE</span><select value={referenceId} onChange={(e) => setReferenceId(e.target.value)}><option value="">Select input…</option>{devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone " + d.deviceId.slice(0, 6)}</option>)}</select></label>
            <label><span>ERROR MICROPHONE</span><select value={errorId} onChange={(e) => setErrorId(e.target.value)}><option value="">Select input…</option>{devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone " + d.deviceId.slice(0, 6)}</option>)}</select></label>
          </div>
        ) : (
          <div className="simulation-note">Simulation uses a known synthetic secondary path and a correlated noise source. It validates the adaptive controller without relying on room acoustics.</div>
        )}

        <div className="meter-head"><span>{mode === "simulation" ? "REFERENCE / RESIDUAL" : "REFERENCE / RESIDUAL"}</span><strong>{Math.round(level)}% / {Math.round(residual)}%</strong></div>
        <div className="dual-meter"><div style={{ width: level + "%" }} /><div style={{ width: residual + "%" }} /></div>

        <div className="controls">
          <label><span>Adaptation <b>{mu.toFixed(5)}</b></span><input type="range" min="0.00001" max="0.001" step="0.00001" value={mu} onChange={(e) => setMu(Number(e.target.value))} /></label>
          <label><span>Output limit <b>{Math.round(output * 100)}%</b></span><input type="range" min="0.05" max="0.8" step="0.01" value={output} onChange={(e) => setOutput(Number(e.target.value))} /></label>
        </div>

        <div className="actions"><button className="primary" onClick={status === "running" ? stop : start}>{status === "running" ? "Stop ANC" : "Start ANC"}</button></div>

        <div className="readouts">
          <div><span>STATE</span><strong>{message}</strong></div>
          <div><span>SAMPLE RATE</span><strong>{sampleRate} Hz</strong></div>
          <div><span>EST. LATENCY</span><strong>{latency}</strong></div>
        </div>
      </section>

      <section className="warning"><strong>Hardware requirements</strong><p>Real acoustic cancellation requires separate reference and error microphones. Use wired headphones, keep output low, and never use this while driving. Bluetooth latency can violate the causality constraint and prevent useful cancellation.</p></section>
      <footer>Processing stays in the browser. No microphone stream is uploaded by this application.</footer>
    </main>
  );
}
