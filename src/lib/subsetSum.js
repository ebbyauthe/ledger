// Finds a combination of unpaid entries (in any order) whose total is as close as possible
// to targetCents without going over, so a typed payment amount can auto-mark the entries it
// covers as paid instead of the admin picking them one by one. Classic 0/1 subset-sum with
// reconstruction, done in integer cents to avoid float drift.
export function bestFitSubset(items, targetCents) {
  if (targetCents <= 0 || !items.length) return { ids: [], achievedCents: 0 };

  const n = items.length;
  const cellBudget = (n + 1) * (targetCents + 1);
  if (cellBudget > 20_000_000) {
    // Amount/entry count too large for exact matching to be worth the memory — fall back to
    // greedily taking entries (oldest first, as passed in) that fit without exceeding the target.
    let sum = 0;
    const ids = [];
    for (const item of items) {
      if (sum + item.cents <= targetCents) {
        sum += item.cents;
        ids.push(item.id);
      }
    }
    return { ids, achievedCents: sum };
  }

  const layers = [new Uint8Array(targetCents + 1)];
  layers[0][0] = 1;
  for (let i = 0; i < n; i++) {
    const prev = layers[i];
    const cur = new Uint8Array(prev);
    const cents = items[i].cents;
    for (let s = targetCents; s >= cents; s--) {
      if (prev[s - cents]) cur[s] = 1;
    }
    layers.push(cur);
  }

  let achieved = 0;
  for (let s = targetCents; s >= 0; s--) {
    if (layers[n][s]) { achieved = s; break; }
  }

  const ids = [];
  let remaining = achieved;
  for (let i = n; i > 0; i--) {
    const cents = items[i - 1].cents;
    if (remaining >= cents && layers[i - 1][remaining - cents]) {
      ids.push(items[i - 1].id);
      remaining -= cents;
    }
  }

  return { ids, achievedCents: achieved };
}

export function parseMatchedEntryIds(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
