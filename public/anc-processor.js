class ANCProcessor extends AudioWorkletProcessor {
  constructor(){super();this.antiNoise=.5;this.delaySamples=0;this.buffer=new Float32Array(4096);this.index=0;this.port.onmessage=e=>{if(e.data?.type!=="config")return;this.antiNoise=Math.max(0,Math.min(.7,Number(e.data.antiNoise)||0));this.delaySamples=Math.max(0,Math.min(4000,Math.round((Number(e.data.delayMs)||0)*sampleRate/1000)));};}
  process(inputs,outputs){const input=inputs[0],output=outputs[0];if(!input?.length||!output?.length)return true;for(let ch=0;ch<output.length;ch++){const src=input[Math.min(ch,input.length-1)],dst=output[ch];for(let i=0;i<dst.length;i++){const x=src?.[i]??0;this.buffer[this.index]=x;const read=(this.index-this.delaySamples+this.buffer.length)%this.buffer.length;dst[i]=-this.buffer[read]*this.antiNoise;this.index=(this.index+1)%this.buffer.length;}}return true;}
}
registerProcessor("anc-processor",ANCProcessor);
