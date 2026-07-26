// Core Authoritative Rounded Obligation Splitting Engine.
// Ported as-is from the original server.ts (calculateSplits) — this algorithm
// is deliberately left unchanged per the migration brief; do not "improve" the
// rounding behavior without confirming it still reconciles exactly.
export function calculateSplits(
  subtotal: number,
  tax: number,
  serviceCharge: number,
  discount: number,
  otherFees: number,
  items: Array<{
    id: string;
    price: number;
    quantity: number;
    splitMethod: string;
    itemAllocations: Array<{ participantId: string; weight: number }>;
  }>
): {
  itemsObligations: Array<{ itemId: string; participantId: string; amount: number }>;
  chargesObligations: Array<{ chargeType: string; participantId: string; amount: number }>;
  participantTotals: Record<string, number>;
} {
  const itemsObligations: Array<{ itemId: string; participantId: string; amount: number }> = [];
  const chargesObligations: Array<{ chargeType: string; participantId: string; amount: number }> = [];
  const participantSubtotals: Record<string, number> = {};

  const safeItems = Array.isArray(items) ? items : [];

  for (const item of safeItems) {
    if (!item) continue;
    const price = Number(item.price || 0);
    const quantity = Number(item.quantity || 1);
    const itemTotal = Math.round(price * quantity);
    const itemAllocations = Array.isArray(item.itemAllocations) ? item.itemAllocations : [];
    const allocs = itemAllocations.filter((a) => a && Number(a.weight || 0) > 0);
    if (allocs.length === 0) continue;

    if (item.splitMethod === "Equal") {
      const N = allocs.length;
      const baseShare = Math.floor(itemTotal / N);
      const remainder = itemTotal - baseShare * N;

      const sortedAllocs = [...allocs].sort((a, b) =>
        String(a.participantId || "").localeCompare(String(b.participantId || ""))
      );

      sortedAllocs.forEach((alloc, index) => {
        const extra = index < remainder ? 1 : 0;
        const finalShare = baseShare + extra;
        itemsObligations.push({ itemId: item.id, participantId: alloc.participantId, amount: finalShare });
        participantSubtotals[alloc.participantId] = (participantSubtotals[alloc.participantId] || 0) + finalShare;
      });
    } else if (item.splitMethod === "Ratio" || item.splitMethod === "Percentage" || item.splitMethod === "Custom") {
      const totalWeight = allocs.reduce((sum, a) => sum + Number(a.weight || 0), 0);

      if (totalWeight > 0) {
        const shares = allocs.map((alloc) => {
          const weight = Number(alloc.weight || 0);
          const raw = (itemTotal * weight) / totalWeight;
          const rounded = Math.floor(raw);
          const fraction = raw - rounded;
          return { alloc, rounded, fraction };
        });

        const sumRounded = shares.reduce((sum, s) => sum + s.rounded, 0);
        const remainder = itemTotal - sumRounded;

        shares.sort((a, b) => {
          if (Math.abs(b.fraction - a.fraction) < 0.000001) {
            return String(a.alloc.participantId || "").localeCompare(String(b.alloc.participantId || ""));
          }
          return b.fraction - a.fraction;
        });

        shares.forEach((s, index) => {
          const extra = index < remainder ? 1 : 0;
          const finalShare = s.rounded + extra;
          itemsObligations.push({ itemId: item.id, participantId: s.alloc.participantId, amount: finalShare });
          participantSubtotals[s.alloc.participantId] = (participantSubtotals[s.alloc.participantId] || 0) + finalShare;
        });
      }
    } else if (item.splitMethod === "Quantity") {
      const totalUnits = allocs.reduce((sum, a) => sum + Number(a.weight || 0), 0);
      if (totalUnits > 0) {
        const unitPrice = price;
        let runningTotal = 0;

        allocs.forEach((alloc, index) => {
          let share = 0;
          if (index === allocs.length - 1) {
            share = itemTotal - runningTotal;
          } else {
            share = Math.round(Number(alloc.weight || 0) * unitPrice);
            runningTotal += share;
          }
          itemsObligations.push({ itemId: item.id, participantId: alloc.participantId, amount: share });
          participantSubtotals[alloc.participantId] = (participantSubtotals[alloc.participantId] || 0) + share;
        });
      }
    } else {
      const N = allocs.length;
      const baseShare = Math.floor(itemTotal / N);
      const remainder = itemTotal - baseShare * N;
      const sortedAllocs = [...allocs].sort((a, b) =>
        String(a.participantId || "").localeCompare(String(b.participantId || ""))
      );
      sortedAllocs.forEach((alloc, index) => {
        const extra = index < remainder ? 1 : 0;
        const finalShare = baseShare + extra;
        itemsObligations.push({ itemId: item.id, participantId: alloc.participantId, amount: finalShare });
        participantSubtotals[alloc.participantId] = (participantSubtotals[alloc.participantId] || 0) + finalShare;
      });
    }
  }

  const actualSubtotalAssigned = Object.values(participantSubtotals).reduce((sum, v) => sum + (v || 0), 0);

  function distributeProportionalCharge(chargeAmountInput: number, chargeType: string) {
    const chargeAmount = Number(chargeAmountInput || 0);
    if (!chargeAmount || isNaN(chargeAmount)) return;
    const participants = Object.keys(participantSubtotals);
    if (participants.length === 0 || !actualSubtotalAssigned || isNaN(actualSubtotalAssigned)) return;

    const sign = chargeAmount < 0 ? -1 : 1;
    const absCharge = Math.abs(chargeAmount);

    const shares = participants.map((pId) => {
      const pSub = participantSubtotals[pId] || 0;
      const raw = (absCharge * pSub) / actualSubtotalAssigned;
      const rounded = Math.floor(raw);
      const fraction = raw - rounded;
      return { pId, rounded, fraction };
    });

    const sumRounded = shares.reduce((sum, s) => sum + s.rounded, 0);
    const remainder = absCharge - sumRounded;

    shares.sort((a, b) => {
      if (Math.abs(b.fraction - a.fraction) < 0.000001) {
        return a.pId.localeCompare(b.pId);
      }
      return b.fraction - a.fraction;
    });

    shares.forEach((s, index) => {
      const extra = index < remainder ? 1 : 0;
      const finalAbsShare = s.rounded + extra;
      const finalShare = finalAbsShare * sign;
      chargesObligations.push({ chargeType, participantId: s.pId, amount: finalShare });
    });
  }

  distributeProportionalCharge(tax, "tax");
  distributeProportionalCharge(serviceCharge, "serviceCharge");
  distributeProportionalCharge(discount, "discount");
  distributeProportionalCharge(otherFees, "otherFees");

  const participantTotals: Record<string, number> = {};

  Object.keys(participantSubtotals).forEach((pId) => {
    participantTotals[pId] = participantSubtotals[pId] || 0;
  });

  chargesObligations.forEach((c) => {
    if (c.chargeType === "discount") {
      participantTotals[c.participantId] = (participantTotals[c.participantId] || 0) - c.amount;
    } else {
      participantTotals[c.participantId] = (participantTotals[c.participantId] || 0) + c.amount;
    }
  });

  return { itemsObligations, chargesObligations, participantTotals };
}
