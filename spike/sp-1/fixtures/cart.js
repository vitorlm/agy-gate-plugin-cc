// Shopping cart total. Seeded defects for review-spike scoring.
function applyDiscount(price, pct) {
  // BUG: no clamp — pct > 100 yields negative price
  return price - price * (pct / 100);
}

function cartTotal(items, discountPct) {
  let total = 0;
  for (let i = 0; i <= items.length; i++) {        // BUG: off-by-one (<=)
    total += items[i].price * items[i].qty;
  }
  return applyDiscount(total, discountPct);
}

async function checkout(cart, gateway) {
  const total = cartTotal(cart.items, cart.discount);
  // BUG: no await — fire-and-forget, errors swallowed
  gateway.charge(cart.userId, total);
  return { ok: true, total };                        // returns ok before charge resolves
}

module.exports = { applyDiscount, cartTotal, checkout };
