export const rgbaToRgb = (rgba: Uint8ClampedArray | Uint8Array): Uint8Array => {
  const rgb = new Uint8Array((rgba.length / 4) * 3)
  let out = 0
  for (let i = 0; i < rgba.length; i += 4) {
    rgb[out++] = rgba[i]
    rgb[out++] = rgba[i + 1]
    rgb[out++] = rgba[i + 2]
  }
  return rgb
}

export const computeTargetSize = (
  srcWidth: number,
  srcHeight: number,
  maxWidth?: number,
  maxHeight?: number,
): [number, number] => {
  if (!maxWidth && !maxHeight) return [srcWidth, srcHeight]
  const aspect = srcWidth / srcHeight
  if (maxWidth && maxHeight) {
    let width = maxWidth
    let height = Math.round(width / aspect)
    if (height > maxHeight) {
      height = maxHeight
      width = Math.round(height * aspect)
    }
    return [width, height]
  }
  if (maxWidth) return [maxWidth, Math.round(maxWidth / aspect)]
  const height = maxHeight as number
  return [Math.round(height * aspect), height]
}

export const hammingDistance64 = (a: bigint, b: bigint): number => {
  let x = a ^ b
  let count = 0
  while (x) {
    x &= x - 1n
    count++
  }
  return count
}

export const dHash64FromGrayscale9x8 = (gray9x8: Uint8Array): bigint => {
  let hash = 0n
  let bitIndex = 0n
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = gray9x8[row * 9 + col]
      const right = gray9x8[row * 9 + col + 1]
      if (left > right) hash |= 1n << bitIndex
      bitIndex++
    }
  }
  return hash
}
