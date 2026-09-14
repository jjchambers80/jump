// Compact card-brand / wallet badge used on the Payments card and methods page.
// Text-only marks (no trademark artwork); colours hint at the brand.

const BRAND: Record<string, { text: string; className: string }> = {
  visa: { text: 'VISA', className: 'bg-[#1a1f71] text-white' },
  mastercard: { text: 'MC', className: 'bg-[#eb001b] text-white' },
  amex: { text: 'AMEX', className: 'bg-[#2e77bc] text-white' },
  discover: { text: 'DISC', className: 'bg-[#ff6000] text-black' },
  diners: { text: 'DC', className: 'bg-[#0079be] text-white' },
  jcb: { text: 'JCB', className: 'bg-[#0e4c96] text-white' },
  apple_pay: { text: 'Pay', className: 'bg-black text-white' },
  google_pay: { text: 'G Pay', className: 'border border-gray-300 bg-white text-gray-800' },
  link: { text: 'Link', className: 'bg-[#33ddb3] text-black' },
  cashapp: { text: 'Cash', className: 'bg-[#00d632] text-black' },
  affirm: { text: 'affirm', className: 'bg-[#4a4af4] text-white' },
  klarna: { text: 'K.', className: 'bg-[#ffb3c7] text-black' },
  afterpay_clearpay: { text: 'AP', className: 'bg-[#b2fce4] text-black' },
};

export default function BrandBadge({ brand, label }: { brand: string; label?: string }) {
  const b = BRAND[brand] ?? { text: brand.slice(0, 4).toUpperCase(), className: 'bg-gray-200 text-gray-800' };
  return (
    <span
      role="img"
      aria-label={label ?? brand}
      className={`inline-flex h-6 min-w-[2.5rem] items-center justify-center rounded px-1.5 text-[10px] font-bold leading-none tracking-wide ${b.className}`}
    >
      {b.text}
    </span>
  );
}
