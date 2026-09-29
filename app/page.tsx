"use client";

import { useEffect, useRef, useState } from "react";

type Status = "idle" | "starting" | "running" | "error";

export default function Home() {
  const [status,setStatus]=useState<Status>("idle");
  const [message,setMessage]=useState("Ready");
  const [antiNoise,setAntiNoise]=useState(0.2);
  const [delayMs,setDelayMs]=useState(0);
  const [level,setLevel]=useState(0);
  const [latency,setLatency]=useState("—");
  const [sampleRate,setSampleRate]=useState("—");
  const ctxRef=useRef<AudioContext|null>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const sourceRef=useRef<MediaStreamAudioSourceNode|null>(null);
  const workletRef=useRef<AudioWorkletNode|null>(null);
  const analyserRef=useRef<AnalyserNode|null>(null);
  const rafRef=useRef<number|null>(null);

  const stop=()=>{
    if(rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current=null;
    workletRef.current?.disconnect();
    analyserRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(t=>t.stop());
    ctxRef.current?.close();
    ctxRef.current=null; streamRef.current=null; sourceRef.current=null; workletRef.current=null; analyserRef.current=null;
    setLevel(0); setStatus("idle"); setMessage("Ready"); setLatency("—"); setSampleRate("—");
  };

  const start=async()=>{
    if(status==="running" || status==="starting") return;
    setStatus("starting"); setMessage("Requesting microphone…");
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
      const ctx=new AudioContext({latencyHint:"interactive"});
      await ctx.audioWorklet.addModule("/anc-processor.js");
      const source=ctx.createMediaStreamSource(stream);
      const node=new AudioWorkletNode(ctx,"anc-processor",{numberOfInputs:1,numberOfOutputs:1,channelCount:1,channelCountMode:"explicit",channelInterpretation:"speakers"});
      const analyser=ctx.createAnalyser();
      analyser.fftSize=512;
      analyser.smoothingTimeConstant=0.75;
      source.connect(node); node.connect(analyser); analyser.connect(ctx.destination);
      await ctx.resume();
      node.port.postMessage({type:"config",antiNoise,delayMs});
      ctxRef.current=ctx; streamRef.current=stream; sourceRef.current=source; workletRef.current=node; analyserRef.current=analyser;
      setSampleRate(String(ctx.sampleRate));
      const l=(ctx.baseLatency||0)+(ctx.outputLatency||0);
      setLatency(l ? (l*1000).toFixed(1)+" ms" : "browser default");
      setStatus("running"); setMessage("Anti-noise processing active");
      const data=new Uint8Array(analyser.frequencyBinCount);
      const tick=()=>{
        analyser.getByteTimeDomainData(data);
        let sum=0;
        for(const v of data){const x=(v-128)/128;sum+=x*x;}
        setLevel(Math.min(100,Math.sqrt(sum/data.length)*140));
        rafRef.current=requestAnimationFrame(tick);
      };
      tick();
    } catch(err) {
      console.error(err);
      stop();
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not start microphone");
    }
  };

  useEffect(()=>()=>stop(),[]);
  useEffect(()=>{workletRef.current?.port.postMessage({type:"config",antiNoise,delayMs});},[antiNoise,delayMs]);

  return <main className="shell">
    <header>
      <div><div className="eyebrow">WEB AUDIO EXPERIMENT</div><h1>ANC<span>/</span>WEB</h1></div>
      <div className={"status status-"+status}><i/> {status==="running"?"LIVE":status==="starting"?"STARTING":status==="error"?"ERROR":"IDLE"}</div>
    </header>
    <section className="hero">
      <div className="orb"><div className="orb-core"/><div className="orb-ring"/></div>
      <div><p className="kicker">ANTI-NOISE LAB</p><h2>Listen to the inverse.</h2><p className="sub">Microphone → low-latency DSP → inverse signal → headphones.</p></div>
    </section>
    <section className="panel">
      <div className="meter-head"><span>INPUT LEVEL</span><strong>{Math.round(level)}%</strong></div>
      <div className="meter"><div style={{width:level+"%"}}/></div>
      <div className="controls">
        <label><span>Anti-noise <b>{Math.round(antiNoise*100)}%</b></span><input type="range" min="0" max="0.7" step="0.01" value={antiNoise} onChange={e=>setAntiNoise(Number(e.target.value))}/></label>
        <label><span>Delay compensation <b>{delayMs} ms</b></span><input type="range" min="0" max="40" step="0.5" value={delayMs} onChange={e=>setDelayMs(Number(e.target.value))}/></label>
      </div>
      <div className="actions"><button className="primary" onClick={status==="running"?stop:start}>{status==="running"?"Stop processing":"Start microphone"}</button></div>
      <div className="readouts">
        <div><span>STATE</span><strong>{message}</strong></div>
        <div><span>SAMPLE RATE</span><strong>{sampleRate} Hz</strong></div>
        <div><span>EST. LATENCY</span><strong>{latency}</strong></div>
      </div>
    </section>
    <section className="warning"><strong>Experimental ANC</strong><p>Simple phase inversion is not true active noise cancellation. Real ANC needs calibrated mic/headphone acoustics, very low latency and usually an error microphone. Use wired headphones, keep the level low, and stop if you hear feedback or discomfort.</p></section>
    <footer>Runs locally in your browser. Microphone audio is processed through Web Audio and is not uploaded by this app.</footer>
  </main>;
}
