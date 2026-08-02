/** Tracks WebAssembly memory identity and recreates the host view generation. */
export class MemoryViewTracker {
  private currentBuffer: ArrayBuffer | undefined;
  private currentByteLength = 0;
  private currentGeneration = 0;
  private recreationCount = 0;

  public sync(memory: WebAssembly.Memory): ArrayBuffer {
    const buffer = memory.buffer;
    if (this.currentBuffer !== buffer || this.currentByteLength !== buffer.byteLength) {
      this.currentBuffer = buffer;
      this.currentByteLength = buffer.byteLength;
      this.currentGeneration += 1;
      this.recreationCount += 1;
    }
    return buffer;
  }

  public get generation(): number {
    return this.currentGeneration;
  }

  public get recreations(): number {
    return this.recreationCount;
  }

  public get byteLength(): number {
    return this.currentByteLength;
  }
}
