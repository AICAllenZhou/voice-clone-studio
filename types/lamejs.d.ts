declare module "lamejs" {
  export class Mp3Encoder {
    constructor(channels: number, sampleRate: number, kbps: number);
    encodeBuffer(pcm: Int16Array): Int8Array;
    flush(): Int8Array;
  }
}

// Deep submodule imports used to shim the bare globals (MPEGMode, Lame,
// BitStream) that lamejs@1.2.1's src/js files expect. No @types exist.
declare module "lamejs/src/js/MPEGMode.js" {
  const MPEGMode: any;
  export default MPEGMode;
}
declare module "lamejs/src/js/Lame.js" {
  const Lame: any;
  export default Lame;
}
declare module "lamejs/src/js/BitStream.js" {
  const BitStream: any;
  export default BitStream;
}
