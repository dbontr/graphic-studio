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
  );
  let maskY = min(
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
