export const BID_INCREMENTS = [
  { min: 30, max: 100, increment: 5 },     // ₹30L - ₹1cr: increment ₹5L
  { min: 100, max: 200, increment: 10 },   // ₹1cr - ₹2cr: increment ₹10L
  { min: 200, max: 500, increment: 20 },   // ₹2cr - ₹5cr: increment ₹20L
  { min: 500, max: Infinity, increment: 25 }, // ₹5cr+: increment ₹25L
] as const;

export function getNextBidIncrement(currentBidLakh: number): number {
  for (const rule of BID_INCREMENTS) {
    if (currentBidLakh >= rule.min && currentBidLakh < rule.max) {
      return rule.increment;
    }
  }
  return BID_INCREMENTS[BID_INCREMENTS.length - 1].increment;
}

export function calculateNextBid(currentBidLakh: number): number {
  const increment = getNextBidIncrement(currentBidLakh);
  return currentBidLakh + increment;
}

export const BASE_PRICES_LAKH = [20, 30, 40, 50, 75, 100, 125, 150, 200] as const;
