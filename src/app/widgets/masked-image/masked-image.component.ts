import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';

type Rgb = [number, number, number];
type Lab = [number, number, number];

const SHADE_RATIO = 0.1;

const SHADE_LEVELS = 3;

const PERCENTILE_LOW = 0.1;
const PERCENTILE_HIGH = 0.9;

@Component({
  selector: 'app-masked-image',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './masked-image.component.html',
  styleUrl: './masked-image.component.scss',
})
export class MaskedImageComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) src!: string;
  @Input({ required: true }) mask!: string;
  @Input() color = '#ffffff';
  @Input() debounce = 250;
  @Input() alt = '';

  @ViewChild('canvas', { static: true })
  private canvasRef!: ElementRef<HTMLCanvasElement>;

  protected isLoading = false;
  protected hasError = false;
  private renderToken = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['src'] || changes['mask']) {
      this.scheduleRender(0);
      return;
    }

    if (changes['color']) {
      this.scheduleRender(Math.max(0, this.debounce));
    }
  }

  ngOnDestroy(): void {
    this.clearDebounce();
    this.renderToken += 1;
  }

  private scheduleRender(delayMs: number): void {
    this.clearDebounce();

    if (delayMs <= 0) {
      void this.render();
      return;
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.render();
    }, delayMs);
  }

  private clearDebounce(): void {
    if (this.debounceTimer === null) {
      return;
    }

    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  private async render(): Promise<void> {
    if (!this.src || !this.mask) return;

    const token = ++this.renderToken;
    this.isLoading = true;
    this.hasError = false;

    try {
      const [source, mask] = await Promise.all([
        this.loadImage(this.src),
        this.loadImage(this.mask),
      ]);

      if (token !== this.renderToken) return;

      const canvas = this.canvasRef.nativeElement;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      const width = source.naturalWidth;
      const height = source.naturalHeight;
      canvas.width = width;
      canvas.height = height;

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(source, 0, 0);

      const sourceData = ctx.getImageData(0, 0, width, height);

      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = width;
      maskCanvas.height = height;
      const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
      if (!maskCtx) return;

      maskCtx.imageSmoothingEnabled = false;
      maskCtx.drawImage(mask, 0, 0, width, height);
      const maskData = maskCtx.getImageData(0, 0, width, height);

      const target = parseHexColor(this.color);
      const output = recolorWithMask(sourceData, maskData, target);

      ctx.putImageData(output, 0, 0);
    } catch {
      if (token === this.renderToken) {
        this.hasError = true;
      }
    } finally {
      if (token === this.renderToken) {
        this.isLoading = false;
      }
    }
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }
}

interface BodyStats {
  low: number;
  high: number;
  spread: number;
}

interface ShadingPlan {
  shadow: number;
  highlight: number;
  quantize: boolean;
}

function recolorWithMask(
  source: ImageData,
  mask: ImageData,
  target: Rgb,
): ImageData {
  const [targetL, targetA, targetB] = rgbToLab(...target);
  const src = source.data;
  const msk = mask.data;

  const stats = collectBodyStats(src, msk);
  const plan = buildShadingPlan(targetL, stats.spread);

  const output = new ImageData(source.width, source.height);
  const out = output.data;

  for (let i = 0; i < src.length; i += 4) {
    const alpha = src[i + 3];
    if (alpha === 0) {
      out[i + 3] = 0;
      continue;
    }

    const maskValue = getMaskStrength(msk, i);
    if (maskValue <= 0) {
      out[i] = src[i];
      out[i + 1] = src[i + 1];
      out[i + 2] = src[i + 2];
      out[i + 3] = alpha;
      continue;
    }

    const [sourceL] = rgbToLab(src[i], src[i + 1], src[i + 2]);
    const outL = mapBodyLightness(sourceL, stats, plan);
    const tinted = labToRgb(outL, targetA, targetB);

    out[i] = blendChannel(src[i], tinted[0], maskValue);
    out[i + 1] = blendChannel(src[i + 1], tinted[1], maskValue);
    out[i + 2] = blendChannel(src[i + 2], tinted[2], maskValue);
    out[i + 3] = alpha;
  }

  return output;
}

function collectBodyStats(
  src: Uint8ClampedArray,
  msk: Uint8ClampedArray,
): BodyStats {
  const values: number[] = [];

  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] === 0) continue;
    if (getMaskStrength(msk, i) <= 0) continue;

    const [lightness] = rgbToLab(src[i], src[i + 1], src[i + 2]);
    values.push(lightness);
  }

  if (values.length === 0) {
    return { low: 0, high: 100, spread: 100 };
  }

  values.sort((a, b) => a - b);
  const low = percentile(values, PERCENTILE_LOW);
  const high = percentile(values, PERCENTILE_HIGH);
  const spread = Math.max(high - low, 1);

  return { low, high, spread };
}

function percentile(sorted: number[], p: number): number {
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);

  if (low === high) {
    return sorted[low];
  }

  const weight = index - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

function buildShadingPlan(targetL: number, sourceSpread: number): ShadingPlan {
  const roomBelow = targetL;
  const roomAbove = 100 - targetL;
  const available = roomBelow + roomAbove;
  const minSpread = Math.max(targetL * SHADE_RATIO * 2, 12);
  const spread = Math.min(available, Math.max(minSpread, sourceSpread));
  const spreadBelow = spread * (roomBelow / available);
  const spreadAbove = spread * (roomAbove / available);
  const darkBoost = targetL < 35 ? (35 - targetL) / 35 : 0;
  const shadowFloor = targetL < 4 ? 0 : Math.max(6, targetL * 0.35);
  const shadow = Math.max(shadowFloor, targetL - spreadBelow);
  const highlight = Math.min(100, targetL + spreadAbove * (1 + darkBoost * 0.4));

  return {
    shadow,
    highlight,
    quantize: spread <= minSpread,
  };
}

function mapBodyLightness(
  lightness: number,
  stats: BodyStats,
  plan: ShadingPlan,
): number {
  let tone = Math.max(0, Math.min(1, (lightness - stats.low) / stats.spread));

  if (plan.quantize) {
    tone = quantizeTone(tone);
  }

  return clampLabL(plan.shadow + tone * (plan.highlight - plan.shadow));
}

function quantizeTone(tone: number): number {
  const clamped = Math.max(0, Math.min(1, tone));
  const bucket = Math.min(
    SHADE_LEVELS - 1,
    Math.floor(clamped * SHADE_LEVELS),
  );

  return (bucket + 0.5) / SHADE_LEVELS;
}

function getMaskStrength(data: Uint8ClampedArray, index: number): number {
  const alpha = data[index + 3] / 255;
  if (alpha <= 0) {
    return 0;
  }

  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luma * alpha;
}

function blendChannel(original: number, tinted: number, mask: number): number {
  return Math.round(original + (tinted - original) * mask);
}

function parseHexColor(color: string): Rgb {
  const normalized = color.trim().replace(/^#/, '');
  const hex = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;

  if (hex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(hex)) {
    return [255, 255, 255];
  }

  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

const LAB_EPSILON = 216 / 24389;
const LAB_KAPPA = 24389 / 27;
const D65_X = 0.95047;
const D65_Y = 1;
const D65_Z = 1.08883;

function rgbToLab(r: number, g: number, b: number): Lab {
  const [x, y, z] = rgbToXyz(r, g, b);

  return xyzToLab(x, y, z);
}

function labToRgb(l: number, a: number, b: number): Rgb {
  const [x, y, z] = labToXyz(
    clampLabL(l),
    a,
    b,
  );

  return xyzToRgb(x, y, z);
}

function clampLabL(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function rgbToLinear(channel: number): number {
  const value = channel / 255;

  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToRgb(channel: number): number {
  const value = channel <= 0.0031308
    ? 12.92 * channel
    : 1.055 * (channel ** (1 / 3)) - 0.055;

  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const red = rgbToLinear(r);
  const green = rgbToLinear(g);
  const blue = rgbToLinear(b);

  return [
    red * 0.4124564 + green * 0.3575761 + blue * 0.1804375,
    red * 0.2126729 + green * 0.7151522 + blue * 0.0721750,
    red * 0.0193339 + green * 0.1191920 + blue * 0.9503041,
  ];
}

function xyzToRgb(x: number, y: number, z: number): Rgb {
  return [
    linearToRgb(x * 3.2404542 + y * -1.5371385 + z * -0.4985314),
    linearToRgb(x * -0.9692660 + y * 1.8760108 + z * 0.0415560),
    linearToRgb(x * 0.0556434 + y * -0.2040259 + z * 1.0572252),
  ];
}

function xyzToLab(x: number, y: number, z: number): Lab {
  const fx = labPivot(x / D65_X);
  const fy = labPivot(y / D65_Y);
  const fz = labPivot(z / D65_Z);

  return [
    116 * fy - 16,
    500 * (fx - fy),
    200 * (fy - fz),
  ];
}

function labToXyz(l: number, a: number, b: number): [number, number, number] {
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  return [
    D65_X * labPivotInverse(fx),
    D65_Y * labPivotInverse(fy),
    D65_Z * labPivotInverse(fz),
  ];
}

function labPivot(value: number): number {
  return value > LAB_EPSILON
    ? value ** (1 / 3)
    : (LAB_KAPPA * value + 16) / 116;
}

function labPivotInverse(value: number): number {
  const delta = 6 / 29;

  return value > delta
    ? value ** 3
    : (116 * value - 16) / LAB_KAPPA;
}
