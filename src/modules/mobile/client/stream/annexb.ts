// 跳过三/四字节起始码与 NAL 头后，才是 profile/constraint/level。
export function codecStringFromSps(nal) {
  let offset = 0;
  if (nal[2] === 1) offset = 3;
  else if (nal[2] === 0 && nal[3] === 1) offset = 4;
  const profile = offset + 1;
  if (profile + 3 > nal.length) return "avc1.42E01F";
  const hex = (value) => value.toString(16).padStart(2, "0");
  return `avc1.${hex(nal[profile])}${hex(nal[profile + 1])}${hex(nal[profile + 2])}`;
}
// 保留起始码与末尾未收完的 NAL，供下一次读取继续拼接。
export function splitAnnexB(carry, chunk) {
  const buffer = new Uint8Array(carry.length + chunk.length);
  buffer.set(carry, 0);
  buffer.set(chunk, carry.length);
  const starts = [];
  for (let i = 0; i + 3 <= buffer.length; i++) {
    if (buffer[i] === 0 && buffer[i + 1] === 0) {
      if (buffer[i + 2] === 1) {
        starts.push(i);
        i += 2;
      } else if (buffer[i + 2] === 0 && i + 4 <= buffer.length && buffer[i + 3] === 1) {
        starts.push(i);
        i += 3;
      }
    }
  }
  if (starts.length === 0) {
    const keep = Math.min(buffer.length, 3);
    return { units: [], rest: buffer.subarray(buffer.length - keep) };
  }
  const units = [];
  for (let i = 0; i < starts.length - 1; i++) {
    units.push(buffer.subarray(starts[i], starts[i + 1]));
  }
  const rest = buffer.subarray(starts[starts.length - 1]);
  return { units, rest };
}
export function nalType(unit) {
  let offset = 0;
  if (unit[2] === 1) offset = 3;
  else if (unit[2] === 0 && unit[3] === 1) offset = 4;
  return offset < unit.length ? unit[offset] & 31 : 0;
}
export function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
