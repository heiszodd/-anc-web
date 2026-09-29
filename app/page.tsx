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
  const [microphoneId, setMicrophoneId] = useState("");
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

  const requestMicrophone = async () => {
    try {
      setMessage("Requesting microphone permission…");
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      permissionStream.getTracks().forEach((track) => track.stop());
      const list = await navigator.mediaDevices.enumerateDevices();
      const inputs = list.filter((d) => d.kind === "audioinput");
      setDevices(inputs);
      if (!microphoneId && inputs[0]?.deviceId) setMicrophoneId(inputs[0].deviceId);
      setMessage("Microphone permission granted");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Microphone permission was denied");
      setStatus("error");
    }
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
    setMessage(mode === "simulation" ? "Starting controlled ANC simulation…" : "Requesting microphone input…");

    try {
      const ctx = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
      await ctx.audioWorklet.addModule("/anc-processor.js");

      const node = new AudioWorkletNode(ctx, "anc-fxlms", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });

      let sources: MediaStreamAudioSourceNode[] = [];
      let streams: MediaStream[] = [];
      const outputGain = ctx.createGain();

      if (mode === "simulation") {
        node.port.postMessage({ type: "mode", mode: "simulation" });
        node.connect(outputGain);
        outputGain.gain.value = 0.35;
      } else {
        if (!microphoneId) {
          throw new Error("Select a microphone first.");
        }

        const common = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: { ...common, deviceId: { exact: microphoneId } } });
        streams = [micStream];

        const mic = ctx.createMediaStreamSource(micStream);
        sources = [mic];

        // Hardware mode deliberately bypasses the adaptive worklet. With one
        // microphone there is no independent error signal, so direct inversion
        // is the only honest single-mic hardware path and also gives us a
        // deterministic way to verify that microphone audio reaches output.
        outputGain.gain.value = -Math.min(0.8, output);
        mic.connect(outputGain);
      }

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;

      outputGain.connect(analyser);
      analyser.connect(ctx.destination);

      await ctx.resume();
      if (mode === "simulation") node.port.postMessage({ type: "config", mu, output: 0.35 });

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
      setMessage(mode === "simulation" ? "FxLMS simulation running" : "Experimental single-mic anti-noise running");

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
    navigator.mediaDevices?.addEventListener("devicechange", loadDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", loadDevices);
      stop();
    };
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
          <p className="sub">Microphone → anti-noise processor → headphones.</p>
        </div>
      </section>

      <section className="panel">
        <div className="mode-tabs">
          <button className={mode === "hardware" ? "selected" : ""} onClick={() => { stop(); setMode("hardware"); }}>One-mic hardware</button>
          <button className={mode === "simulation" ? "selected" : ""} onClick={() => { stop(); setMode("simulation"); }}>Simulation</button>
        </div>

        {mode === "hardware" ? (
          <>
            <div className="permission-row">
              <button className="secondary" onClick={requestMicrophone}>Allow microphone access</button>
              <span>Required to detect and select your device microphone.</span>
            </div>
            <div className="device-grid single">
            <label><span>MICROPHONE</span><select value={microphoneId} onChange={(e) => setMicrophoneId(e.target.value)}><option value="">Select input…</option>{devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone " + d.deviceId.slice(0, 6)}</option>)}</select></label>
          </div>
          </>
        ) : (
          <div className="simulation-note">Simulation uses a known synthetic secondary path and a correlated noise source. It validates the adaptive controller without relying on room acoustics.</div>
        )}

        <div className="meter-head"><span>{mode === "simulation" ? "MIC / RESIDUAL" : "REFERENCE / RESIDUAL"}</span><strong>{Math.round(level)}% / {Math.round(residual)}%</strong></div>
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

      <section className="warning"><strong>Hardware mode</strong><p>The microphone signal is inverted and sent directly to the headphones. This is a single-mic phase-inversion experiment, not closed-loop ANC. Use wired headphones, keep output low, and never use this while driving.</p></section>
      <footer>Processing stays in the browser. No microphone stream is uploaded by this application.</footer>
    </main>
  );
}
