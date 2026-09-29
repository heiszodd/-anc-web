"use client";

import { useEffect, useRef, useState } from "react";

type Status = "idle" | "starting" | "running" | "error";
type Mode = "hardware" | "simulation";
export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [mode, setMode] = useState<Mode>("hardware");
  const [message, setMessage] = useState("Ready");
  const [mu, setMu] = useState(0.00005);
  const [output, setOutput] = useState(0.1);
  const [referenceLevel, setReferenceLevel] = useState(0);
  const [errorLevel, setErrorLevel] = useState(0);
  const [latency, setLatency] = useState("—");
  const [sampleRate, setSampleRate] = useState("—");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [referenceId, setReferenceId] = useState("");
  const [errorId, setErrorId] = useState("");
  const ctxRef = useRef<AudioContext | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const sourcesRef = useRef<MediaStreamAudioSourceNode[]>([]);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  const stop = () => {
    nodeRef.current?.disconnect(); gainRef.current?.disconnect(); sourcesRef.current.forEach(s => s.disconnect());
    streamsRef.current.forEach(s => s.getTracks().forEach(t => t.stop()));
    void ctxRef.current?.close(); ctxRef.current = null; streamsRef.current = []; sourcesRef.current = []; nodeRef.current = null; gainRef.current = null;
    setReferenceLevel(0); setErrorLevel(0); setStatus("idle"); setMessage("Ready"); setLatency("—"); setSampleRate("—");
  };
  const loadDevices = async () => {
    try { const list = await navigator.mediaDevices.enumerateDevices(); const inputs = list.filter(d => d.kind === "audioinput"); setDevices(inputs); if (!referenceId && inputs[0]) setReferenceId(inputs[0].deviceId); if (!errorId && inputs[1]) setErrorId(inputs[1].deviceId); }
    catch { setDevices([]); }
  };
  const requestMicrophone = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
      s.getTracks().forEach(t => t.stop()); await loadDevices(); setMessage("Microphone access granted; choose both inputs.");
    } catch (e) { setStatus("error"); setMessage(e instanceof Error ? e.message : "Microphone permission denied"); }
  };
  const start = async () => {
    if (status !== "idle" && status !== "error") return;
    setStatus("starting"); setMessage("Starting audio graph…");
    try {
      const ctx = new AudioContext({ latencyHint: "interactive" }); await ctx.audioWorklet.addModule("/anc-processor.js");
      const node = new AudioWorkletNode(ctx, "anc-fxlms", { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: "explicit" });
      const gain = ctx.createGain(); gain.gain.value = mode === "simulation" ? 0.35 : Math.min(0.25, output);
      node.port.postMessage({ type: "mode", mode }); node.port.postMessage({ type: "config", mu, output: mode === "simulation" ? 0.35 : 1 });
      const streams: MediaStream[] = [], sources: MediaStreamAudioSourceNode[] = [];
      if (mode === "hardware") {
        if (!referenceId || !errorId) throw new Error("Select separate reference and in-ear error microphone inputs.");
        if (referenceId === errorId) throw new Error("Reference and error inputs must be different devices.");
        const constraints = (deviceId: string): MediaStreamConstraints => ({ audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
        const refStream = await navigator.mediaDevices.getUserMedia(constraints(referenceId)); streams.push(refStream);
        const errStream = await navigator.mediaDevices.getUserMedia(constraints(errorId)); streams.push(errStream);
        const refSource = ctx.createMediaStreamSource(refStream), errSource = ctx.createMediaStreamSource(errStream);
        refSource.connect(node, 0, 0); errSource.connect(node, 0, 1); sources.push(refSource, errSource);
      }
      node.connect(gain); gain.connect(ctx.destination); await ctx.resume();
      node.port.onmessage = ev => { if (ev.data?.type === "metrics") { setReferenceLevel(ev.data.referenceLevel ?? 0); setErrorLevel(ev.data.errorLevel ?? 0); } };
      ctxRef.current = ctx; streamsRef.current = streams; sourcesRef.current = sources; nodeRef.current = node; gainRef.current = gain;
      setSampleRate(String(ctx.sampleRate)); const total = (ctx.baseLatency || 0) + (ctx.outputLatency || 0); setLatency(total ? `${(total * 1000).toFixed(1)} ms (browser-reported output)` : "not exposed by browser");
      setStatus("running"); setMessage(mode === "simulation" ? "Controlled synthetic FxLMS simulation running" : "Experimental dual-input FxLMS active; not safety-certified");
    } catch (e) { stop(); setStatus("error"); setMessage(e instanceof Error ? e.message : "Could not start audio"); }
  };
  useEffect(() => { void loadDevices(); navigator.mediaDevices?.addEventListener("devicechange", loadDevices); return () => { navigator.mediaDevices?.removeEventListener("devicechange", loadDevices); stop(); }; }, []);
  useEffect(() => { nodeRef.current?.port.postMessage({ type: "config", mu, output: mode === "simulation" ? 0.35 : 1 }); if (gainRef.current) gainRef.current.gain.value = mode === "simulation" ? 0.35 : Math.min(0.25, output); }, [mu, output, mode]);
  return <main className="shell">
    <header><div><div className="eyebrow">ACTIVE NOISE CONTROL LAB</div><h1>ANC<span>/</span>WEB</h1></div><div className={`status status-${status}`}><i />{status.toUpperCase()}</div></header>
    <section className="hero"><div className="orb"><div className="orb-core" /><div className="orb-ring" /></div><div><p className="kicker">FxLMS RESEARCH PROTOTYPE</p><h2>Cancel the residual.</h2><p className="sub">Dual reference/error microphones → adaptive filter → headphone output.</p></div></section>
    <section className="panel">
      <div className="mode-tabs"><button className={mode === "hardware" ? "selected" : ""} onClick={() => { stop(); setMode("hardware"); }}>Dual-mic hardware</button><button className={mode === "simulation" ? "selected" : ""} onClick={() => { stop(); setMode("simulation"); }}>Simulation</button></div>
      {mode === "hardware" ? <><div className="permission-row"><button className="secondary" onClick={requestMicrophone}>Allow microphone access</button><span>Two independent inputs required. Place reference outside; error sensor at the ear.</span></div><div className="device-grid"><label><span>REFERENCE MIC (AMBIENT)</span><select value={referenceId} onChange={e => setReferenceId(e.target.value)}><option value="">Select input…</option>{devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${d.deviceId.slice(0, 6)}`}</option>)}</select></label><label><span>ERROR MIC (AT EAR)</span><select value={errorId} onChange={e => setErrorId(e.target.value)}><option value="">Select distinct input…</option>{devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${d.deviceId.slice(0, 6)}`}</option>)}</select></label></div><p className="simulation-note">Both streams request echo cancellation, noise suppression, and automatic gain control disabled. Browser and device latency still limit achievable cancellation; select a low-latency wired interface and verify synchronization.</p></> : <div className="simulation-note">Simulation retains a correlated synthetic noise source and a known synthetic secondary path. Its result demonstrates the algorithm only, not real-world headphone cancellation.</div>}
      <div className="meter-head"><span>REFERENCE INPUT / ERROR-MIC RESIDUAL</span><strong>{Math.round(referenceLevel)}% / {Math.round(errorLevel)}%</strong></div><div className="dual-meter"><div style={{ width: `${referenceLevel}%` }} /><div style={{ width: `${errorLevel}%` }} /></div>
      <div className="controls"><label><span>Adaptation rate μ <b>{mu.toFixed(5)}</b></span><input type="range" min="0.000001" max="0.0005" step="0.000001" value={mu} onChange={e => setMu(Number(e.target.value))} /></label><label><span>Output limit <b>{mode === "hardware" ? `${Math.round(Math.min(output, .25) * 100)}% max` : `${Math.round(output * 100)}% UI`}</b></span><input type="range" min="0.01" max="0.25" step="0.01" value={output} onChange={e => setOutput(Number(e.target.value))} /></label></div>
      <div className="actions"><button className="primary" onClick={status === "running" ? stop : start}>{status === "running" ? "Stop ANC" : "Start ANC"}</button></div>
      <div className="readouts"><div><span>STATE</span><strong>{message}</strong></div><div><span>SAMPLE RATE</span><strong>{sampleRate} Hz</strong></div><div><span>OUTPUT LATENCY ESTIMATE</span><strong>{latency}</strong></div></div>
    </section>
    <section className="warning"><strong>Why one-mic phase inversion is not ANC</strong><p>Browser audio, OS, DAC/ADC and buffering commonly add 10–40 ms or more, while sound travels from headphone driver to ear over a distance in under 1 ms. Sending delayed inverted mic audio therefore creates sidetone/echo and comb filtering rather than cancellation. An outside microphone also cannot observe the residual pressure in the ear canal.</p><p>Physical ANC requires feedforward FxLMS: ambient reference mic → adaptive W(z) → headphone speaker; acoustic sound sums at the ear; an in-ear error mic measures residual pressure and updates W using reference filtered by an estimated secondary path Ŝ(z). This browser prototype uses two selectable inputs, bounded/leaky adaptation and a conservative output cap. Its secondary-path estimate is only a placeholder; calibrated hardware, synchronized low-latency I/O and a true in-ear sensor are essential. It is experimental, not guaranteed ANC or hearing protection.</p></section>
    <footer>Processing stays in the browser; microphone audio is not uploaded by this application.</footer>
  </main>;
}
