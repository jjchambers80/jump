// Storefront form controls (apply form, contact form). Brand tokens come from
// BrandScope, so the focus ring follows the organization's color.

export const storefrontField =
  'w-full px-3.5 border rounded-xl bg-white text-[15px] text-gray-900 placeholder:text-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-link focus:border-transparent border-gray-300 hover:border-gray-400 dark:border-slate-600 dark:hover:border-slate-500 dark:bg-slate-900/60 dark:text-slate-100 dark:placeholder:text-slate-500';
export const storefrontInput = `${storefrontField} h-11`;
export const storefrontTextarea = `${storefrontField} py-2.5 leading-relaxed`;
export const storefrontLabel = 'block text-sm font-semibold text-gray-800 dark:text-slate-200 mb-1.5';
