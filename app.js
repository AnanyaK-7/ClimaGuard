/**
 * ClimaCheck - Garnier ClimaGuard AI Routine Guide
 * L'Oréal Sustainability Challenge 2026 (Gen Z India)
 * Executive Derm-Tech Controller & Deterministic Rule Engine
 */

// ============================================================================
// 1. CPCB PM2.5 AQI CALCULATION (Approximate, PM2.5-based)
// ============================================================================
/**
 * Official Central Pollution Control Board (CPCB) Breakpoints for PM2.5 (µg/m³):
 * - 0 to 30: Good (AQI 0–50)
 * - 31 to 60: Satisfactory (AQI 51–100)
 * - 61 to 90: Moderate (AQI 101–200)
 * - 91 to 120: Poor (AQI 201–300)
 * - 121 to 250: Very Poor (AQI 301–400)
 * - 250+: Severe (AQI 401–500)
 */
function calculateCPCB_AQI(pm25) {
  if (pm25 === null || pm25 === undefined || isNaN(pm25) || pm25 < 0) {
    return { aqi: 0, category: 'Unknown', color: 'gray', description: 'No data' };
  }

  let aqi = 0;
  let category = 'Good';
  let color = 'emerald';

  if (pm25 <= 30) {
    aqi = Math.round((50 / 30) * pm25);
    category = 'Good';
    color = 'emerald';
  } else if (pm25 <= 60) {
    aqi = Math.round(51 + ((100 - 51) / (60 - 30)) * (pm25 - 30));
    category = 'Satisfactory';
    color = 'teal';
  } else if (pm25 <= 90) {
    aqi = Math.round(101 + ((200 - 101) / (90 - 60)) * (pm25 - 60));
    category = 'Moderate';
    color = 'amber';
  } else if (pm25 <= 120) {
    aqi = Math.round(201 + ((300 - 201) / (120 - 90)) * (pm25 - 90));
    category = 'Poor';
    color = 'orange';
  } else if (pm25 <= 250) {
    aqi = Math.round(301 + ((400 - 301) / (250 - 120)) * (pm25 - 120));
    category = 'Very Poor';
    color = 'rose';
  } else {
    aqi = Math.round(Math.min(500, 401 + ((500 - 401) / (380 - 250)) * (pm25 - 250)));
    category = 'Severe';
    color = 'purple';
  }

  return {
    aqi,
    pm25: Math.round(pm25 * 10) / 10,
    category,
    color,
    label: `${category} (${aqi})`
  };
}

// ============================================================================
// 2. ENVIRONMENTAL STRESS LEVEL (0–100 CLIENT CALCULATION)
// ============================================================================
function calculateClientBSI(pm25, uv, humidity, temp) {
  const aqiInfo = calculateCPCB_AQI(pm25);
  const approxAqi = aqiInfo.aqi;

  // 1. PM2.5 / AQI contribution (calibrated to Indian NAQI)
  let pmPts = 0;
  if (approxAqi <= 50) {
    pmPts = (approxAqi / 50.0) * 12.0;
  } else if (approxAqi <= 100) {
    pmPts = 12.0 + ((approxAqi - 50.0) / 50.0) * 12.0;
  } else if (approxAqi <= 200) {
    pmPts = 24.0 + ((approxAqi - 100.0) / 100.0) * 21.0;
  } else if (approxAqi <= 300) {
    pmPts = 50.0 + ((approxAqi - 200.0) / 100.0) * 15.0;
  } else if (approxAqi <= 400) {
    pmPts = 68.0 + ((approxAqi - 300.0) / 100.0) * 10.0;
  } else {
    pmPts = Math.min(82.0, 78.0 + ((approxAqi - 400.0) / 100.0) * 4.0);
  }

  // 2. Solar UV contribution
  const uvPts = uv > 0 ? Math.min(20.0, (uv / 10.0) * 18.0) : 0.0;

  // 3. Humidity contribution
  let humPts = 1.0;
  if (humidity < 50.0) {
    humPts = Math.min(15.0, ((50.0 - humidity) / 35.0) * 14.0);
  } else if (humidity > 65.0) {
    humPts = Math.min(12.0, ((humidity - 65.0) / 30.0) * 11.0);
  }

  let totalScore = Math.round(pmPts + uvPts + humPts);
  totalScore = Math.max(5, Math.min(100, totalScore));

  // Recalibration guarantees:
  // - AQI 201-300 (Poor) scores at least 55 ("Moderate-High")
  // - AQI > 300 (Very Poor / Severe) scores at least 75 ("High Stress")
  if (approxAqi >= 201 && approxAqi <= 300 && totalScore < 55) {
    totalScore = 55;
  }
  if (approxAqi > 300 && totalScore < 75) {
    totalScore = 75;
  }

  // Tier labels matching the score
  let tier = 'Low Stress';
  let color = 'emerald';
  let strokeColor = '#10B981';

  if (totalScore <= 30) {
    tier = 'Low Stress';
    color = 'emerald';
    strokeColor = '#10B981';
  } else if (totalScore <= 54) {
    tier = 'Moderate Stress';
    color = 'teal';
    strokeColor = '#0E8388';
  } else if (totalScore <= 74) {
    tier = 'Moderate-High';
    color = 'amber';
    strokeColor = '#F59E0B';
  } else {
    tier = 'High Stress';
    color = 'rose';
    strokeColor = '#E11D48';
  }

  return {
    score: totalScore,
    tier,
    color,
    strokeColor,
    breakdown: {
      pm: Math.round(pmPts),
      uv: Math.round(uvPts),
      humidity: Math.round(humPts)
    }
  };
}

// ============================================================================
// 3. CORE LOGIC: decideMode(inputs) - Pure Deterministic Function
// ============================================================================
/**
 * Decision Rules:
 * - SHIELD if approx AQI > 200 (CPCB "Poor" or worse) OR UV index >= 6
 * - HYDRATE if humidity < 40% OR the user reports "tight/dry skin"
 * - BALANCE if humidity > 65% OR the user reports "oily/shiny skin"
 * - Priority: Shield > Hydrate > Balance. If nothing triggers, default to Balance (everyday).
 * - Always show WHY: list triggered rules as chips.
 */
function decideMode(inputs = {}) {
  const aqi = inputs.aqi ?? inputs.approx_aqi ?? 0;
  const uv = inputs.uv ?? 0;
  const humidity = inputs.humidity ?? 50;

  const symptomsSet = new Set();
  if (inputs.symptoms instanceof Set) {
    inputs.symptoms.forEach(s => symptomsSet.add(String(s).toLowerCase().trim()));
  } else if (Array.isArray(inputs.symptoms)) {
    inputs.symptoms.forEach(s => symptomsSet.add(String(s).toLowerCase().trim()));
  } else if (inputs.skinFeel && typeof inputs.skinFeel === 'object') {
    Object.keys(inputs.skinFeel).forEach(k => {
      if (inputs.skinFeel[k]) symptomsSet.add(k.toLowerCase().trim());
    });
  }

  const hasTight = symptomsSet.has('tight') || symptomsSet.has('tight/dry') || symptomsSet.has('dry');
  const hasOily = symptomsSet.has('oily') || symptomsSet.has('oily/shiny') || symptomsSet.has('shine');
  const hasDull = symptomsSet.has('dull') || symptomsSet.has('dull/tired');
  const hasBreakouts = symptomsSet.has('breakouts') || symptomsSet.has('breakout');

  const shieldReasons = [];
  const hydrateReasons = [];
  const balanceReasons = [];
  const userSymptomReasons = [];

  // 1. Evaluate SHIELD
  if (aqi > 200) {
    shieldReasons.push(`AQI ${aqi} > 200 (Poor air quality)`);
  }
  if (uv >= 6) {
    shieldReasons.push(`UV Index ${uv} >= 6 (High solar stress)`);
  }

  // 2. Evaluate HYDRATE
  if (humidity < 40) {
    hydrateReasons.push(`Humidity ${humidity}% < 40% (Dry air / TEWL risk)`);
  }
  if (hasTight) {
    hydrateReasons.push('You reported: Tight / dry');
    userSymptomReasons.push('You reported: Tight / dry');
  }

  // 3. Evaluate BALANCE
  if (humidity > 65) {
    balanceReasons.push(`Humidity ${humidity}% > 65% (High humidity / sebum risk)`);
  }
  if (hasOily) {
    balanceReasons.push('You reported: Oily / shiny');
    userSymptomReasons.push('You reported: Oily / shiny');
  }

  // Dull and Breakouts do not change mode; they change steps
  if (hasDull) {
    userSymptomReasons.push('You reported: Dull / tired');
  }
  if (hasBreakouts) {
    userSymptomReasons.push('You reported: Breakouts');
  }

  // Determine active mode by strict priority: Shield > Hydrate > Balance
  let activeMode = 'BALANCE';
  let activeReasons = [];
  let isDefault = false;
  let overrideNote = null;

  if (shieldReasons.length > 0) {
    activeMode = 'SHIELD';
    activeReasons = [...shieldReasons];
    if (symptomsSet.size > 0) {
      const shieldCause = aqi > 200 ? 'high air pollution (AQI > 200)' : 'high solar UV (UV Index >= 6)';
      overrideNote = `Shield mode stays active because of ${shieldCause}; your selections adjusted the steps.`;
    }
  } else if (hydrateReasons.length > 0) {
    activeMode = 'HYDRATE';
    activeReasons = [...hydrateReasons];
    if (humidity < 40 && hasOily) {
      overrideNote = 'Hydrate mode stays active because of dry air (humidity < 40%); your selections adjusted the steps.';
    }
  } else if (balanceReasons.length > 0) {
    activeMode = 'BALANCE';
    activeReasons = [...balanceReasons];
  } else {
    activeMode = 'BALANCE';
    activeReasons = ['Optimal conditions: Everyday barrier maintenance'];
    isDefault = true;
  }

  const allChips = new Set([...shieldReasons, ...hydrateReasons, ...balanceReasons, ...userSymptomReasons]);

  return {
    mode: activeMode,
    reasons: activeReasons,
    isDefault,
    overrideNote,
    allTriggers: Array.from(allChips),
    symptoms: Array.from(symptomsSet)
  };
}

function getRoutine(mode = 'BALANCE', tab = 'AM', symptoms = []) {
  const normMode = String(mode || 'BALANCE').trim().toUpperCase();
  const normTab = String(tab || 'AM').trim().toUpperCase();

  const symptomsSet = new Set();
  if (symptoms instanceof Set) {
    symptoms.forEach(s => symptomsSet.add(String(s).toLowerCase().trim()));
  } else if (Array.isArray(symptoms)) {
    symptoms.forEach(s => symptomsSet.add(String(s).toLowerCase().trim()));
  } else if (symptoms && typeof symptoms === 'object') {
    Object.keys(symptoms).forEach(k => {
      if (symptoms[k]) symptomsSet.add(k.toLowerCase().trim());
    });
  }

  const hasOily = symptomsSet.has('oily') || symptomsSet.has('oily/shiny') || symptomsSet.has('shine');
  const hasTight = symptomsSet.has('tight') || symptomsSet.has('tight/dry') || symptomsSet.has('dry');
  const hasDull = symptomsSet.has('dull') || symptomsSet.has('dull/tired');
  const hasBreakouts = symptomsSet.has('breakouts') || symptomsSet.has('breakout');
  const isCombo = hasOily && hasTight;

  let s1 = {};
  let s2 = {};
  let s3 = {};

  if (normMode === 'SHIELD') {
    if (normTab === 'AM') {
      s1 = {
        step: '01',
        title: 'Gentle Barrier-Preserving Cleanser',
        instructions: 'Wash with lukewarm water and a low-pH, sulfate-free cleanser. Clears surface debris without stripping natural lipid barriers.',
        amount: '1-2 pumps'
      };
      s2 = {
        step: '02',
        title: 'Garnier ClimaGuard Serum-Gel',
        instructions: 'Apply generously on clean skin. Ectoin forms a natural hydro-complex shield against PM2.5 deposition while Ceramide NP seals intercellular lipid lamellae.',
        amount: '2 pumps'
      };
      s3 = {
        step: '03',
        title: 'Broad-Spectrum Photoprotection SPF 50+',
        instructions: 'Broad-spectrum UV protection formulated with photostable Mexoryl filters to help protect against UVA/UVB photo-oxidation.',
        amount: '2 finger lengths'
      };
    } else {
      s1 = {
        step: '01',
        title: 'Thorough Micro-Pollutant Cleanse (Double Cleanse)',
        instructions: 'Dissolve airborne PM2.5, stubborn grime, and mineral sunscreen residue with an ultra-gentle double cleanse.',
        amount: 'Thorough rinse'
      };
      s2 = {
        step: '02',
        title: 'Garnier ClimaGuard Overnight Recovery',
        instructions: 'Apply 2-3 pumps. High-potency Niacinamide supports ceramide production and overnight barrier recovery while skin sleeps.',
        amount: '2-3 pumps'
      };
      s3 = {
        step: '03',
        title: 'Lipid-Replenishing Squalane Moisturiser',
        instructions: 'Seal hydration with a lightweight, non-comedogenic sugarcane squalane moisturiser to reinforce barrier recovery and reduce overnight TEWL.',
        amount: 'Pea-sized amount'
      };
    }
  } else if (normMode === 'HYDRATE') {
    if (normTab === 'AM') {
      s1 = {
        step: '01',
        title: 'Gentle Non-Foaming Cleanser',
        instructions: 'Splash face with lukewarm water or use a soothing non-foaming wash to preserve stratum corneum moisture.',
        amount: '1 pump'
      };
      s2 = {
        step: '02',
        title: 'Garnier ClimaGuard Serum-Gel on Damp Skin',
        instructions: 'Apply directly on damp skin. Ceramide NP and squalane help lock in water molecules and prevent moisture evaporation.',
        amount: '2 pumps'
      };
      s3 = {
        step: '03',
        title: 'Hydrating Barrier Moisturiser + SPF 50',
        instructions: 'Layer a light hydrating moisturiser followed by broad-spectrum SPF 50 to seal barrier comfort.',
        amount: '2 finger lengths'
      };
    } else {
      s1 = {
        step: '01',
        title: 'Soothing Cream Cleanser',
        instructions: 'Cleanse with a mild cream cleanser that removes dirt while replenishing dry stratum corneum lipids.',
        amount: '1-2 pumps'
      };
      s2 = {
        step: '02',
        title: 'Garnier ClimaGuard Serum-Gel on Damp Skin',
        instructions: 'Press gently onto damp skin to maximize deep moisture retention and support lipid matrix integrity.',
        amount: '2-3 pumps'
      };
      s3 = {
        step: '03',
        title: 'Richer Ceramide Barrier Moisturiser',
        instructions: 'Apply a richer ceramide barrier moisturiser to seal in hydration and help prevent overnight trans-epidermal water loss.',
        amount: 'Nickel-sized amount'
      };
    }
  } else {
    // BALANCE (default)
    if (normTab === 'AM') {
      s1 = {
        step: '01',
        title: 'Balancing Gel Cleanser',
        instructions: 'Wash with a gentle balancing gel cleanser that clears excess surface sebum without over-drying.',
        amount: '1 pump'
      };
      s2 = {
        step: '02',
        title: 'Garnier ClimaGuard Serum-Gel',
        instructions: 'Smooth over face. Niacinamide may help control excess oil while maintaining stratum corneum hydration.',
        amount: '1-2 pumps'
      };
      s3 = {
        step: '03',
        title: 'Light Oil-Free Gel Moisturiser + Matte SPF',
        instructions: 'Follow with a light oil-free gel moisturiser and matte-finish SPF for shine-free daily barrier protection.',
        amount: '2 finger lengths'
      };
    } else {
      s1 = {
        step: '01',
        title: 'Clarifying Gel Cleanser',
        instructions: 'Cleanse face with a gentle gel wash to dissolve daytime impurities and excess sebum.',
        amount: '1 pump'
      };
      s2 = {
        step: '02',
        title: 'Garnier ClimaGuard Serum-Gel',
        instructions: 'Apply a light layer to promote nighttime barrier comfort and moisture balance.',
        amount: '1-2 pumps'
      };
      s3 = {
        step: '03',
        title: 'Lightweight Gel Moisturiser',
        instructions: 'Hydrate with a fast-absorbing, non-sticky gel moisturiser that comforts skin without heaviness.',
        amount: 'Pea-sized amount'
      };
    }
  }

  const personalisedChips = [];
  const notes = [];

  // Symptom Modifiers
  if (isCombo) {
    personalisedChips.push('Personalised for: Combination skin (Oily + Tight)');
    notes.push('Combination skin: T-zone shine with barrier dehydration; using a lightweight hydrating gel with no heavy oils.');
    s1.instructions += ' Blot, do not over-cleanse.';
    s2.amount = '1 pump';
    s2.instructions += ' Apply on damp skin for lightweight hydration.';
    if (normTab === 'AM') {
      s3.title = 'Lightweight Hydrating Oil-Free Gel + Matte SPF';
      s3.instructions = 'Layer a lightweight hydrating gel with no heavy oils, then apply matte SPF to keep shine controlled.';
    } else {
      s3.title = 'Lightweight Hydrating Gel (No Heavy Oils)';
      s3.instructions = 'Uses a breathable water-gel with no heavy oils to hydrate tight zones while keeping oily areas shine-free.';
    }
  } else {
    if (hasOily) {
      personalisedChips.push('Personalised for: Oily / shiny skin');
      s1.instructions += ' Note: Blot, do not over-cleanse.';
      s2.amount = '1 pump';
      if (normTab === 'AM') {
        s3.title = 'Oil-Free Mattifying Gel + Matte SPF';
        s3.instructions = 'Swapped to a light oil-free gel plus matte SPF to maintain hydration without excess shine.';
      } else {
        s3.title = 'Oil-Free Light Gel Moisturiser';
        s3.instructions = 'Swapped to a breathable oil-free gel moisturiser that absorbs quickly without clogging pores.';
        s3.amount = 'Pea-sized amount';
      }
    }
    if (hasTight) {
      personalisedChips.push('Personalised for: Tight / dry skin');
      s1.title = 'Non-Foaming Cream Cleanser';
      s1.instructions = 'Swapped to a non-foaming cream cleanser to replenish dry stratum corneum lipids without stripping.';
      s1.amount = '1-2 pumps';
      s2.instructions += ' Apply the serum on damp skin to trap ambient moisture.';
      s3.instructions += ' Add a gentle hydration layer before moisturising to soothe barrier tightness.';
    }
  }

  if (hasDull) {
    personalisedChips.push('Personalised for: Dull / tired skin');
    s3.instructions += ' Tip: Daily sunscreen, hydration and sleep support radiance; avoid harsh scrubs.';
  }

  if (hasBreakouts) {
    personalisedChips.push('Personalised for: Breakout-prone skin');
    s1.instructions += ' Non-comedogenic and fragrance-free steps; do not pick at skin.';
    s3.instructions += ' Avoid heavy layering. If breakouts persist, consult a dermatologist.';
  }

  for (const st of [s1, s2, s3]) {
    st.desc = st.instructions;
    st.dose = st.amount;
  }

  return {
    steps: [s1, s2, s3],
    personalisedChips,
    notes
  };
}
window.getRoutine = getRoutine;

function runUnitTests() {
  console.group('ClimaCheck decideMode() & getRoutine() Unit Test Suite');
  const t1 = decideMode({ aqi: 205, uv: 3, humidity: 50 });
  console.assert(t1.mode === 'SHIELD', 'Test 1 Failed');
  const t2 = decideMode({ aqi: 150, uv: 6, humidity: 50 });
  console.assert(t2.mode === 'SHIELD', 'Test 2 Failed');
  const t3 = decideMode({ aqi: 150, uv: 5.9, humidity: 50 });
  console.assert(t3.mode === 'BALANCE', 'Test 3 Failed');
  const t4 = decideMode({ aqi: 120, uv: 4, humidity: 39 });
  console.assert(t4.mode === 'HYDRATE', 'Test 4 Failed');
  const t5 = decideMode({ aqi: 100, uv: 3, humidity: 40 });
  console.assert(t5.mode === 'BALANCE', 'Test 5 Failed');
  const t6 = decideMode({ aqi: 100, uv: 3, humidity: 55, skinFeel: { tight: true } });
  console.assert(t6.mode === 'HYDRATE', 'Test 6 Failed');
  const t7 = decideMode({ aqi: 90, uv: 4, humidity: 66 });
  console.assert(t7.mode === 'BALANCE', 'Test 7 Failed');
  const t8 = decideMode({ aqi: 90, uv: 4, humidity: 65 });
  console.assert(t8.mode === 'BALANCE' && t8.isDefault, 'Test 8 Failed');
  const t9 = decideMode({ aqi: 240, uv: 4, humidity: 30 });
  console.assert(t9.mode === 'SHIELD', 'Test 9 Failed');
  const t10 = decideMode({ aqi: 80, uv: 8, humidity: 75 });
  console.assert(t10.mode === 'SHIELD', 'Test 10 Failed');
  const t11 = decideMode({ aqi: 110, uv: 3, humidity: 35, skinFeel: { oily: true } });
  console.assert(t11.mode === 'HYDRATE', 'Test 11 Failed');
  const t12 = decideMode({ aqi: 85, uv: 4, humidity: 52, skinFeel: {} });
  console.assert(t12.mode === 'BALANCE' && t12.isDefault, 'Test 12 Failed');
  const t13 = decideMode({ aqi: 85, uv: 3, humidity: 50, symptoms: ['dull', 'breakouts'] });
  console.assert(t13.mode === 'BALANCE', 'Test 13 Failed');
  const t14 = decideMode({ aqi: 240, uv: 3, humidity: 50, symptoms: ['tight'] });
  console.assert(t14.overrideNote && t14.overrideNote.includes('Shield mode stays active'), 'Test 14 Failed');
  console.log('All decideMode() & getRoutine() unit tests passed successfully!');
  console.groupEnd();
}
runUnitTests();


// ============================================================================
// 5. DEMO PRESETS & KNOWN INDIAN CITIES
// ============================================================================
const DEMO_PRESETS = {
  delhi: {
    name: 'Delhi',
    label: 'Delhi (Winter Smog Crisis)',
    lat: 28.65195,
    lon: 77.23149,
    temp: 18.5,
    humidity: 35,
    pm25: 195.4,
    uv: 3.4,
    approx_aqi: 348,
    category: 'Very Poor'
  },
  mumbai: {
    name: 'Mumbai',
    label: 'Mumbai (Monsoon Inundation)',
    lat: 19.0760,
    lon: 72.8777,
    temp: 31.0,
    humidity: 88,
    pm25: 38.0,
    uv: 5.2,
    approx_aqi: 64,
    category: 'Satisfactory'
  },
  jaipur: {
    name: 'Jaipur',
    label: 'Jaipur (Arid Heatwave)',
    lat: 26.9124,
    lon: 75.7873,
    temp: 41.5,
    humidity: 19,
    pm25: 72.0,
    uv: 10.4,
    approx_aqi: 142,
    category: 'Moderate'
  },
  bengaluru: {
    name: 'Bengaluru',
    label: 'Bengaluru (High-Altitude Sun)',
    lat: 12.9716,
    lon: 77.5946,
    temp: 25.0,
    humidity: 52,
    pm25: 24.0,
    uv: 7.8,
    approx_aqi: 40,
    category: 'Good'
  },
  kolkata: {
    name: 'Kolkata',
    label: 'Kolkata (Humid Gangetic Basin)',
    lat: 22.5726,
    lon: 88.3639,
    temp: 32.2,
    humidity: 76,
    pm25: 86.0,
    uv: 5.8,
    approx_aqi: 187,
    category: 'Moderate'
  },
  chennai: {
    name: 'Chennai',
    label: 'Chennai (Coastal Coromandel)',
    lat: 13.0827,
    lon: 80.2707,
    temp: 33.5,
    humidity: 74,
    pm25: 32.0,
    uv: 8.2,
    approx_aqi: 54,
    category: 'Satisfactory'
  },
  pune: {
    name: 'Pune',
    label: 'Pune (Deccan Plateau)',
    lat: 18.5204,
    lon: 73.8567,
    temp: 28.0,
    humidity: 45,
    pm25: 58.0,
    uv: 6.1,
    approx_aqi: 97,
    category: 'Satisfactory'
  }
};

// ============================================================================
// 6. APPLICATION STATE
// ============================================================================
const appState = {
  selectedCity: 'Delhi',
  currentLocationName: 'Delhi, India',
  coords: { lat: 28.65195, lon: 77.23149 },
  temperature: 29,
  humidity: 38,
  pm25: 145.2,
  aqiData: { aqi: 320, category: 'Very Poor', color: 'rose' },
  uv: 4.2,
  bsi: { score: 78, tier: 'High Stress', color: 'rose', strokeColor: '#E11D48' },
  conditions: { approx_aqi: 320, uv: 4.2, humidity: 38, temperature: 29 },
  symptoms: new Set(),
  skinFeel: {
    oily: false,
    tight: false,
    dull: false,
    breakouts: false
  },
  activeTab: 'AM',
  activeRoutineTab: 'am',
  userSelectedTab: false,
  modeResult: null,
  isLoading: false,
  apiError: null,
  isDemoFallback: false,
  isSimulated: false
};

function computeDefaultTabForTime() {
  try {
    const kolkataStr = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
    const hour = parseInt(kolkataStr.split(':')[0], 10);
    return (hour >= 5 && hour < 18) ? 'AM' : 'PM';
  } catch (e) {
    const h = new Date().getHours();
    return (h >= 5 && h < 18) ? 'AM' : 'PM';
  }
}

function setDefaultTabOnCityLoad() {
  if (!appState.userSelectedTab) {
    appState.activeTab = computeDefaultTabForTime();
    appState.activeRoutineTab = appState.activeTab.toLowerCase();
  }
  updateRoutineTabButtons();
}
window.appState = appState;
window.fetchWeatherData = fetchWeatherData;
window.decideMode = decideMode;

// ============================================================================
// 7. MODE CONTENT & ROUTINE DEFINITIONS
// ============================================================================
const MODE_DETAILS = {
  SHIELD: {
    title: 'Shield Mode',
    tagline: 'High Environmental Stress Barrier Defense',
    themeColor: '#E11D48',
    badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
    cardBorder: 'border-rose-400',
    cardBg: 'from-rose-50 via-white to-amber-50',
    iconBg: 'bg-rose-500 text-white',
    svgIcon: `
      <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    `,
    summary: 'Elevated PM2.5 particulate pollution or UV radiation can trigger epidermal AhR pathways and accelerate reactive oxygen species (ROS). ClimaGuard\'s 2% Ectoin hydro-complex shield and 5% Niacinamide help protect against micro-particulate adhesion and calm skin feel.',
    routineAM: [
      {
        step: '01',
        title: 'Gentle Barrier-Preserving Cleanser',
        desc: 'Wash with lukewarm water and a low-pH, sulfate-free foaming gel. Clears overnight sebum without stripping natural protective ceramide bilayers.',
        dose: '1-2 pumps'
      },
      {
        step: '02',
        title: 'Garnier ClimaGuard Serum-Gel (Shield Dosing)',
        desc: 'Apply generously on clean, damp skin. Ectoin creates a protective osmolyte shield against PM2.5 deposition while Ceramide NP seals intercellular lipid lamellae.',
        dose: '2 generous pumps'
      },
      {
        step: '03',
        title: 'Broad-Spectrum Photoprotection SPF 50+ PA++++',
        desc: 'Broad-spectrum UV protection formulated with photostable Mexoryl filters to help protect against UVA/UVB photo-oxidation.',
        dose: '2 finger lengths'
      }
    ],
    routinePM: [
      {
        step: '01',
        title: 'Thorough Micro-Pollutant Cleanse',
        desc: 'Dissolve airborne PM2.5, stubborn grime, and mineral sunscreen residue using an ultra-gentle micellar wash followed by a foaming gel.',
        dose: 'Thorough rinse'
      },
      {
        step: '02',
        title: 'Garnier ClimaGuard Overnight Recovery',
        desc: 'Apply 2-3 pumps. High-potency Niacinamide supports ceramide production and overnight barrier recovery while skin sleeps.',
        dose: '2-3 pumps'
      },
      {
        step: '03',
        title: 'Lipid-Replenishing Squalane Emulsion',
        desc: 'Seal hydration with a lightweight, non-comedogenic sugarcane squalane cream to reinforce barrier recovery and reduce overnight TEWL.',
        dose: 'Pea-sized amount'
      }
    ]
  },
  HYDRATE: {
    title: 'Hydrate Mode',
    tagline: 'Deep Moisture Lock & Anti-TEWL Comfort',
    themeColor: '#0E8388',
    badgeClass: 'bg-cyan-100 text-cyan-800 border-cyan-300',
    cardBorder: 'border-cyan-400',
    cardBg: 'from-cyan-50 via-white to-blue-50',
    iconBg: 'bg-cyan-600 text-white',
    svgIcon: `
      <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
      </svg>
    `,
    summary: 'Arid air (humidity < 40%) or skin tightness accelerates Trans-Epidermal Water Loss (TEWL), dehydrating the stratum corneum and causing micro-fissures. Upcycled Sugarcane Squalane and biomimetic Ceramide NP bind water deep within epidermal strata.',
    routineAM: [
      {
        step: '01',
        title: 'Milky Hydrating Conditioning Wash',
        desc: 'Splash face with lukewarm water or use a soothing milky wash. Never use steaming water or harsh astringents which exacerbate water loss.',
        dose: 'Gentle splash'
      },
      {
        step: '02',
        title: 'Garnier ClimaGuard Water-Gel Infusion',
        desc: 'Smooth onto damp skin within 60 seconds of washing. The weightless gel immediately draws ambient moisture into keratinocytes.',
        dose: '2 full pumps'
      },
      {
        step: '03',
        title: 'Moisture-Locking Barrier SPF 50',
        desc: 'Layer an emollient moisturizing sunscreen containing sugarcane squalane to create an occlusive barrier against dry desert air.',
        dose: '2 finger lengths'
      }
    ],
    routinePM: [
      {
        step: '01',
        title: 'Ultra-Mild Conditioning Cleanse',
        desc: 'Gently massage a nourishing, non-stripping cleanser over skin. Pat dry softly with a clean microfiber towel without friction.',
        dose: '1 pump'
      },
      {
        step: '02',
        title: 'Garnier ClimaGuard Intensive Barrier Layer',
        desc: 'Apply 3 generous pumps to face and neck. Replenishes natural lipid lamellae disrupted by arid outdoor winds and dry indoor air-conditioning.',
        dose: '3 pumps'
      },
      {
        step: '03',
        title: 'Nutritive Squalane Barrier Balm',
        desc: 'Locks in hydration overnight. 100% plant-derived squalane mimics natural sebum to ensure zero waking tightness.',
        dose: 'Dime-sized amount'
      }
    ]
  },
  BALANCE: {
    title: 'Balance Mode',
    tagline: 'Lightweight Sebum Control & Everyday Resilience',
    themeColor: '#10B981',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    cardBorder: 'border-emerald-400',
    cardBg: 'from-emerald-50 via-white to-teal-50',
    iconBg: 'bg-emerald-600 text-white',
    svgIcon: `
      <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
      </svg>
    `,
    summary: 'Tropical humidity (> 65%) or active sebum synthesis promotes mid-day facial shine and pore congestion. 5% Niacinamide may help control excess oil while keeping the acid mantle resilient and breathable.',
    routineAM: [
      {
        step: '01',
        title: 'Balancing Purifying Gel Cleanser',
        desc: 'Cleanse with a refreshing gel wash containing mild amino-acid surfactants to melt away overnight perspiration and excess surface oil.',
        dose: '1 pump'
      },
      {
        step: '02',
        title: 'Garnier ClimaGuard Serum-Gel (Matte Finish)',
        desc: 'Fast-absorbing, zero-residue water-gel texture. Niacinamide tightens pore appearance and normalizes sebum production with zero stickiness.',
        dose: '1-2 pumps'
      },
      {
        step: '03',
        title: 'Invisible Fluid Matte Sunscreen SPF 50',
        desc: 'Feather-light, dry-touch UV protection. Non-comedogenic and sweat-resistant formulation designed specifically for Indian tropical climates.',
        dose: '2 finger lengths'
      }
    ],
    routinePM: [
      {
        step: '01',
        title: 'Deep Clarifying Double Rinse',
        desc: 'Wash away urban sweat, micro-dust, and daytime sunscreen buildup to help protect against clogged follicles and humidity-induced blemishes.',
        dose: 'Thorough cleanse'
      },
      {
        step: '02',
        title: 'Garnier ClimaGuard Serum-Gel',
        desc: 'Smooth over face and neck. Delivers cellular hydration and calming bio-ferments without suffocating oil-prone skin.',
        dose: '2 pumps'
      },
      {
        step: '03',
        title: 'Weightless Water-Cream Moisturiser',
        desc: 'An oil-free, breathable gel emulsion to seal hydration overnight without any heavy film or morning oiliness.',
        dose: 'Pea-sized amount'
      }
    ]
  }
};

// ============================================================================
// 8. TELEMETRY FETCHING & SIMULATION CONTROLLER
// ============================================================================
async function fetchWeatherData(lat, lon, cityName = 'Delhi') {
  setLoadingState(true);
  appState.apiError = null;

  try {
    let success = false;

    // 1. Try FastAPI backend /api/conditions
    try {
      let apiUrl = `/api/conditions?city=${encodeURIComponent(cityName)}`;
      if (lat !== undefined && lon !== undefined && lat !== null && lon !== null) {
        apiUrl += `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const apiRes = await fetch(apiUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (apiRes.ok) {
        const data = await apiRes.json();
        appState.temperature = Math.round(data.temperature ?? 28);
        appState.humidity = Math.round(data.humidity ?? 50);
        appState.pm25 = data.pm2_5 ?? 45;
        appState.uv = Math.round((data.uv ?? 4) * 10) / 10;
        appState.aqiData = {
          aqi: data.approx_aqi,
          category: data.aqi_category,
          color: getCategoryColor(data.aqi_category),
          pm25: data.pm2_5,
          label: `${data.aqi_category} (${data.approx_aqi})`
        };
        appState.bsi = calculateClientBSI(appState.pm25, appState.uv, appState.humidity, appState.temperature);
        appState.isDemoFallback = false;
        appState.isSimulated = false;
        setActivePresetBtn(null);
        success = true;
      }
    } catch (backendErr) {
      console.info('Backend bypassed, trying client direct Open-Meteo:', backendErr.message);
    }

    // 2. Direct Open-Meteo API fallback
    if (!success) {
      try {
        let fetchLat = lat;
        let fetchLon = lon;
        if (fetchLat === null || fetchLat === undefined || fetchLon === null || fetchLon === undefined) {
          const preset = DEMO_PRESETS[cityName.toLowerCase()] || DEMO_PRESETS.delhi;
          fetchLat = preset.lat;
          fetchLon = preset.lon;
        }

        const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${fetchLat}&longitude=${fetchLon}&current=temperature_2m,relative_humidity_2m&timezone=auto`;
        const airQualityUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${fetchLat}&longitude=${fetchLon}&current=pm2_5,uv_index&timezone=auto`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const [forecastRes, airRes] = await Promise.all([
          fetch(forecastUrl, { signal: controller.signal }),
          fetch(airQualityUrl, { signal: controller.signal })
        ]);
        clearTimeout(timeoutId);

        if (forecastRes.ok && airRes.ok) {
          const forecastData = await forecastRes.json();
          const airData = await airRes.json();

          const currentForecast = forecastData.current || {};
          const currentAir = airData.current || {};

          appState.temperature = Math.round(currentForecast.temperature_2m ?? 28);
          appState.humidity = Math.round(currentForecast.relative_humidity_2m ?? 50);
          appState.pm25 = currentAir.pm2_5 ?? 45;
          appState.uv = Math.round((currentAir.uv_index ?? 4) * 10) / 10;
          appState.aqiData = calculateCPCB_AQI(appState.pm25);
          appState.bsi = calculateClientBSI(appState.pm25, appState.uv, appState.humidity, appState.temperature);
          appState.isDemoFallback = false;
          appState.isSimulated = false;
          setActivePresetBtn(null);
          success = true;
        }
      } catch (clientErr) {
        console.warn('Direct Open-Meteo failed, using preset telemetry:', clientErr);
      }
    }

    // 3. Cached city fallback if both failed
    if (!success) {
      applyPresetTelemetry(cityName.toLowerCase());
      appState.apiError = 'Using offline telemetry for ' + cityName;
      appState.isDemoFallback = true;
      appState.isSimulated = true;
    }

    setDefaultTabOnCityLoad();
    await updateUI();
  } catch (err) {
    console.error('Error in fetchWeatherData:', err);
    applyPresetTelemetry(cityName.toLowerCase());
    await updateUI();
  } finally {
    setLoadingState(false);
  }
}

function applyPresetTelemetry(presetKey) {
  const preset = DEMO_PRESETS[presetKey] || DEMO_PRESETS.delhi;
  appState.temperature = Math.round(preset.temp);
  appState.humidity = Math.round(preset.humidity);
  appState.pm25 = preset.pm25;
  appState.uv = preset.uv;
  const calculated = calculateCPCB_AQI(preset.pm25);
  const finalAqi = preset.approx_aqi ?? calculated.aqi;
  const finalCategory = preset.category ?? calculated.category;
  appState.aqiData = {
    aqi: finalAqi,
    category: finalCategory,
    color: getCategoryColor(finalCategory),
    pm25: preset.pm25,
    label: `${finalCategory} (${finalAqi})`
  };
  appState.bsi = calculateClientBSI(preset.pm25, preset.uv, preset.humidity, preset.temp);
}

function getCategoryColor(cat) {
  switch (cat) {
    case 'Good': return 'emerald';
    case 'Satisfactory': return 'teal';
    case 'Moderate': return 'amber';
    case 'Poor': return 'orange';
    case 'Very Poor': return 'rose';
    default: return 'purple';
  }
}

// ============================================================================
// 9. PROGRESS TRACKER & STORAGE
// ============================================================================
const STORAGE_KEY = 'climacheck_barrier_logs_v3';

function getStoredLogs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveCheckIn(comfortScore, routineDone) {
  const logs = getStoredLogs();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const existingIndex = logs.findIndex(l => l.dateStr === todayStr);
  const entry = {
    dateStr: todayStr,
    dayName: days[today.getDay()],
    comfort: parseInt(comfortScore, 10),
    hydration: appState.humidity < 40 ? 'Dehydrated' : (appState.humidity > 65 ? 'Humid' : 'Normal'),
    routineDone: !!routineDone,
    mode: appState.modeResult ? appState.modeResult.mode : 'BALANCE',
    timestamp: Date.now()
  };

  if (existingIndex >= 0) {
    logs[existingIndex] = entry;
  } else {
    logs.push(entry);
  }

  const trimmed = logs.slice(-14);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  renderTrackerUI();

  // Reset form inputs after logging
  const form = document.getElementById('checkin-form');
  if (form) {
    form.reset();
  }

  // Sync to backend /api/checkins (Supabase-backed if configured)
  try {
    fetch('/api/checkins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: todayStr,
        comfort: parseInt(comfortScore, 10),
        hydration: entry.hydration,
        routine_done: !!routineDone,
        mode: (appState.modeResult ? appState.modeResult.mode : 'BALANCE').toLowerCase()
      })
    }).catch(() => {});
  } catch (err) {}
}

function calculateStreak(logs) {
  if (!logs || logs.length === 0) return 0;
  const sorted = [...logs].sort((a, b) => new Date(b.dateStr) - new Date(a.dateStr));
  let streak = 0;
  for (const log of sorted) {
    if (log.routineDone || log.comfort > 0) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// ============================================================================
// 10. UI RENDERING & COMPONENT CONTROLLERS
// ============================================================================
function setLoadingState(loading) {
  appState.isLoading = loading;
  const modeCard = document.getElementById('mode-card-container');
  if (modeCard) {
    if (loading) modeCard.classList.add('opacity-80');
    else modeCard.classList.remove('opacity-80');
  }
}

async function updateUI() {
  appState.conditions = {
    approx_aqi: appState.aqiData ? appState.aqiData.aqi : 0,
    uv: appState.uv,
    humidity: appState.humidity,
    temperature: appState.temperature
  };

  // 1. Instant local decision
  const localDecision = decideMode({
    aqi: appState.aqiData ? appState.aqiData.aqi : 0,
    uv: appState.uv,
    humidity: appState.humidity,
    symptoms: appState.symptoms,
    skinFeel: appState.skinFeel
  });
  appState.modeResult = localDecision;

  // 2. Location label
  const locEl = document.getElementById('current-city-label');
  if (locEl) locEl.textContent = appState.currentLocationName;

  // 3. Error Banner
  const errorBanner = document.getElementById('api-status-banner');
  if (errorBanner) {
    if (appState.isDemoFallback || appState.apiError) {
      errorBanner.classList.remove('hidden');
      const msg = document.getElementById('api-status-text');
      if (msg) msg.textContent = appState.apiError || 'Using cached city telemetry';
    } else {
      errorBanner.classList.add('hidden');
    }
  }

  // 4. Update tab button state visually
  updateRoutineTabButtons();

  // 5. Render Weather & BSI dial
  renderConditionsAndBSI();

  // 6. Render Mode Card & Routine
  renderModeCard(localDecision);

  // 7. Update Skin Feel Toggles
  updateSkinFeelToggles();

  // 8. Verify with backend /api/recommend if available
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000);
    const recRes = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conditions: appState.conditions,
        symptoms: Array.from(appState.symptoms),
        tab: appState.activeTab
      }),
      signal: controller.signal
    });
    clearTimeout(t);

    if (recRes.ok) {
      const recData = await recRes.json();
      appState.modeResult = {
        mode: recData.mode.toUpperCase(),
        reasons: recData.reasons,
        allTriggers: recData.all_triggered_rules,
        overrideNote: recData.override_note,
        serverRoutine: recData.routine
      };
      renderModeCard(appState.modeResult);
    }
  } catch (e) {
    // Graceful silent fallback to local getRoutine
  }
}

function updateRoutineTabButtons() {
  const amTabBtn = document.getElementById('tab-routine-am');
  const pmTabBtn = document.getElementById('tab-routine-pm');
  if (amTabBtn && pmTabBtn) {
    const isPM = (appState.activeTab === 'PM' || appState.activeRoutineTab === 'pm');
    if (isPM) {
      pmTabBtn.className = 'px-3 py-1 rounded-lg bg-emerald-800 text-white shadow-xs transition-all font-semibold';
      amTabBtn.className = 'px-3 py-1 rounded-lg text-gray-600 hover:text-gray-900 transition-all font-semibold';
    } else {
      amTabBtn.className = 'px-3 py-1 rounded-lg bg-emerald-800 text-white shadow-xs transition-all font-semibold';
      pmTabBtn.className = 'px-3 py-1 rounded-lg text-gray-600 hover:text-gray-900 transition-all font-semibold';
    }
  }
}

function renderConditionsAndBSI() {
  // Telemetry status badge & card source pills ("Simulated" vs "Live")
  const teleTag = document.getElementById('telemetry-mode-tag');
  if (teleTag) {
    if (appState.isSimulated) {
      teleTag.textContent = 'Simulated';
      teleTag.className = 'text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300';
    } else {
      teleTag.textContent = 'Live';
      teleTag.className = 'text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300';
    }
  }

  const sourcePills = document.querySelectorAll('.telemetry-source-pill');
  sourcePills.forEach(pill => {
    if (appState.isSimulated) {
      pill.textContent = 'Simulated';
      pill.className = 'telemetry-source-pill text-[7.5px] font-extrabold uppercase px-1 rounded bg-amber-100 text-amber-900 border border-amber-200';
    } else {
      pill.textContent = 'Live';
      pill.className = 'telemetry-source-pill text-[7.5px] font-extrabold uppercase px-1 rounded bg-emerald-100 text-emerald-800';
    }
  });

  // AQI
  const aqiValEl = document.getElementById('aqi-value');
  const aqiBadgeEl = document.getElementById('aqi-badge');
  const { aqi, category, color } = appState.aqiData;
  if (aqiValEl) aqiValEl.textContent = aqi;
  if (aqiBadgeEl) {
    aqiBadgeEl.textContent = category;
    let badgeClass = 'bg-rose-100 text-rose-800 border-rose-300';
    if (color === 'emerald') badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
    else if (color === 'teal') badgeClass = 'bg-teal-100 text-teal-800 border-teal-300';
    else if (color === 'amber') badgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
    else if (color === 'orange') badgeClass = 'bg-orange-100 text-orange-800 border-orange-300';
    aqiBadgeEl.className = `text-[9px] font-extrabold px-1.5 py-0.5 rounded-full border ${badgeClass}`;
  }

  // UV
  const uvValEl = document.getElementById('uv-value');
  const uvBadgeEl = document.getElementById('uv-badge');
  if (uvValEl) uvValEl.textContent = appState.uv;
  if (uvBadgeEl) {
    let uvText = 'Low';
    let uvClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
    if (appState.uv >= 8) {
      uvText = 'Very High';
      uvClass = 'bg-rose-100 text-rose-800 border-rose-300';
    } else if (appState.uv >= 6) {
      uvText = 'High (Shield)';
      uvClass = 'bg-orange-100 text-orange-800 border-orange-300';
    } else if (appState.uv >= 3) {
      uvText = 'Moderate';
      uvClass = 'bg-amber-100 text-amber-800 border-amber-300';
    }
    uvBadgeEl.textContent = uvText;
    uvBadgeEl.className = `text-[9px] font-extrabold px-1.5 py-0.5 rounded-full border ${uvClass}`;
  }

  // Temperature & Humidity
  const tempValEl = document.getElementById('temp-value');
  const humidityValEl = document.getElementById('humidity-value');
  const humidityBarEl = document.getElementById('humidity-bar-fill');
  if (tempValEl) tempValEl.textContent = `${appState.temperature}°C`;
  if (humidityValEl) humidityValEl.textContent = `${appState.humidity}%`;
  if (humidityBarEl) {
    humidityBarEl.style.width = `${Math.min(100, Math.max(10, appState.humidity))}%`;
  }

  // BSI Gauge
  const bsiScoreEl = document.getElementById('bsi-score-value');
  const bsiTierEl = document.getElementById('bsi-tier-badge');
  const bsiCircle = document.getElementById('bsi-gauge-circle');
  const pmPtsEl = document.getElementById('bsi-pm-pts');
  const uvPtsEl = document.getElementById('bsi-uv-pts');
  const humidityPtsEl = document.getElementById('bsi-humidity-pts') || document.getElementById('bsi-tewl-pts');

  const bsi = appState.bsi;
  if (bsiScoreEl) bsiScoreEl.textContent = bsi.score;
  if (bsiTierEl) {
    bsiTierEl.textContent = bsi.tier;
    let bsiClass = 'bg-rose-100 text-rose-800 border-rose-300';
    if (bsi.color === 'emerald') bsiClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
    else if (bsi.color === 'teal') bsiClass = 'bg-teal-100 text-teal-800 border-teal-300';
    else if (bsi.color === 'amber') bsiClass = 'bg-amber-100 text-amber-800 border-amber-300';
    bsiTierEl.className = `text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${bsiClass}`;
  }

  if (bsiCircle) {
    // Perimeter of r=40 circle is 2 * PI * 40 ~= 251.2
    const totalCircumference = 251.2;
    const offset = totalCircumference - (bsi.score / 100) * totalCircumference;
    bsiCircle.style.strokeDashoffset = offset;
    bsiCircle.setAttribute('stroke', bsi.strokeColor);
  }

  if (pmPtsEl && bsi.breakdown) pmPtsEl.textContent = `${bsi.breakdown.pm} pts`;
  if (uvPtsEl && bsi.breakdown) uvPtsEl.textContent = `${bsi.breakdown.uv} pts`;
  if (humidityPtsEl && bsi.breakdown) {
    const humValue = bsi.breakdown.humidity ?? bsi.breakdown.tewl;
    humidityPtsEl.textContent = `${humValue} pts`;
  }
}

function renderModeCardAndRoutine() {
  const localDecision = decideMode({
    aqi: appState.aqiData ? appState.aqiData.aqi : 0,
    uv: appState.uv,
    humidity: appState.humidity,
    symptoms: appState.symptoms,
    skinFeel: appState.skinFeel
  });
  appState.modeResult = localDecision;
  renderModeCard(localDecision);
}

function renderModeCard(modeDecision) {
  const modeData = MODE_DETAILS[modeDecision.mode] || MODE_DETAILS.BALANCE;
  const container = document.getElementById('mode-card-container');
  const titleEl = document.getElementById('mode-title');
  const taglineEl = document.getElementById('mode-tagline');
  const summaryEl = document.getElementById('mode-summary');
  const iconWrapper = document.getElementById('mode-icon-wrapper');
  const badgeEl = document.getElementById('mode-badge');
  const reasonsWrapper = document.getElementById('mode-reasons-list');
  const overrideEl = document.getElementById('mode-override-note');

  if (container) {
    container.className = `rounded-3xl p-5 sm:p-7 border-2 shadow-lg transition-all duration-500 bg-gradient-to-br ${modeData.cardBg} ${modeData.cardBorder} group relative overflow-hidden`;
  }

  if (titleEl) titleEl.textContent = modeData.title;
  if (taglineEl) taglineEl.textContent = modeData.tagline;
  if (summaryEl) summaryEl.textContent = modeData.summary;

  if (iconWrapper) {
    iconWrapper.className = `w-13 h-13 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shadow-md transition-transform duration-300 group-hover:scale-105 ${modeData.iconBg}`;
    iconWrapper.innerHTML = modeData.svgIcon;
  }

  if (badgeEl) {
    badgeEl.className = `inline-block text-[10px] sm:text-xs uppercase tracking-wider font-extrabold px-3 py-1 rounded-full border shadow-xs ${modeData.badgeClass}`;
    badgeEl.textContent = `Today's Priority: ${modeDecision.mode}`;
  }

  // Render "WHY" Reason Chips (show all triggered rules)
  if (reasonsWrapper) {
    reasonsWrapper.innerHTML = '';
    const chipsToShow = modeDecision.allTriggers || modeDecision.reasons || [];
    chipsToShow.forEach(reason => {
      const chip = document.createElement('span');
      chip.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/95 border border-gray-200 text-gray-800 shadow-xs animate-fade-in';
      chip.innerHTML = `
        <svg class="w-3.5 h-3.5 text-emerald-700 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
        </svg>
        <span>${reason}</span>
      `;
      reasonsWrapper.appendChild(chip);
    });
  }

  // Render Override Note if higher priority rule kept mode active
  if (overrideEl) {
    if (modeDecision.overrideNote) {
      overrideEl.textContent = modeDecision.overrideNote;
      overrideEl.classList.remove('hidden');
    } else {
      overrideEl.classList.add('hidden');
    }
  }

  // Render Steps
  renderRoutineSteps();
}

function renderRoutineSteps() {
  const mode = (appState.modeResult && appState.modeResult.mode) ? appState.modeResult.mode : 'BALANCE';
  const tab = appState.activeTab || (appState.activeRoutineTab === 'pm' ? 'PM' : 'AM');
  const routineData = getRoutine(mode, tab, appState.symptoms);

  const container = document.getElementById('routine-steps-container');
  if (!container) return;

  container.innerHTML = '';

  // 1. Personalised Chips
  if (routineData.personalisedChips && routineData.personalisedChips.length > 0) {
    const chipsWrapper = document.createElement('div');
    chipsWrapper.className = 'flex flex-wrap gap-1.5 pb-1';
    routineData.personalisedChips.forEach(chipText => {
      const chip = document.createElement('span');
      chip.className = 'inline-flex items-center gap-1 text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300 px-2.5 py-0.5 rounded-full';
      chip.textContent = chipText;
      chipsWrapper.appendChild(chip);
    });
    container.appendChild(chipsWrapper);
  }

  // 2. Combination Skin / Special Notes
  if (routineData.notes && routineData.notes.length > 0) {
    routineData.notes.forEach(noteText => {
      const noteBox = document.createElement('div');
      noteBox.className = 'text-[11px] p-2.5 rounded-xl bg-teal-50 border border-teal-200 text-teal-900 leading-relaxed font-medium';
      noteBox.textContent = noteText;
      container.appendChild(noteBox);
    });
  }

  // 3. Render 3 Step Cards
  routineData.steps.forEach(step => {
    const card = document.createElement('div');
    card.className = 'flex items-start gap-3 p-3.5 rounded-2xl bg-white/90 border border-gray-200 shadow-xs hover:border-emerald-400 transition-all';
    card.innerHTML = `
      <div class="flex-shrink-0 w-8 h-8 rounded-xl bg-emerald-50 text-emerald-800 font-extrabold text-xs flex items-center justify-center border border-emerald-200 shadow-xs">
        ${step.step}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-1">
          <h4 class="text-xs sm:text-sm font-bold text-gray-900 leading-snug truncate">${step.title}</h4>
          ${step.amount ? `<span class="text-[9px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full flex-shrink-0">${step.amount}</span>` : ''}
        </div>
        <p class="text-[11px] sm:text-xs text-gray-600 mt-0.5 leading-relaxed">${step.instructions}</p>
      </div>
    `;
    container.appendChild(card);
  });
}

function updateSkinFeelToggles() {
  const toggles = ['oily', 'tight', 'dull', 'breakouts'];
  toggles.forEach(key => {
    const btn = document.getElementById(`toggle-${key}`);
    if (!btn) return;
    const isActive = appState.symptoms.has(key);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    if (isActive) {
      btn.className = 'flex flex-col items-center justify-center p-3 rounded-2xl border bg-emerald-900 text-white border-emerald-900 text-center gap-1 shadow-sm transition-all';
    } else {
      btn.className = 'flex flex-col items-center justify-center p-3 rounded-2xl border border-gray-200 bg-white hover:border-emerald-500 transition-all text-gray-700 text-center gap-1 group shadow-xs';
    }
  });

  const clearBtn = document.getElementById('btn-clear-symptoms');
  if (clearBtn) {
    if (appState.symptoms.size > 0) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
  }
}

function renderTrackerUI() {
  const logs = getStoredLogs();
  const chartEl = document.getElementById('tracker-mini-chart');
  const streakEl = document.getElementById('tracker-streak-count');
  const totalDaysEl = document.getElementById('tracker-total-count');

  // Start empty with "No check-ins yet", no streak badge
  if (!logs || logs.length === 0) {
    if (streakEl) {
      streakEl.classList.add('hidden');
      streakEl.textContent = '0 Days';
    }
    if (totalDaysEl) {
      totalDaysEl.textContent = 'No check-ins yet';
    }
    if (chartEl) {
      chartEl.innerHTML = `
        <div class="w-full h-20 flex flex-col items-center justify-center text-center text-gray-400 py-2">
          <p class="text-xs font-semibold text-gray-600">No check-ins yet</p>
          <p class="text-[10px] text-gray-400 mt-0.5">Select a rating (1 to 5) and log today's check-in below to start your streak.</p>
        </div>
      `;
    }
    return;
  }

  // After user logs check-ins: Show streak badge and bars
  if (streakEl) {
    const streak = calculateStreak(logs);
    streakEl.classList.remove('hidden');
    streakEl.textContent = `${streak} Day${streak === 1 ? '' : 's'} Streak`;
  }
  if (totalDaysEl) {
    totalDaysEl.textContent = `${logs.length} check-in${logs.length === 1 ? '' : 's'} logged`;
  }

  if (chartEl) {
    chartEl.innerHTML = '';
    const last7 = logs.slice(-7);
    const displayDays = [...last7];
    while (displayDays.length < 7) {
      displayDays.unshift({ dayName: '-', comfort: 0, routineDone: false });
    }

    displayDays.forEach(day => {
      const col = document.createElement('div');
      col.className = 'flex flex-col items-center flex-1 h-20 justify-end gap-1';

      const heightPercent = day.comfort > 0 ? (day.comfort / 5) * 100 : 8;
      let barColor = 'bg-gray-200';
      if (day.comfort >= 4) barColor = 'bg-emerald-500';
      else if (day.comfort === 3) barColor = 'bg-teal-400';
      else if (day.comfort > 0) barColor = 'bg-amber-400';

      col.innerHTML = `
        <div class="relative w-full flex items-end justify-center h-16 bg-gray-100 rounded-md p-0.5">
          <div class="w-full ${barColor} rounded transition-all duration-500" style="height: ${heightPercent}%;"></div>
          ${day.routineDone ? '<span class="absolute top-0.5 text-[8px] text-emerald-800 font-bold">✓</span>' : ''}
        </div>
        <span class="text-[9px] font-semibold text-gray-500">${day.dayName}</span>
      `;
      chartEl.appendChild(col);
    });
  }
}

function setActiveChip(cityName) {
  const chipButtons = document.querySelectorAll('.city-chip-btn');
  chipButtons.forEach(btn => {
    const chipCity = btn.getAttribute('data-city');
    if (chipCity && cityName && chipCity.toLowerCase() === cityName.toLowerCase()) {
      btn.className = 'city-chip-btn chip-active text-xs px-2.5 py-1 rounded-full border transition-all font-semibold';
    } else {
      btn.className = 'city-chip-btn text-xs px-2.5 py-1 rounded-full bg-white hover:bg-emerald-50 text-gray-700 hover:text-emerald-900 border border-gray-200 transition-all';
    }
  });
}

function setActivePresetBtn(presetKey) {
  const presetButtons = document.querySelectorAll('.preset-sim-btn');
  presetButtons.forEach(btn => {
    const p = btn.getAttribute('data-preset');
    if (p && presetKey && p.toLowerCase() === presetKey.toLowerCase()) {
      btn.className = 'preset-sim-btn preset-chip-active text-[11px] px-2.5 py-1 rounded-full bg-amber-400 text-emerald-950 font-bold transition-all flex items-center gap-1 shadow-xs';
    } else {
      btn.className = 'preset-sim-btn text-[11px] px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-emerald-100 font-semibold border border-white/20 transition-all flex items-center gap-1';
    }
  });
}

// ============================================================================
// 11. SEARCH & AUTOCOMPLETE
// ============================================================================
let searchDebounceTimer = null;
async function searchCity(query) {
  if (!query || query.trim().length < 2) {
    hideSearchResults();
    return;
  }

  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=8&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    const results = data.results || [];

    results.sort((a, b) => {
      if (a.country_code === 'IN' && b.country_code !== 'IN') return -1;
      if (a.country_code !== 'IN' && b.country_code === 'IN') return 1;
      return 0;
    });

    renderSearchResults(results);
  } catch (err) {
    console.error('Geocoding search failed:', err);
  }
}

function renderSearchResults(results) {
  const listEl = document.getElementById('search-results-list');
  if (!listEl) return;

  listEl.innerHTML = '';
  if (results.length === 0) {
    listEl.innerHTML = '<li class="p-3 text-xs text-gray-500 text-center">No matching Indian cities found.</li>';
    listEl.classList.remove('hidden');
    return;
  }

  results.forEach(item => {
    const li = document.createElement('li');
    li.className = 'p-3 hover:bg-emerald-50 cursor-pointer border-b border-gray-100 last:border-none flex items-center justify-between transition-colors';
    const isIndia = item.country_code === 'IN';
    li.innerHTML = `
      <div>
        <span class="font-bold text-gray-800 text-xs sm:text-sm">${item.name}</span>
        <span class="text-[11px] text-gray-500 ml-1.5">${item.admin1 || ''}${item.country ? ', ' + item.country : ''}</span>
      </div>
      ${isIndia ? '<span class="text-[9px] font-extrabold uppercase px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded">India</span>' : ''}
    `;

    li.addEventListener('click', () => {
      appState.isSimulated = false;
      setActivePresetBtn(null);
      appState.currentLocationName = `${item.name}${item.admin1 ? ', ' + item.admin1 : ''}`;
      appState.selectedCity = item.name;
      appState.coords = { lat: item.latitude, lon: item.longitude };
      hideSearchResults();
      const inputEl = document.getElementById('city-search-input');
      if (inputEl) inputEl.value = item.name;
      const locLabel = document.getElementById('current-city-label');
      if (locLabel) locLabel.textContent = `${item.name}, India`;
      setActiveChip(item.name);
      fetchWeatherData(item.latitude, item.longitude, item.name);
    });

    listEl.appendChild(li);
  });

  listEl.classList.remove('hidden');
}

function hideSearchResults() {
  const listEl = document.getElementById('search-results-list');
  if (listEl) listEl.classList.add('hidden');
}

// ============================================================================
// 12. INITIALIZATION & EVENT LISTENERS
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  // 1. Initial State Render (Immediately renders with zero blank screens!)
  applyPresetTelemetry('delhi');
  appState.currentLocationName = 'Delhi, India';
  renderConditionsAndBSI();
  renderModeCard(decideMode({
    aqi: appState.aqiData.aqi,
    uv: appState.uv,
    humidity: appState.humidity,
    skinFeel: appState.skinFeel
  }));
  renderTrackerUI();

  // 2. Probe backend /api/health (Show badge ONLY when backend health check succeeds)
  const backendBadge = document.getElementById('backend-status-badge');
  const beaconLabel = document.getElementById('telemetry-status-label');
  fetch('/api/health')
    .then(r => r.json())
    .then(health => {
      if (health && health.status === 'ok') {
        if (backendBadge) {
          backendBadge.classList.remove('hidden');
          backendBadge.classList.add('flex');
        }
        if (beaconLabel) beaconLabel.textContent = 'FastAPI Engine Active';
      } else {
        if (backendBadge) {
          backendBadge.classList.add('hidden');
          backendBadge.classList.remove('flex');
        }
      }
    })
    .catch(() => {
      if (backendBadge) {
        backendBadge.classList.add('hidden');
        backendBadge.classList.remove('flex');
      }
    });

  // 3. Fetch real live weather for Delhi
  fetchWeatherData(28.65195, 77.23149, 'Delhi');

  // 4. Climate Extreme Simulator Presets
  const presetButtons = document.querySelectorAll('.preset-sim-btn');
  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const presetKey = btn.getAttribute('data-preset');
      setActivePresetBtn(presetKey);
      appState.isSimulated = true;

      // Apply exact values of preset immediately so all cards update synchronously
      const preset = DEMO_PRESETS[presetKey];
      if (preset) {
        appState.selectedCity = preset.name;
        appState.currentLocationName = preset.label;
        applyPresetTelemetry(presetKey);
        const searchInput = document.getElementById('city-search-input');
        if (searchInput) searchInput.value = preset.name;
        setActiveChip(preset.name);
      }
      updateUI();

      // Call backend /api/simulate if available for server-validated routine & reasons
      fetch(`/api/simulate?preset=${presetKey}`)
        .then(r => r.json())
        .then(data => {
          if (data.status === 'success') {
            const t = data.telemetry;
            appState.selectedCity = t.city;
            appState.currentLocationName = data.scenario_title;
            appState.temperature = Math.round(t.temperature);
            appState.humidity = Math.round(t.humidity);
            appState.pm25 = t.pm2_5;
            appState.uv = t.uv;
            appState.aqiData = {
              aqi: t.approx_aqi,
              category: t.aqi_category,
              color: getCategoryColor(t.aqi_category),
              pm25: t.pm2_5,
              label: `${t.aqi_category} (${t.approx_aqi})`
            };
            appState.bsi = calculateClientBSI(t.pm2_5, t.uv, t.humidity, t.temperature);
            appState.isSimulated = true;
            const searchInput = document.getElementById('city-search-input');
            if (searchInput) searchInput.value = t.city;
            setActiveChip(t.city);
            updateUI();
          }
        })
        .catch(() => {
          appState.isSimulated = true;
          updateUI();
        });
    });
  });

  // 5. Live GPS button
  const liveGpsBtn = document.getElementById('btn-live-gps-mode');
  if (liveGpsBtn) {
    liveGpsBtn.addEventListener('click', () => {
      setActivePresetBtn(null);
      appState.isSimulated = false;
      fetchWeatherData(28.65195, 77.23149, 'Delhi');
    });
  }

  // 6. City Search Input
  const searchInput = document.getElementById('city-search-input');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (query) {
          hideSearchResults();
          setActivePresetBtn(null);
          appState.isSimulated = false;
          appState.selectedCity = query;
          appState.currentLocationName = `${query}, India`;
          setActiveChip(query);
          fetchWeatherData(null, null, query);
        }
      }
    });

    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        searchCity(e.target.value);
      }, 300);
    });

    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target)) {
        hideSearchResults();
      }
    });
  }

  // 7. Metro City Quick Chips
  const chipButtons = document.querySelectorAll('.city-chip-btn');
  chipButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const cityName = btn.getAttribute('data-city');
      const preset = DEMO_PRESETS[cityName.toLowerCase()];
      if (preset) {
        setActivePresetBtn(null);
        appState.isSimulated = false;
        appState.selectedCity = cityName;
        appState.currentLocationName = `${preset.name}, India`;
        appState.coords = { lat: preset.lat, lon: preset.lon };
        if (searchInput) searchInput.value = cityName;
        setActiveChip(cityName);
        fetchWeatherData(preset.lat, preset.lon, cityName);
      }
    });
  });

  // 8. "GPS Location" Button
  const geoBtn = document.getElementById('btn-use-location');
  if (geoBtn) {
    geoBtn.addEventListener('click', () => {
      setActivePresetBtn(null);
      appState.isSimulated = false;
      const showGpsError = (msg) => {
        geoBtn.classList.remove('animate-pulse');
        const statusBanner = document.getElementById('api-status-banner');
        const statusText = document.getElementById('api-status-text');
        if (statusBanner && statusText) {
          statusText.textContent = msg;
          statusBanner.classList.remove('hidden');
        }
        alert(msg);
      };

      if (!navigator.geolocation) {
        showGpsError('Geolocation is not supported by your browser.');
        return;
      }
      geoBtn.classList.add('animate-pulse');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          geoBtn.classList.remove('animate-pulse');
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          appState.currentLocationName = 'My GPS Location';
          appState.coords = { lat, lon };
          if (searchInput) searchInput.value = 'Current Location';
          fetchWeatherData(lat, lon, 'Local Area');
        },
        (err) => {
          console.warn('GPS denied or unavailable:', err);
          showGpsError('GPS location permission denied. Falling back to selected city.');
        },
        { timeout: 7000 }
      );
    });
  }

  // 9. AM / PM Routine Tabs
  const amTabBtn = document.getElementById('tab-routine-am');
  const pmTabBtn = document.getElementById('tab-routine-pm');
  if (amTabBtn && pmTabBtn) {
    amTabBtn.addEventListener('click', (e) => {
      e.preventDefault();
      appState.userSelectedTab = true;
      appState.activeTab = 'AM';
      appState.activeRoutineTab = 'am';
      updateRoutineTabButtons();
      renderRoutineSteps();
    });

    pmTabBtn.addEventListener('click', (e) => {
      e.preventDefault();
      appState.userSelectedTab = true;
      appState.activeTab = 'PM';
      appState.activeRoutineTab = 'pm';
      updateRoutineTabButtons();
      renderRoutineSteps();
    });
  }

  // 10. Skin Feel Toggles (Multi-select toggles)
  const toggles = ['oily', 'tight', 'dull', 'breakouts'];
  toggles.forEach(key => {
    const btn = document.getElementById(`toggle-${key}`);
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (appState.symptoms.has(key)) {
          appState.symptoms.delete(key);
        } else {
          appState.symptoms.add(key);
        }
        toggles.forEach(k => {
          appState.skinFeel[k] = appState.symptoms.has(k);
        });
        updateSkinFeelToggles();
        renderModeCardAndRoutine();
      });
    }
  });

  // 10B. Clear All Symptoms Button
  const clearSymptomsBtn = document.getElementById('btn-clear-symptoms');
  if (clearSymptomsBtn) {
    clearSymptomsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      appState.symptoms.clear();
      toggles.forEach(k => {
        appState.skinFeel[k] = false;
      });
      updateSkinFeelToggles();
      renderModeCardAndRoutine();
    });
  }

  // 11. Product Dossier Navigation Tabs
  const tabActives = document.getElementById('tab-dossier-actives');
  const tabLCA = document.getElementById('tab-dossier-lca');
  const tabProof = document.getElementById('tab-dossier-proof');
  const contentActives = document.getElementById('dossier-content-actives');
  const contentLCA = document.getElementById('dossier-content-lca');
  const contentProof = document.getElementById('dossier-content-proof');

  function setDossierTab(activeTab) {
    [tabActives, tabLCA, tabProof].forEach(t => {
      if (t) t.className = 'flex-1 py-1 rounded-lg text-gray-600 hover:text-gray-900 transition-all font-semibold';
    });
    [contentActives, contentLCA, contentProof].forEach(c => {
      if (c) c.classList.add('hidden');
    });

    if (activeTab === 'actives') {
      tabActives.className = 'flex-1 py-1 rounded-lg bg-emerald-800 text-white shadow-xs transition-all font-semibold';
      contentActives.classList.remove('hidden');
    } else if (activeTab === 'lca') {
      tabLCA.className = 'flex-1 py-1 rounded-lg bg-emerald-800 text-white shadow-xs transition-all font-semibold';
      contentLCA.classList.remove('hidden');
    } else if (activeTab === 'proof') {
      tabProof.className = 'flex-1 py-1 rounded-lg bg-emerald-800 text-white shadow-xs transition-all font-semibold';
      contentProof.classList.remove('hidden');
    }
  }

  if (tabActives) tabActives.addEventListener('click', () => setDossierTab('actives'));
  if (tabLCA) tabLCA.addEventListener('click', () => setDossierTab('lca'));
  if (tabProof) tabProof.addEventListener('click', () => setDossierTab('proof'));

  // 12. Check-In Form Submission
  const checkinForm = document.getElementById('checkin-form');
  if (checkinForm) {
    checkinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const scoreRadio = document.querySelector('input[name="comfort-score"]:checked');
      if (!scoreRadio) {
        alert('Please select your skin comfort rating (1 to 5) before logging your check-in.');
        return;
      }
      const routineCheckbox = document.getElementById('checkin-routine-done');
      const score = scoreRadio.value;
      const done = routineCheckbox ? routineCheckbox.checked : false;
      saveCheckIn(score, done);
    });
  }

  // 13. Retry Button
  const retryBtn = document.getElementById('btn-retry-api');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      fetchWeatherData(appState.coords.lat, appState.coords.lon, appState.selectedCity);
    });
  }
});
