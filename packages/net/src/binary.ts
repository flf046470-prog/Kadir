/**
 * Minimal growable binary reader/writer.
 *
 * Hand-rolled rather than a schema library: the hot messages have fewer than 20 fields, and
 * owning the layout is what keeps a 16-player VR room inside the bandwidth budget.
 */
export class ByteWriter {
  private view: DataView;
  private bytes: Uint8Array;
  private offset = 0;

  constructor(initialCapacity = 256) {
    this.bytes = new Uint8Array(initialCapacity);
    this.view = new DataView(this.bytes.buffer);
  }

  private ensure(extra: number): void {
    if (this.offset + extra <= this.bytes.length) return;
    let capacity = this.bytes.length * 2;
    while (capacity < this.offset + extra) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.bytes);
    this.bytes = next;
    this.view = new DataView(this.bytes.buffer);
  }

  u8(value: number): void {
    this.ensure(1);
    this.view.setUint8(this.offset, value & 0xff);
    this.offset += 1;
  }

  i8(value: number): void {
    this.ensure(1);
    this.view.setInt8(this.offset, clampInt(value, -128, 127));
    this.offset += 1;
  }

  u16(value: number): void {
    this.ensure(2);
    this.view.setUint16(this.offset, value & 0xffff, true);
    this.offset += 2;
  }

  i16(value: number): void {
    this.ensure(2);
    this.view.setInt16(this.offset, clampInt(value, -32768, 32767), true);
    this.offset += 2;
  }

  u32(value: number): void {
    this.ensure(4);
    this.view.setUint32(this.offset, value >>> 0, true);
    this.offset += 4;
  }

  f32(value: number): void {
    this.ensure(4);
    this.view.setFloat32(this.offset, value, true);
    this.offset += 4;
  }

  bytesWritten(): number {
    return this.offset;
  }

  finish(): Uint8Array {
    return this.bytes.slice(0, this.offset);
  }
}

export class ByteReader {
  private view: DataView;
  private offset = 0;

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get remaining(): number {
    return this.data.byteLength - this.offset;
  }

  u8(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  i8(): number {
    const v = this.view.getInt8(this.offset);
    this.offset += 1;
    return v;
  }

  u16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i16(): number {
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f32(): number {
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  return rounded < min ? min : rounded > max ? max : rounded;
}

export function quantize(value: number, scale: number): number {
  return Math.round(value * scale);
}

export function dequantize(value: number, scale: number): number {
  return value / scale;
}
