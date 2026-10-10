// Theme fonts (spec 038 §6.3, spec 049 card C): the curated FONTS of
// @jump/theme, self-hosted by next/font. Each declares `--theme-font-<key>`
// on its class; settingsCss.fontStack reads it. preload: false, so a font
// downloads only on pages whose theme uses it. 'system' needs no font;
// Inter is the app's own preloaded face (lib/interFont.ts).

import {
  Archivo,
  DM_Serif_Display,
  Libre_Baskerville,
  Lora,
  Montserrat,
  Oswald,
  Playfair_Display,
  Poppins,
  Space_Grotesk,
  Work_Sans,
} from 'next/font/google';
import { inter } from '@/lib/interFont';

// next/font needs literal options at module scope: one call per font.
const poppins = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap', preload: false, variable: '--theme-font-poppins' });
const montserrat = Montserrat({ subsets: ['latin'], display: 'swap', preload: false, variable: '--theme-font-montserrat' });
const playfairDisplay = Playfair_Display({ subsets: ['latin'], display: 'swap', preload: false, variable: '--theme-font-playfair-display' });
const dmSerifDisplay = DM_Serif_Display({ subsets: ['latin'], weight: '400', display: 'swap', preload: false, variable: '--theme-font-dm-serif-display' });
const lora = Lora({ subsets: ['latin'], display: 'swap', preload: false, variable: '--theme-font-lora' });
const workSans = Work_Sans({ subsets: ['latin'], display: 'swap', preload: false, variable: '--theme-font-work-sans' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], display: 'swap', preload: false, variable: '--theme-font-space-grotesk' });
const oswald = Oswald({ subsets: ['latin'], display: 'swap', preload: false, variable: '--theme-font-oswald' });
const archivo = Archivo({ subsets: ['latin'], display: 'swap', preload: false, variable: '--theme-font-archivo' });
const libreBaskerville = Libre_Baskerville({ subsets: ['latin'], weight: ['400', '700'], display: 'swap', preload: false, variable: '--theme-font-libre-baskerville' });

const FONT_CLASSES: Record<string, string> = {
  inter: inter.variable,
  poppins: poppins.variable,
  montserrat: montserrat.variable,
  'playfair-display': playfairDisplay.variable,
  'dm-serif-display': dmSerifDisplay.variable,
  lora: lora.variable,
  'work-sans': workSans.variable,
  'space-grotesk': spaceGrotesk.variable,
  oswald: oswald.variable,
  archivo: archivo.variable,
  'libre-baskerville': libreBaskerville.variable,
};

/** The variable classes of the theme's heading and body fonts. */
export function themeFontClasses(settings: Record<string, any>): string {
  const t = settings.typography ?? {};
  return [...new Set([t.headingFont ?? 'inter', t.bodyFont ?? 'inter'])].map((key) => FONT_CLASSES[key]).filter(Boolean).join(' ');
}
