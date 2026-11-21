// Revenue split engine. Works in paise (integers) so nothing is lost to rounding;
// any leftover paisa goes to the platform line.

const MODELS = {
  four_way: 'Standard 4-way split (25% each)',
  infra_first: 'Infrastructure-first: 20% off the top, remainder split partner / platform'
};

function computeSplit(amountInr, model = 'four_way', partnerShare = 50) {
  const total = Math.round(Number(amountInr) * 100);
  if (!Number.isFinite(total) || total < 0) {
    throw Object.assign(new Error('Amount must be a positive number'), { status: 400, expose: true });
  }

  let lines;
  if (model === 'four_way') {
    const q = Math.floor(total / 4);
    lines = [
      { party: 'infrastructure', label: 'Infrastructure / setup', pct: 25, paise: q },
      { party: 'business', label: 'Business owner (venue)', pct: 25, paise: q },
      { party: 'leadgen', label: 'Lead generator / event company', pct: 25, paise: q },
      { party: 'platform', label: 'rentmysite.ai', pct: 25, paise: total - 3 * q }
    ];
  } else if (model === 'infra_first') {
    const share = Math.min(100, Math.max(0, Number(partnerShare)));
    const infra = Math.floor(total * 0.2);
    const rest = total - infra;
    const partner = Math.floor((rest * share) / 100);
    lines = [
      { party: 'infrastructure', label: 'Infrastructure recovery', pct: 20, paise: infra },
      { party: 'business', label: 'Partner', pct: +(0.8 * share).toFixed(2), paise: partner },
      { party: 'platform', label: 'rentmysite.ai', pct: +(0.8 * (100 - share)).toFixed(2), paise: rest - partner }
    ];
  } else {
    throw Object.assign(new Error(`Unknown split model "${model}"`), { status: 400, expose: true });
  }

  return {
    model,
    modelLabel: MODELS[model],
    totalInr: total / 100,
    lines: lines.map(l => ({ ...l, amountInr: l.paise / 100 }))
  };
}

module.exports = { computeSplit, MODELS };
