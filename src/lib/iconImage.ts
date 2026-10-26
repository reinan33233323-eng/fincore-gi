// Turns any picture the user picks into a small square icon stored as a data URL.
// Logos with transparency keep it (fitted whole, never cropped) so the category
// color shows behind them; opaque photos are center-cropped. JPEG is only used
// for opaque pictures, because it has no alpha channel and turns transparency black.

export const ICON_ACCEPT = "image/*,.heic,.heif,.svg,.avif,.webp,.ico,.bmp,.gif,.tif,.tiff";
const SIZE = 192;
const MAX_BYTES = 30 * 1024 * 1024;
const TARGET = 90 * 1024;

const isHeic = (file: File) => /hei[cf]$/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
const isSvg = (file: File) => file.type === "image/svg+xml" || /\.svg$/i.test(file.name);

function load(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("decode"));
    image.src = src;
  });
}

async function decode(file: File): Promise<HTMLImageElement> {
  if (isSvg(file)) {
    // SVGs without width/height have no intrinsic size; give them one.
    const text = await file.text();
    const sized = /<svg[^>]*\swidth=/i.test(text) ? text : text.replace(/<svg/i, `<svg width="${SIZE * 2}" height="${SIZE * 2}"`);
    return load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`);
  }
  const url = URL.createObjectURL(file);
  try {
    return await load(url);
  } catch (error) {
    if (!isHeic(file)) throw error;
    // Chrome and Firefox cannot decode iPhone HEIC photos; convert them first.
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({ blob: file, toType: "image/png" });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    const pngUrl = URL.createObjectURL(blob);
    try { return await load(pngUrl); } finally { URL.revokeObjectURL(pngUrl); }
  } finally {
    URL.revokeObjectURL(url);
  }
}

function hasTransparency(image: HTMLImageElement) {
  const probe = document.createElement("canvas");
  probe.width = probe.height = 64;
  const ctx = probe.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, 64, 64);
  const data = ctx.getImageData(0, 0, 64, 64).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

function encode(canvas: HTMLCanvasElement, transparent: boolean) {
  const webp = (quality: number) => {
    const url = canvas.toDataURL("image/webp", quality);
    return url.startsWith("data:image/webp") ? url : null;
  };
  // WebP keeps alpha and compresses best; fall back where it is not supported.
  for (const quality of [0.86, 0.75, 0.6]) {
    const url = webp(quality);
    if (!url) break;
    if (url.length * 0.75 <= TARGET) return url;
  }
  if (transparent) return canvas.toDataURL("image/png");
  return canvas.toDataURL("image/jpeg", 0.8);
}

export async function imageToIcon(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error("Imagem muito grande. Use uma de até 30 MB.");
  let image: HTMLImageElement;
  try {
    image = await decode(file);
  } catch {
    throw new Error(isHeic(file)
      ? "Não foi possível converter esta foto HEIC. Tente exportá-la como JPG ou PNG."
      : "Este formato não pôde ser lido pelo navegador. Use PNG, JPG, WebP, SVG, GIF ou HEIC.");
  }
  const width = image.naturalWidth || SIZE, height = image.naturalHeight || SIZE;
  const transparent = isSvg(file) || hasTransparency(image);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  if (transparent) {
    // Logo: fit it whole with breathing room.
    const box = SIZE * 0.72, scale = Math.min(box / width, box / height);
    const w = width * scale, h = height * scale;
    ctx.drawImage(image, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  } else {
    // Photo: fill the square, cropping the center.
    const side = Math.min(width, height);
    ctx.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  }
  return encode(canvas, transparent);
}
