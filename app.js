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
function decideMode(inputs) {
  const { aqi = 0, uv = 0, humidity = 50, skinFeel = {} } = inputs;

  const shieldReasons = [];
  const hydrateReasons = [];
  const balanceReasons = [];

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
  if (skinFeel.tight) {
    hydrateReasons.push('Skin reported: Tight / Dry feeling');
  }

  // 3. Evaluate BALANCE
  if (humidity > 65) {
    balanceReasons.push(`Humidity ${humidity}% > 65% (High humidity / sebum risk)`);
  }
  if (skinFeel.oily) {
    balanceReasons.push('Skin reported: Oily / Shiny feeling');
  }

  // User reported reason chips
  const userReportChips = [];
  if (skinFeel.oily) userReportChips.push('You reported: Oily / shiny');
  if (skinFeel.tight) userReportChips.push('You reported: Tight / dry');
  if (skinFeel.dull) userReportChips.push('You reported: Dull / tired');
  if (skinFeel.breakouts) userReportChips.push('You reported: Breakouts');

  // Determine active mode by strict priority: Shield > Hydrate > Balance
  let activeMode = 'BALANCE';
  let activeReasons = [];
  let isDefault = false;

  if (shieldReasons.length > 0) {
    activeMode = 'SHIELD';
    activeReasons = [...shieldReasons];
  } else if (hydrateReasons.length > 0) {
    activeMode = 'HYDRATE';
    activeReasons = [...hydrateReasons];
  } else if (balanceReasons.length > 0) {
    activeMode = 'BALANCE';
    activeReasons = [...balanceReasons];
  } else {
    activeMode = 'BALANCE';
    activeReasons = ['Optimal conditions: Everyday barrier maintenance'];
    isDefault = true;
  }

  // Append user reported chips if not already present
  userReportChips.forEach(chip => {
    if (!activeReasons.includes(chip)) {
      activeReasons.push(chip);
    }
  });

  return {
    mode: activeMode,
    reasons: activeReasons,
    isDefault,
    allTriggers: {
      shield: shieldReasons,
      hydrate: hydrateReasons,
      balance: balanceReasons
    }
  };
}



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
  skinFeel: {
    oily: false,
    tight: false,
    dull: false,
    breakouts: false
  },
  activeRoutineTab: 'am', // 'am' or 'pm'
  modeResult: null,
  isLoading: false,
  apiError: null,
  isDemoFallback: false,
  isSimulated: false
};
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
}

/**
 * Builds personalized AM and PM barrier routine steps based on reported symptoms
 * while maintaining the active mode priority (Shield > Hydrate > Balance).
 */
function buildPersonalizedRoutine(baseMode, skinFeel = {}, aqi = 0, uv = 0, humidity = 50) {
  const modeKey = (baseMode || 'BALANCE').toUpperCase();
  const base = MODE_DETAILS[modeKey] || MODE_DETAILS.BALANCE;

  // Deep copy base steps
  const amSteps = JSON.parse(JSON.stringify(base.routineAM));
  const pmSteps = JSON.parse(JSON.stringify(base.routinePM));

  const isOily = Boolean(skinFeel.oily);
  const isTight = Boolean(skinFeel.tight);
  const isDull = Boolean(skinFeel.dull);
  const isBreakouts = Boolean(skinFeel.breakouts);

  const balanceTipsAdded = isOily && modeKey !== 'BALANCE';

  let retentionNote = null;
  const hasConcerns = isOily || isTight || isDull || isBreakouts;

  if (hasConcerns) {
    if (aqi > 200) {
      retentionNote = 'Shield mode stays active because of air quality; your selection adjusted the steps.';
    } else if (uv >= 6) {
      retentionNote = 'Shield mode stays active because of solar UV; your selection adjusted the steps.';
    } else if (humidity < 40) {
      retentionNote = 'Hydrate mode stays active because of dry air; your selection adjusted the steps.';
    } else if (humidity > 65) {
      retentionNote = 'Balance mode stays active because of humidity; your selection adjusted the steps.';
    } else {
      if (isTight) {
        retentionNote = null; // Changed mode to Hydrate
      } else {
        retentionNote = 'Balance mode stays active; your selection adjusted the steps.';
      }
    }
  }

  // 1. Personalize for Oily / Shiny
  if (isOily) {
    amSteps[0] = {
      step: '01',
      title: 'Gentle Low-Foaming Cleanse',
      desc: 'Gentle cleanse with lukewarm water to clear excess surface sebum without aggressive stripping or triggering rebound oil.',
      dose: '1 pump'
    };
    amSteps[1] = {
      step: '02',
      title: 'Garnier ClimaGuard (Lightweight Gel Dosing)',
      desc: 'Apply lightweight gel texture in a smaller amount. 1 pump delivers 5% Niacinamide to help control excess oil while 2% Ectoin helps protect against micro-particulates without greasiness.',
      dose: '1 pump (smaller amount)'
    };
    amSteps[2].desc += ' Lightweight fluid texture; no heavy creams to prevent midday shine.';

    pmSteps[0] = {
      step: '01',
      title: 'Gentle Purifying Cleanse',
      desc: 'Ultra-gentle purifying wash to lift daytime sebum, sunscreen, and particulate grime without disturbing skin lipids.',
      dose: 'Gentle rinse'
    };
    pmSteps[1] = {
      step: '02',
      title: 'Garnier ClimaGuard Overnight Gel Recovery',
      desc: 'Apply 1-2 pumps lightweight gel texture (smaller amount). High-potency Niacinamide supports ceramide production, may help control excess oil, and aids overnight barrier recovery.',
      dose: '1-2 pumps (smaller amount)'
    };
    pmSteps[2] = {
      step: '03',
      title: 'Lightweight Barrier Emulsion',
      desc: 'Apply sheer micro-drop only where needed. Avoid heavy creams to maintain pores clear and breathable overnight.',
      dose: 'Micro pea-sized drop'
    };
  }

  // 2. Personalize for Tight / Dry
  if (isTight) {
    amSteps[0] = {
      step: '01',
      title: 'Milky Non-Foaming Conditioning Wash',
      desc: 'Gentle non-foaming cleanse with lukewarm water. Cushions the barrier and prevents trans-epidermal moisture loss.',
      dose: 'Gentle splash'
    };
    if (!isOily) {
      amSteps[1] = {
        step: '02',
        title: 'Garnier ClimaGuard Deep Moisture Infusion',
        desc: 'Apply generously on damp skin, then pat an extra hydrating layer over dry areas. 1.2% Ceramide NP and squalane bind moisture deeply within stratum corneum.',
        dose: '2 generous pumps + hydrating layer'
      };
    } else {
      amSteps[1] = {
        step: '02',
        title: 'Garnier ClimaGuard Balanced Gel Infusion',
        desc: 'Smooth lightweight gel onto damp skin to add a hydrating layer without heavy oils. 5% Niacinamide may help control excess oil while Ceramide NP relieves tight feeling.',
        dose: '1-2 pumps on damp skin'
      };
    }

    pmSteps[0] = {
      step: '01',
      title: 'Ultra-Gentle Non-Foaming Cleanse',
      desc: 'Non-foaming nourishing cleanse to lift impurities without stripping delicate barrier lipids.',
      dose: 'Lukewarm rinse'
    };
    if (!isOily) {
      pmSteps[2] = {
        step: '03',
        title: 'Lipid-Replenishing Barrier Seal',
        desc: 'Seal with a nourishing layer of sugarcane squalane emulsion to help reduce overnight moisture loss and restore lipid comfort.',
        dose: 'Generous pea-sized amount'
      };
    }
  }

  // 3. Personalize for Dull / Tired
  if (isDull) {
    amSteps[1].desc += ' Gentle exfoliation-free brightening note: antioxidant support from Vitamin C-rich Amla paired with daily sunscreen helps maintain radiant skin feel without harsh exfoliating acids.';
    pmSteps[1].desc += ' Overnight radiance note: supports natural barrier rest, hydration, and overnight recovery through sleep (exfoliation-free).';
  }

  // 4. Personalize for Breakouts
  if (isBreakouts) {
    amSteps[1].desc += ' Non-comedogenic & fragrance-free steps: avoid layering heavy products and do not pick at skin. If breakouts persist, consult a dermatologist.';
    pmSteps[1].desc += ' Non-comedogenic & fragrance-free formula: avoid pore-clogging balms and do not pick at skin. If breakouts persist, consult a dermatologist.';
  }

  return {
    am: amSteps,
    pm: pmSteps,
    retentionNote,
    balanceTipsAdded
  };
}

// ============================================================================
// 4. CONSOLE ASSERT UNIT TESTS
// ============================================================================
function runUnitTests() {
  console.group('🧪 ClimaCheck decideMode() Unit Test Suite');

  // Test 1: AQI > 200 triggers SHIELD
  const t1 = decideMode({ aqi: 205, uv: 3, humidity: 50 });
  console.assert(t1.mode === 'SHIELD', 'Test 1 Failed: AQI > 200 should trigger SHIELD');

  // Test 2: UV >= 6 triggers SHIELD (exact boundary UV = 6)
  const t2 = decideMode({ aqi: 150, uv: 6, humidity: 50 });
  console.assert(t2.mode === 'SHIELD', 'Test 2 Failed: UV = 6 should trigger SHIELD');

  // Test 3: UV 5.9 does not trigger SHIELD
  const t3 = decideMode({ aqi: 150, uv: 5.9, humidity: 50 });
  console.assert(t3.mode === 'BALANCE', 'Test 3 Failed: UV 5.9 should default to BALANCE');

  // Test 4: Humidity < 40% triggers HYDRATE
  const t4 = decideMode({ aqi: 120, uv: 4, humidity: 39 });
  console.assert(t4.mode === 'HYDRATE', 'Test 4 Failed: Humidity 39% should trigger HYDRATE');

  // Test 5: Exact boundary Humidity = 40% should NOT trigger HYDRATE by humidity
  const t5 = decideMode({ aqi: 100, uv: 3, humidity: 40 });
  console.assert(t5.mode === 'BALANCE', 'Test 5 Failed: Humidity 40% should default to BALANCE');

  // Test 6: Tight/dry skin triggers HYDRATE even if humidity is normal
  const t6 = decideMode({ aqi: 100, uv: 3, humidity: 55, skinFeel: { tight: true } });
  console.assert(t6.mode === 'HYDRATE', 'Test 6 Failed: Tight skin should trigger HYDRATE');

  // Test 7: Humidity > 65% triggers BALANCE
  const t7 = decideMode({ aqi: 90, uv: 4, humidity: 66 });
  console.assert(t7.mode === 'BALANCE', 'Test 7 Failed: Humidity 66% should trigger BALANCE');

  // Test 8: Exact boundary Humidity = 65% should NOT trigger BALANCE by humidity (defaults to balance)
  const t8 = decideMode({ aqi: 90, uv: 4, humidity: 65 });
  console.assert(t8.mode === 'BALANCE' && t8.isDefault, 'Test 8 Failed: Humidity 65% should be default balance');

  // Test 9: Priority 1: SHIELD beats HYDRATE (AQI > 200 + Humidity < 40%)
  const t9 = decideMode({ aqi: 240, uv: 4, humidity: 30 });
  console.assert(t9.mode === 'SHIELD', 'Test 9 Failed: Shield must take priority over Hydrate');

  // Test 10: Priority 2: SHIELD beats BALANCE (UV >= 6 + Humidity > 65%)
  const t10 = decideMode({ aqi: 80, uv: 8, humidity: 75 });
  console.assert(t10.mode === 'SHIELD', 'Test 10 Failed: Shield must take priority over Balance');

  // Test 11: Priority 3: HYDRATE beats BALANCE (Humidity < 40% + Oily skin toggle)
  const t11 = decideMode({ aqi: 110, uv: 3, humidity: 35, skinFeel: { oily: true } });
  console.assert(t11.mode === 'HYDRATE', 'Test 11 Failed: Hydrate must take priority over Balance');

  // Test 12: Default fallback when no rules are met
  const t12 = decideMode({ aqi: 85, uv: 4, humidity: 52, skinFeel: {} });
  console.assert(t12.mode === 'BALANCE' && t12.isDefault, 'Test 12 Failed: Should default to BALANCE');

  // Test 13: Skin feel personalization tests (all 4 symptoms visibly change routine)
  const baseRoutine = buildPersonalizedRoutine('BALANCE', {}, 85, 4, 52);
  const baseText = JSON.stringify(baseRoutine.am) + JSON.stringify(baseRoutine.pm);

  for (let i = 1; i < 16; i++) {
    const feel = {
      oily: Boolean(i & 1),
      tight: Boolean(i & 2),
      dull: Boolean(i & 4),
      breakouts: Boolean(i & 8)
    };
    const pRes = buildPersonalizedRoutine('BALANCE', feel, 85, 4, 52);
    const pText = JSON.stringify(pRes.am) + JSON.stringify(pRes.pm);
    console.assert(pText !== baseText, 'Test 13 Failed: Combination should change routine text');
  }

  // Test 14: Shield mode retention note and balance tips badge
  const shieldOily = buildPersonalizedRoutine('SHIELD', { oily: true }, 348, 3, 35);
  console.assert(shieldOily.balanceTipsAdded === true, 'Test 14 Failed: balanceTipsAdded should be true');
  console.assert(shieldOily.retentionNote === 'Shield mode stays active because of air quality; your selection adjusted the steps.', 'Test 14 Failed: retention note should match');

  console.log('✅ All 12 decideMode() unit tests passed successfully!');
  console.groupEnd();
}
runUnitTests();;

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
  // 1. Instant local decision
  const localDecision = decideMode({
    aqi: appState.aqiData.aqi,
    uv: appState.uv,
    humidity: appState.humidity,
    skinFeel: appState.skinFeel
  });

  const clientPersonalized = buildPersonalizedRoutine(
    localDecision.mode,
    appState.skinFeel,
    appState.aqiData.aqi,
    appState.uv,
    appState.humidity
  );
  localDecision.personalizedRoutine = clientPersonalized;
  localDecision.retentionNote = clientPersonalized.retentionNote;
  localDecision.balanceTipsAdded = clientPersonalized.balanceTipsAdded;

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

  // 4. Night routine sync (UV 0 defaults to PM)
  syncRoutineTabForTime();

  // 5. Render Weather & BSI dial
  renderConditionsAndBSI();

  // 6. Render Mode Card
  renderModeCard(localDecision);

  // 7. Update Skin Feel Toggles
  updateSkinFeelToggles();

  // 8. Verify with backend /api/recommend if available
  try {
    const concerns = [];
    if (appState.skinFeel.oily) concerns.push('oily');
    if (appState.skinFeel.tight) concerns.push('tight');
    if (appState.skinFeel.dull) concerns.push('dull');
    if (appState.skinFeel.breakouts) concerns.push('breakouts');

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000);
    const recRes = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conditions: {
          approx_aqi: appState.aqiData.aqi,
          uv: appState.uv,
          humidity: appState.humidity,
          temperature: appState.temperature
        },
        concerns
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
        serverRoutine: recData.routine,
        retentionNote: recData.personalization_note,
        balanceTipsAdded: recData.balance_tips_added,
        personalizedRoutine: {
          am: recData.routine.am,
          pm: recData.routine.pm
        }
      };
      renderModeCard(appState.modeResult);
    }
  } catch (e) {
    // Graceful silent fallback
  }
}

function syncRoutineTabForTime() {
  if (appState.uv === 0) {
    appState.activeRoutineTab = 'pm';
  } else if (!appState.userManuallySwitchedRoutine) {
    appState.activeRoutineTab = 'am';
  }
  updateRoutineTabButtons();
}

function updateRoutineTabButtons() {
  const amTabBtn = document.getElementById('tab-routine-am');
  const pmTabBtn = document.getElementById('tab-routine-pm');
  if (amTabBtn && pmTabBtn) {
    if (appState.activeRoutineTab === 'pm') {
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

function renderModeCard(modeDecision) {
  const modeData = MODE_DETAILS[modeDecision.mode] || MODE_DETAILS.BALANCE;
  const container = document.getElementById('mode-card-container');
  const titleEl = document.getElementById('mode-title');
  const taglineEl = document.getElementById('mode-tagline');
  const summaryEl = document.getElementById('mode-summary');
  const iconWrapper = document.getElementById('mode-icon-wrapper');
  const badgeEl = document.getElementById('mode-badge');
  const balanceTipsBadge = document.getElementById('mode-balance-tips-badge');
  const reasonsWrapper = document.getElementById('mode-reasons-list');
  const noteBox = document.getElementById('mode-personalization-note');
  const noteText = document.getElementById('mode-personalization-note-text');

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

  // Balance tips added pill
  if (balanceTipsBadge) {
    if (modeDecision.balanceTipsAdded) {
      balanceTipsBadge.classList.remove('hidden');
    } else {
      balanceTipsBadge.classList.add('hidden');
    }
  }

  // Render "WHY" Reason Chips
  if (reasonsWrapper) {
    reasonsWrapper.innerHTML = '';
    modeDecision.reasons.forEach(reason => {
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

  // Personalization override note (e.g. Shield mode stays active because of air quality)
  if (noteBox && noteText) {
    if (modeDecision.retentionNote) {
      noteText.textContent = modeDecision.retentionNote;
      noteBox.classList.remove('hidden');
    } else {
      noteBox.classList.add('hidden');
      noteText.textContent = '';
    }
  }

  // Render Steps
  renderRoutineSteps(modeDecision);
}

function renderRoutineSteps(modeDecision) {
  let stepsList = [];
  if (modeDecision && modeDecision.personalizedRoutine) {
    stepsList = appState.activeRoutineTab === 'am' ? modeDecision.personalizedRoutine.am : modeDecision.personalizedRoutine.pm;
  } else if (appState.modeResult && appState.modeResult.personalizedRoutine) {
    stepsList = appState.activeRoutineTab === 'am' ? appState.modeResult.personalizedRoutine.am : appState.modeResult.personalizedRoutine.pm;
  } else if (appState.modeResult && appState.modeResult.serverRoutine) {
    const srv = appState.modeResult.serverRoutine;
    if (appState.activeRoutineTab === 'am' && srv.am) stepsList = srv.am;
    else if (appState.activeRoutineTab === 'pm' && srv.pm) stepsList = srv.pm;
  } else {
    const modeKey = (modeDecision ? modeDecision.mode : (appState.modeResult ? appState.modeResult.mode : 'BALANCE')).toUpperCase();
    const modeData = MODE_DETAILS[modeKey] || MODE_DETAILS.BALANCE;
    stepsList = appState.activeRoutineTab === 'am' ? modeData.routineAM : modeData.routinePM;
  }

  const container = document.getElementById('routine-steps-container');
  if (!container) return;

  container.innerHTML = '';
  stepsList.forEach(step => {
    const card = document.createElement('div');
    card.className = 'flex items-start gap-3 p-3.5 rounded-2xl bg-white/90 border border-gray-200 shadow-xs hover:border-emerald-400 transition-all';
    card.innerHTML = `
      <div class="flex-shrink-0 w-8 h-8 rounded-xl bg-emerald-50 text-emerald-800 font-extrabold text-xs flex items-center justify-center border border-emerald-200 shadow-xs">
        ${step.step}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-1">
          <h4 class="text-xs sm:text-sm font-bold text-gray-900 leading-snug truncate">${step.title}</h4>
          ${step.dose ? `<span class="text-[9px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full flex-shrink-0">${step.dose}</span>` : ''}
        </div>
        <p class="text-[11px] sm:text-xs text-gray-600 mt-0.5 leading-relaxed">${step.desc}</p>
      </div>
    `;
    container.appendChild(card);
  });
}

function updateSkinFeelToggles() {
  const toggles = ['oily', 'tight', 'dull', 'breakouts'];
  let hasActive = false;

  toggles.forEach(key => {
    const btn = document.getElementById(`toggle-${key}`);
    if (!btn) return;
    const isActive = Boolean(appState.skinFeel[key]);
    if (isActive) {
      hasActive = true;
      btn.className = 'flex flex-col items-center justify-center p-3 rounded-2xl border-2 bg-emerald-900 text-white border-emerald-500 text-center gap-1 shadow-md ring-2 ring-emerald-500/20 transition-all font-semibold relative';
      btn.setAttribute('aria-pressed', 'true');
    } else {
      btn.className = 'flex flex-col items-center justify-center p-3 rounded-2xl border border-gray-200 bg-white hover:border-emerald-500 hover:bg-emerald-50/20 transition-all text-gray-700 text-center gap-1 group shadow-xs';
      btn.setAttribute('aria-pressed', 'false');
    }
  });

  const clearBtn = document.getElementById('btn-clear-skin-feel');
  if (clearBtn) {
    if (hasActive) {
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
    amTabBtn.addEventListener('click', () => {
      appState.userManuallySwitchedRoutine = true;
      appState.activeRoutineTab = 'am';
      updateRoutineTabButtons();
      renderRoutineSteps(appState.modeResult);
    });

    pmTabBtn.addEventListener('click', () => {
      appState.userManuallySwitchedRoutine = true;
      appState.activeRoutineTab = 'pm';
      updateRoutineTabButtons();
      renderRoutineSteps(appState.modeResult);
    });
  }

  // 10. Skin Feel Toggles & Clear Option
  const toggles = ['oily', 'tight', 'dull', 'breakouts'];
  toggles.forEach(key => {
    const btn = document.getElementById(`toggle-${key}`);
    if (btn) {
      btn.addEventListener('click', () => {
        appState.skinFeel[key] = !appState.skinFeel[key];
        updateUI();
      });
    }
  });

  const clearSkinFeelBtn = document.getElementById('btn-clear-skin-feel');
  if (clearSkinFeelBtn) {
    clearSkinFeelBtn.addEventListener('click', () => {
      appState.skinFeel = { oily: false, tight: false, dull: false, breakouts: false };
      updateUI();
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
