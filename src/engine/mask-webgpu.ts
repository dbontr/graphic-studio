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
@group(0) @binding(4) var<uniform> params: vec4<f32>;

fn unpack(value: u32) -> vec4<f32> {
  return vec4<f32>(
    f32(value & 255u),
    f32((value >> 8u) & 255u),
    f32((value >> 16u) & 255u),
    f32((value >> 24u) & 255u)
  ) / 255.0;
}

fn pack(value: vec4<f32>) -> u32 {
  let v = vec4<u32>(clamp(round(value * 255.0), vec4<f32>(0.0), vec4<f32>(255.0)));
  return v.r | (v.g << 8u) | (v.b << 16u) | (v.a << 24u);
}

fn channelValue(color: vec4<f32>, channel: u32) -> f32 {
  switch channel {
    case 1u: { return color.a; }
    case 2u: { return color.r; }
    case 3u: { return color.g; }
    case 4u: { return color.b; }
    default: { return dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722)); }
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= maskMeta.width || gid.y >= maskMeta.height) { return; }

  let maskX = min(
    maskMeta.maskWidth - 1u,
    u32((f32(gid.x) + 0.5) / f32(maskMeta.width) * f32(maskMeta.maskWidth))
  );
  let maskY = min(
    maskMeta.maskHeight - 1u,
    u32((f32(gid.y) + 0.5) / f32(maskMeta.height) * f32(maskMeta.maskHeight))
  );

  let baseIndex = gid.y * maskMeta.width + gid.x;
  let maskIndex = maskY * maskMeta.maskWidth + maskX;
  let base = unpack(basePixels[baseIndex]);
  let maskColor = unpack(maskPixels[maskIndex]);

  var amount = channelValue(maskColor, u32(round(params.x)));
  if (params.y > 0.5) { amount = 1.0 - amount; }
  let strength = clamp(params.z, 0.0, 1.0);
  amount = (1.0 - strength) + strength * amount;
  targetPixels[baseIndex] = pack(vec4<f32>(base.rgb, base.a * amount));
}
`;
