export const MASK_FIELD_COMMON_WGSL = `
struct MaskMeta {
  width: u32,
  height: u32,
  maskWidth: u32,
  maskHeight: u32,
};

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
`;

export const MASK_FIELD_SOURCE_WGSL = `${MASK_FIELD_COMMON_WGSL}
@group(0) @binding(0) var<storage, read> maskPixels: array<u32>;
@group(0) @binding(1) var<storage, read_write> targetField: array<u32>;
@group(0) @binding(2) var<uniform> maskMeta: MaskMeta;
@group(0) @binding(3) var<uniform> params: vec4<u32>;

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
  let sourceIndex = maskY * maskMeta.maskWidth + maskX;
  targetField[gid.y * maskMeta.width + gid.x] = channelByte(maskPixels[sourceIndex], params.x);
}
`;

const FIELD_HEADER = `${MASK_FIELD_COMMON_WGSL}
@group(0) @binding(0) var<storage, read> source: array<u32>;
@group(0) @binding(1) var<storage, read_write> targetField: array<u32>;
@group(0) @binding(2) var<uniform> maskMeta: MaskMeta;
@group(0) @binding(3) var<uniform> params: vec4<u32>;
`;

export const MASK_FIELD_BOX_HORIZONTAL_WGSL = `${FIELD_HEADER}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= maskMeta.width || gid.y >= maskMeta.height) { return; }
  let radius = params.x;
  let diameter = radius * 2u + 1u;
  var sum = 0u;
  for (var tap = -i32(radius); tap <= i32(radius); tap = tap + 1) {
    let x = u32(clamp(i32(gid.x) + tap, 0, i32(maskMeta.width) - 1));
    sum = sum + source[gid.y * maskMeta.width + x];
  }
  targetField[gid.y * maskMeta.width + gid.x] = (sum + radius) / diameter;
}
`;

export const MASK_FIELD_BOX_VERTICAL_WGSL = `${FIELD_HEADER}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= maskMeta.width || gid.y >= maskMeta.height) { return; }
  let radius = params.x;
  let diameter = radius * 2u + 1u;
  var sum = 0u;
  for (var tap = -i32(radius); tap <= i32(radius); tap = tap + 1) {
    let y = u32(clamp(i32(gid.y) + tap, 0, i32(maskMeta.height) - 1));
    sum = sum + source[y * maskMeta.width + gid.x];
  }
  targetField[gid.y * maskMeta.width + gid.x] = (sum + radius) / diameter;
}
`;

export const MASK_FIELD_EXTREME_HORIZONTAL_WGSL = `${FIELD_HEADER}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= maskMeta.width || gid.y >= maskMeta.height) { return; }
  let radius = params.x;
  let takeMax = params.y != 0u;
  var best = select(255u, 0u, takeMax);
  for (var tap = -i32(radius); tap <= i32(radius); tap = tap + 1) {
    let x = u32(clamp(i32(gid.x) + tap, 0, i32(maskMeta.width) - 1));
    let value = source[gid.y * maskMeta.width + x];
    best = select(min(best, value), max(best, value), takeMax);
  }
  targetField[gid.y * maskMeta.width + gid.x] = best;
}
`;
export const MASK_FIELD_EXTREME_VERTICAL_WGSL = `${FIELD_HEADER}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= maskMeta.width || gid.y >= maskMeta.height) { return; }
  let radius = params.x;
  let takeMax = params.y != 0u;
  var best = select(255u, 0u, takeMax);
  for (var tap = -i32(radius); tap <= i32(radius); tap = tap + 1) {
    let y = u32(clamp(i32(gid.y) + tap, 0, i32(maskMeta.height) - 1));
    let value = source[y * maskMeta.width + gid.x];
    best = select(min(best, value), max(best, value), takeMax);
  }
  targetField[gid.y * maskMeta.width + gid.x] = best;
}
`;

export const MASK_FIELD_THRESHOLD_WGSL = `${FIELD_HEADER}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= maskMeta.width || gid.y >= maskMeta.height) { return; }
  let index = gid.y * maskMeta.width + gid.x;
  targetField[index] = select(0u, 255u, source[index] >= params.x);
}
`;
export const MASK_FIELD_COMPOSITE_WGSL = `${MASK_FIELD_COMMON_WGSL}
@group(0) @binding(0) var<storage, read> basePixels: array<u32>;
@group(0) @binding(1) var<storage, read> field: array<u32>;
@group(0) @binding(2) var<storage, read_write> targetPixels: array<u32>;
@group(0) @binding(3) var<uniform> maskMeta: MaskMeta;
@group(0) @binding(4) var<uniform> lutParams: array<vec4<u32>, 64>;

fn maskLut(byteValue: u32) -> u32 {
  let packed = lutParams[byteValue / 4u];
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
  let index = gid.y * maskMeta.width + gid.x;
  let baseValue = basePixels[index];
  let amountByte = maskLut(field[index]);
  let baseAlpha = (baseValue >> 24u) & 255u;
  let outputAlpha = (baseAlpha * amountByte + 127u) / 255u;
  targetPixels[index] = (baseValue & 0x00ffffffu) | (outputAlpha << 24u);
}
`;
