import { z } from 'zod';

export const BrandPosition = z.enum([
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'center',
  'top-center',
  'bottom-center',
]);
export type BrandPosition = z.infer<typeof BrandPosition>;

export const BrandLogoConfig = z.object({
  key: z.string(),
  widthPct: z.number().positive().max(100).default(10),
  position: BrandPosition.default('bottom-right'),
  marginX: z.number().min(0).default(20),
  marginY: z.number().min(0).default(20),
  opacity: z.number().min(0).max(1).default(1),
});
export type BrandLogoConfig = z.infer<typeof BrandLogoConfig>;

export const BrandWatermarkConfig = z.object({
  key: z.string().optional(),
  text: z.string().optional(),
  position: BrandPosition.default('bottom-right'),
  opacity: z.number().min(0).max(1).default(0.5),
  fontSize: z.number().positive().default(18),
  fontColor: z.string().default('#ffffff'),
});
export type BrandWatermarkConfig = z.infer<typeof BrandWatermarkConfig>;

export const BrandIntroOutro = z.object({
  enabled: z.boolean().default(false),
  key: z.string().optional(),
  durationSeconds: z.number().positive().default(3),
});
export type BrandIntroOutro = z.infer<typeof BrandIntroOutro>;

export const BrandOverlay = z.object({
  key: z.string().optional(),
  position: BrandPosition.default('top-center'),
  heightPct: z.number().positive().max(100).default(5),
  color: z.string().default('#000000'),
  opacity: z.number().min(0).max(1).default(0.5),
  text: z.string().optional(),
  showOnAllFormats: z.boolean().default(true),
});
export type BrandOverlay = z.infer<typeof BrandOverlay>;

export const SubtitleBrandStyle = z.object({
  fontName: z.string().default('Arial'),
  fontSize: z.number().positive().default(24),
  fontWeight: z.string().default('bold'),
  alignment: z.enum(['left', 'center', 'right']).default('center'),
  primaryColor: z.string().default('#FFFFFF'),
  outlineColor: z.string().default('#000000'),
  outlineWidth: z.number().default(2),
  backgroundColor: z.string().optional(),
  maxLines: z.number().int().positive().default(2),
  maxWidth: z.number().positive().default(80),
  bottomMargin: z.number().positive().default(10),
  safeZone: z.number().positive().default(5),
});
export type SubtitleBrandStyle = z.infer<typeof SubtitleBrandStyle>;

export const BrandProfile = z.object({
  id: z.string().uuid(),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  logo: BrandLogoConfig.optional(),
  watermark: BrandWatermarkConfig.optional(),
  intro: BrandIntroOutro.optional(),
  outro: BrandIntroOutro.optional(),
  topOverlay: BrandOverlay.optional(),
  bottomOverlay: BrandOverlay.optional(),
  colors: z.object({
    primary: z.string().default('#000000'),
    secondary: z.string().default('#FFFFFF'),
    accent: z.string().default('#FF0000'),
  }).optional(),
  subtitleStyle: SubtitleBrandStyle.optional(),
  formatOverrides: z
    .record(
      z.object({
        logo: BrandLogoConfig.optional(),
        watermark: BrandWatermarkConfig.optional(),
        subtitleStyle: SubtitleBrandStyle.optional(),
      }),
    )
    .optional(),
  platformRules: z
    .record(
      z.object({
        maxDurationSeconds: z.number().positive().optional(),
        minDurationSeconds: z.number().positive().optional(),
        ratio: z.string().optional(),
      }),
    )
    .optional(),
  backgroundColor: z.string().default('#000000'),
  isDefault: z.boolean().default(false),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type BrandProfile = z.infer<typeof BrandProfile>;
