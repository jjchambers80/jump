// Add-ons (spec 012): shown under the tiers once the cart holds a ticket that
// offers them. Donations (spec 047 D1) are not add-ons and do not go here.
// In `preview` (the wizard's Collect more step, 050-K) it lists every active
// ticket add-on and always renders `#add-ons`, with a placeholder when empty.

import AddOnPicker from '@/components/AddOnPicker';
import type { AddOn } from '@/lib/addOns';
import { PreviewNote } from './PreviewOff';
import Placeholder from './Placeholder';

interface EventAddOnsProps {
  offered: AddOn[];
  quantities: Record<string, number>;
  onChange?: (addOnId: string, quantity: number) => void;
  taxRate: number;
  taxInclusive: boolean;
  preview?: boolean;
}

export default function EventAddOns({ offered, quantities, onChange, taxRate, taxInclusive, preview = false }: EventAddOnsProps) {
  if (offered.length === 0) {
    if (!preview) return null;
    return (
      <div id="add-ons" className="mt-8 scroll-mt-6">
        <Placeholder>Add-ons you add show here</Placeholder>
      </div>
    );
  }
  return (
    <div id="add-ons" className="mt-8 scroll-mt-6">
      <AddOnPicker
        addOns={offered}
        quantities={quantities}
        onChange={onChange ?? (() => {})}
        taxRate={taxRate}
        taxInclusive={taxInclusive}
        hint="Optional extras bought with your tickets."
        offReasonId={onChange ? undefined : 'add-ons-off'}
      />
      {/* No handler (the wizard pane): the steppers are aria-disabled and point here */}
      {!onChange && (
        <PreviewNote id="add-ons-off" className="mt-2">
          Choosing add-ons is off in preview
        </PreviewNote>
      )}
    </div>
  );
}
