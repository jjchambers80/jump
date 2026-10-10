// The app's Inter (root layout), shared with theme/fonts.ts so a theme using
// Inter reuses the preloaded face. The class sets --theme-font-inter.
import { Inter } from 'next/font/google';

export const inter = Inter({ subsets: ['latin'], variable: '--theme-font-inter' });
