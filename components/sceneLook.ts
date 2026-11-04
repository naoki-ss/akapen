// 3Dの見た目の部品（空、模様、素材）。どの物件にも同じものを使う。three.js の機能だけで一から作る

import {
  BoxGeometry,
  CanvasTexture,
  EquirectangularReflectionMapping,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "three";
import { GLASS, MATERIALS, type Pattern } from "@/lib/materials";

// 決まった乱数。読み込むたびに雲が変わらないようにする
function seeded(seed: number) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

// 青空のグラデーションと雲。背景と空の映り込み（環境マップ）に同じものを使う
export function makeSky() {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d")!;
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#1F5FB0");
  sky.addColorStop(0.3, "#3A83D2");
  sky.addColorStop(0.42, "#6FAEE4");
  sky.addColorStop(0.485, "#BFDCF0");
  sky.addColorStop(0.5, "#E2ECF1");
  sky.addColorStop(0.56, "#E2ECF1");
  sky.addColorStop(1, "#B5B3AC");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const random = seeded(4242);
  for (let cloud = 0; cloud < 22; cloud += 1) {
    const x = random() * canvas.width;
    const y = 230 + random() * 245;
    const size = 60 + random() * 150;
    for (let puff = 0; puff < 14; puff += 1) {
      const px = x + (random() - 0.5) * size * 2.6;
      const py = y + (random() - 0.5) * size * 0.5;
      const radius = size * (0.25 + random() * 0.5);
      const glow = ctx.createRadialGradient(px, py, 0, px, py, radius);
      glow.addColorStop(0, "rgba(255,255,255,0.55)");
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export const HORIZON = "#E2ECF1";

// 模様は白地に薄い線。素材の色に掛け合わせる
function makePattern(pattern: Pattern) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  const line = (color: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  switch (pattern) {
    case "ribs":
      // 横張の山。影の帯を2本
      for (const y of [0, 128]) {
        const band = ctx.createLinearGradient(0, y, 0, y + 128);
        band.addColorStop(0, "#ffffff");
        band.addColorStop(0.55, "#d8d8d8");
        band.addColorStop(0.8, "#6e6e6e");
        band.addColorStop(1, "#ffffff");
        ctx.fillStyle = band;
        ctx.fillRect(0, y, size, 128);
      }
      break;
    case "folded":
      for (const x of [0, 128]) {
        const band = ctx.createLinearGradient(x, 0, x + 128, 0);
        band.addColorStop(0, "#ffffff");
        band.addColorStop(0.7, "#c4c4c4");
        band.addColorStop(1, "#8a8a8a");
        ctx.fillStyle = band;
        ctx.fillRect(x, 0, 128, size);
      }
      break;
    case "joints":
      // 縦張のパネルの目地
      line("#8c8c8c", 0, 0, 4, size);
      break;
    case "tile":
      line("#b9b9b9", 0, 0, size, 8);
      line("#b9b9b9", 0, 128, size, 8);
      line("#b9b9b9", 0, 0, 8, 128);
      line("#b9b9b9", 128, 128, 8, 128);
      break;
    case "grating":
      for (let i = 0; i < size; i += 32) {
        line("#555555", i, 0, 10, size);
      }
      for (let i = 0; i < size; i += 128) {
        line("#555555", 0, i, size, 8);
      }
      break;
    case "board": {
      // 打放しの型枠の目地とセパ穴、薄いむら
      const random = seeded(77);
      for (let i = 0; i < 160; i += 1) {
        const shade = 244 + Math.floor(random() * 11);
        ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
        ctx.fillRect(random() * size, random() * size, 60, 60);
      }
      line("#cfcfcf", 0, 0, size, 2);
      line("#cfcfcf", 0, 0, 2, size);
      for (const [x, y] of [
        [64, 64],
        [192, 64],
        [64, 192],
        [192, 192],
      ]) {
        line("#9c9c9c", x, y, 3, 3);
      }
      break;
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

const patterns = new Map<Pattern, Texture>();
const materials = new Map<string, MeshStandardMaterial>();

// 素材は種類ごとに1つを使い回す（描く回数を増やさない）
export function materialFor(key: string, ghost = false) {
  const id = `${key}|${ghost}`;
  const known = materials.get(id);
  if (known) return known;
  const spec = MATERIALS[key] ?? MATERIALS.standard_wall;
  const material = new MeshStandardMaterial({
    color: spec.color,
    metalness: spec.metalness,
    roughness: spec.roughness,
    transparent: ghost,
    opacity: ghost ? 0.14 : 1,
    depthWrite: !ghost,
  });
  if (spec.pattern) {
    let texture = patterns.get(spec.pattern);
    if (!texture) {
      texture = makePattern(spec.pattern);
      patterns.set(spec.pattern, texture);
    }
    const scaled = texture.clone();
    scaled.repeat.set(1 / (spec.tile ?? 1), 1 / (spec.tile ?? 1));
    scaled.needsUpdate = true;
    material.map = scaled;
  }
  materials.set(id, material);
  return material;
}

export function glassFor(ghost = false) {
  const id = `glass|${ghost}`;
  const known = materials.get(id);
  if (known) return known;
  const material = new MeshStandardMaterial({
    color: GLASS.color,
    metalness: GLASS.metalness,
    roughness: GLASS.roughness,
    envMapIntensity: GLASS.envMapIntensity,
    transparent: true,
    opacity: ghost ? 0.06 : GLASS.opacity,
    depthWrite: false,
  });
  materials.set(id, material);
  return material;
}

// 箱の形。模様の大きさが部材の大きさで伸びないよう、UVをメートルで付ける
export function meterBox(
  size: [number, number, number],
  center: [number, number, number] = [0, 0, 0],
) {
  const box = new BoxGeometry(...size);
  box.translate(...center);
  const position = box.attributes.position;
  const normal = box.attributes.normal;
  const uv = box.attributes.uv;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    if (Math.abs(normal.getX(i)) > 0.5) uv.setXY(i, z, y);
    else if (Math.abs(normal.getY(i)) > 0.5) uv.setXY(i, x, z);
    else uv.setXY(i, x, y);
  }
  return box;
}
