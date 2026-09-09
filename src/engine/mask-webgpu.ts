import type { MaskChannel } from '../model';

export const maskChannelIds: Record<MaskChannel, number> = {
  luminance: 0,
  alpha: 1,
  red: 2,
  green: 3,
  blue: 4,
};

export const MASK_WGSL = `
struct MaskMeta {
  width: u32,
  height: u32,
  maskWidth: u32,
  maskHeight: u32,
};

@group(0) @binding(0) var<storage, read> basePixels: array<u32>;
@group(0) @binding(1) var<storage, read> maskPixels: array<u32>;
@group(0) @binding(2) var<storage, read_write> targetPixels: array<u32>;
@group(0) @binding(3) var<uniform> maskMeta: MaskMeta;
@group(0) @binding(4) var<uniform> params: array<vec4<u32>, 65>;

fn channelByte(value: u32, channel: u32) -> u32 {
  let r = value & 255u;
  let g = (value >> 8u) & 255u;
  let b = (value >> 16u) & 255u;
  let a = (value >> 24u) & 255u;  switch channel {
    case 1u: { return a; }
    case 2u: { return r; }
    case 3u: { return g; }
    case 4u: { return b; }
    default: {
      return (13933u * r + 46871u * g + 4732u * b + 32768u) >> 16u;
    }
  }
}

fn maskLut(byteValue: u32) -> u32 {
  let packed = params[1u + byteValue / 4u];
  switch byteValue % 4u {
    case 0u: { return packed.x; }
    case 1u: { return packed.y; }
    case 2u: { return packed.z; }
    default: { return packed.w; }
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= maskMeta.width || gid.y >= maskMeta.height) { return; }

  let maskX = min(
    maskMeta.maskWidth - 1u,
    ((2u * gid.x + 1u) * maskMeta.maskWidth) / (2u * maskMeta.width)
  );  let maskY = min(
    maskMeta.maskHeight - 1u,
    ((2u * gid.y + 1u) * maskMeta.maskHeight) / (2u * maskMeta.height)
  );

  let baseIndex = gid.y * maskMeta.width + gid.x;
  let maskIndex = maskY * maskMeta.maskWidth + maskX;
  let baseValue = basePixels[baseIndex];
  let sourceByte = channelByte(maskPixels[maskIndex], params[0].x);
  let amountByte = maskLut(sourceByte);
  let baseAlpha = (baseValue >> 24u) & 255u;
  let outputAlpha = (baseAlpha * amountByte + 127u) / 255u;
  targetPixels[baseIndex] = (baseValue & 0x00ffffffu) | (outputAlpha << 24u);
}
`;

export const MASK_FEATHER_HORIZONTAL_WGSL = `
struct MaskMeta {
  width: u32,
  height: u32,
  maskWidth: u32,
  maskHeight: u32,
};

@group(0) @binding(0) var<storage, read> maskPixels: array<u32>;
@group(0) @binding(1) var<storage, read_write> tempMask: array<u32>;
@group(0) @binding(2) var<uniform> maskMeta: MaskMeta;
@group(0) @binding(3) var<uniform> params: array<vec4<u32>, 65>;
fn channelByte(value: u32, channel: u32) -> u32 {
  let r = value & 255u;
  let g = (value >> 8u) & 255u;
  let b = (value >> 16u) & 255u;
  let a = (value >> 24u) & 255u;
  switch channel {
    case 1u: { return a; }
    case 2u: { return r; }
    case 3u: { return g; }
    case 4u: { return b; }
    default: {
      return (13933u * r + 46871u * g + 4732u * b + 32768u) >> 16u;
    }
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= maskMeta.width || gid.y >= maskMeta.height) { return; }
  let radius = params[0].y;
  let diameter = radius * 2u + 1u;
  let maskY = min(
    maskMeta.maskHeight - 1u,
    ((2u * gid.y + 1u) * maskMeta.maskHeight) / (2u * maskMeta.height)
  );
  var sum = 0u;
  for (var tap = 0u; tap < diameter; tap = tap + 1u) {
    let offset = i32(tap) - i32(radius);
    let sampleX = u32(clamp(i32(gid.x) + offset, 0, i32(maskMeta.width) - 1));    let maskX = min(
      maskMeta.maskWidth - 1u,
      ((2u * sampleX + 1u) * maskMeta.maskWidth) / (2u * maskMeta.width)
    );
    let maskIndex = maskY * maskMeta.maskWidth + maskX;
    sum = sum + channelByte(maskPixels[maskIndex], params[0].x);
  }
  tempMask[gid.y * maskMeta.width + gid.x] = (sum + radius) / diameter;
}
`;

export const MASK_FEATHER_COMPOSITE_WGSL = `
struct MaskMeta {
  width: u32,
  height: u32,
  maskWidth: u32,
  maskHeight: u32,
};

@group(0) @binding(0) var<storage, read> basePixels: array<u32>;
@group(0) @binding(1) var<storage, read> tempMask: array<u32>;
@group(0) @binding(2) var<storage, read_write> targetPixels: array<u32>;
@group(0) @binding(3) var<uniform> maskMeta: MaskMeta;
@group(0) @binding(4) var<uniform> params: array<vec4<u32>, 65>;

fn maskLut(byteValue: u32) -> u32 {
  let packed = params[1u + byteValue / 4u];
  switch byteValue % 4u {
    case 0u: { return packed.x; }    case 1u: { return packed.y; }
    case 2u: { return packed.z; }
    default: { return packed.w; }
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= maskMeta.width || gid.y >= maskMeta.height) { return; }
  let radius = params[0].y;
  let diameter = radius * 2u + 1u;
  var sum = 0u;
  for (var tap = 0u; tap < diameter; tap = tap + 1u) {
    let offset = i32(tap) - i32(radius);
    let sampleY = u32(clamp(i32(gid.y) + offset, 0, i32(maskMeta.height) - 1));
    sum = sum + tempMask[sampleY * maskMeta.width + gid.x];
  }
  let sourceByte = (sum + radius) / diameter;
  let amountByte = maskLut(sourceByte);
  let index = gid.y * maskMeta.width + gid.x;
  let baseValue = basePixels[index];
  let baseAlpha = (baseValue >> 24u) & 255u;
  let outputAlpha = (baseAlpha * amountByte + 127u) / 255u;
  targetPixels[index] = (baseValue & 0x00ffffffu) | (outputAlpha << 24u);
}
`;
