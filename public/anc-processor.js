class ANCProcessor extends AudioWorkletProcessor {
  constructor(){super();this.antiNoise=.2;this.delaySamples=0;this.buffers=[];this.index=0;this.resize();this.port.onmessage=e=>{if(e.data?.type==="config"){this.antiNoise=Math.max(0,Math.min(.7,Number(e.data.antiNoise)||0));this.delaySamples=Math.max(0,Math.round((Number(e.data.delayMs)||0)*sampleRate/1000));this.resize();}}}
  resize(){const n=Math.max(128,this.delaySamples+128);this.buffers=[new Float32Array(n),new Float32Array(n)];this.index=0}
  process(inputs,outputs){const input=inputs[0],output=outputs[0];if(!input?.length||!output?.length)return true;for(let ch=0;ch<output.length;ch++){const src=input[Math.min(ch,input.length-1)],dst=output[ch],buf=this.buffers[ch%2];for(let i=0;i<dst.length;i++){const x=src?.[i]||0;buf[this.index]=x;const read=(this.index-this.delaySamples+buf.length)%buf.length;dst[i]=-buf[read]*this.antiNoise;this.index=(this.index+1)%buf.length;}}return true}
}
registerProcessor("anc-processor",ANCProcessor);
