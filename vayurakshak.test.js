/**
 * @fileoverview Unit test suite for VayuRakshak AI core air-quality logic,
 * activity intent parsing, personalized health advisory generation, data
 * formatting utilities, and Gemini API key validation.
 */

import { describe, it, expect } from 'vitest';

/* ==========================================================================
   CORE LOGIC & UTILITIES (Mirroring VayuRakshak AI Pure Functions)
   ========================================================================== */

/** @type {Record<string, { name: string, aqi: number, pm25: number, pm10: number, no2: number, afternoonWindow: string }>} */
const CITY_PRESETS = {
  Delhi: { name: 'Delhi', aqi: 392, pm25: 246, pm10: 388, no2: 78, afternoonWindow: '1:30 PM – 3:45 PM' },
  Lucknow: { name: 'Lucknow', aqi: 318, pm25: 194, pm10: 305, no2: 64, afternoonWindow: '1:00 PM – 4:00 PM' },
  Kolkata: { name: 'Kolkata', aqi: 234, pm25: 132, pm10: 218, no2: 59, afternoonWindow: '12:30 PM – 4:15 PM' },
  Mumbai: { name: 'Mumbai', aqi: 146, pm25: 74, pm10: 142, no2: 48, afternoonWindow: '12:00 PM – 5:00 PM' },
  Bengaluru: { name: 'Bengaluru', aqi: 74, pm25: 34, pm10: 68, no2: 29, afternoonWindow: '7:00 AM – 6:30 PM' },
};

/**
 * Clamps any numeric AQI input into the valid CPCB/NAQI range [0, 500].
 * @param {number|string} value - Raw AQI input value.
 * @returns {number} Clamped integer AQI between 0 and 500.
 */
function clampAqi(value) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.min(500, Math.round(parsed)));
}

/**
 * Maps an AQI value (0–500) to its corresponding severity tier metadata.
 * @param {number} aqi - Air Quality Index value.
 * @returns {{ label: string, accent: string }} Severity label and theme color.
 */
function getSeverityTier(aqi) {
  const safeAqi = clampAqi(aqi);
  if (safeAqi <= 50) return { label: 'Good', accent: '#10b981' };
  if (safeAqi <= 150) return { label: 'Moderate', accent: '#f59e0b' };
  if (safeAqi <= 300) return { label: 'Poor', accent: '#f97316' };
  return { label: 'Severe', accent: '#f43f5e' };
}

/**
 * Determines the dominant pollutant relative to Indian CPCB 24-hour safe limits
 * (PM2.5 <= 60, PM10 <= 100, NO2 <= 80 µg/m³).
 * @param {{ pm25: number, pm10: number, no2: number }} pollutants - Pollutant levels in µg/m³.
 * @returns {'PM2.5' | 'PM10' | 'NO₂'} Dominant pollutant name.
 */
function getDominantPollutant({ pm25, pm10, no2 }) {
  const ratios = [
    { name: 'PM2.5', ratio: (Number(pm25) || 0) / 60 },
    { name: 'PM10', ratio: (Number(pm10) || 0) / 100 },
    { name: 'NO₂', ratio: (Number(no2) || 0) / 80 },
  ];
  ratios.sort((a, b) => b.ratio - a.ratio);
  return ratios[0].name;
}

/**
 * Parses user activity text to detect time-of-day and exertion/commute intent.
 * @param {string} rawActivity - User-entered activity description.
 * @returns {{
 *   isMorning: boolean,
 *   isEvening: boolean,
 *   isCommute: boolean,
 *   isTwoWheeler: boolean,
 *   isHighExertion: boolean,
 *   isSchoolOrKids: boolean
 * }} Intent flags.
 */
function analyzeActivityIntent(rawActivity) {
  const text = (rawActivity || '').toLowerCase();
  return {
    isMorning: /\b(morning|5\s*am|6\s*am|7\s*am|8\s*am|9\s*am|dawn|early)\b/.test(text),
    isEvening: /\b(evening|night|6\s*pm|7\s*pm|8\s*pm|9\s*pm|10\s*pm|sunset|late)\b/.test(text),
    isCommute: /\b(commute|commuting|bike|scooter|two-wheeler|cycling|cycle|drive|traffic|office|bus|metro)\b/.test(text),
    isTwoWheeler: /\b(bike|scooter|two-wheeler|motorcycle|cycling|cycle)\b/.test(text),
    isHighExertion: /\b(run|running|jog|jogging|5k|10k|marathon|sprint|workout|cricket|football|sports|gym)\b/.test(text),
    isSchoolOrKids: /\b(school|drop-off|kid|child|playground|park)\b/.test(text),
  };
}

/**
 * Generates personalized health & route guidance in Smart Demo Mode.
 * @param {{
 *   cityKey?: string,
 *   aqi: number,
 *   pm25: number,
 *   pm10: number,
 *   no2: number,
 *   profile: 'general' | 'vulnerable' | 'asthma' | 'runner',
 *   activity: string
 * }} input - Current environmental and user profile parameters.
 * @returns {{
 *   verdict: 'Safe' | 'Caution' | 'Avoid',
 *   maskRecommendation: string,
 *   safeTimeWindow: string,
 *   checklist: Array<{ title: string, detail: string }>,
 *   alternatives: Array<{ title: string, detail: string }>
 * }} Structured advisory payload.
 */
function buildSmartDemoAdvice({ cityKey = 'Delhi', aqi, pm25, pm10, no2, profile, activity }) {
  const safeAqi = clampAqi(aqi);
  const cityPreset = CITY_PRESETS[cityKey] || null;
  const intent = analyzeActivityIntent(activity);

  const isSensitive = profile === 'vulnerable' || profile === 'asthma';
  const isRunner = profile === 'runner';

  let effectiveAqi = safeAqi;
  if (intent.isMorning && safeAqi > 120) effectiveAqi += 25;
  if (intent.isHighExertion) effectiveAqi += 35;
  if (intent.isTwoWheeler && no2 > 45) effectiveAqi += 20;

  let verdict = 'Safe';
  if (effectiveAqi > 260 || (effectiveAqi > 175 && isSensitive) || (safeAqi > 210 && isRunner && intent.isHighExertion)) {
    verdict = 'Avoid';
  } else if (effectiveAqi > 95 || (effectiveAqi > 65 && isSensitive)) {
    verdict = 'Caution';
  }

  let maskRecommendation = 'No Mask Needed (Optional in Heavy Traffic)';
  if (safeAqi > 300 || (safeAqi > 220 && isSensitive)) {
    maskRecommendation = isRunner || intent.isHighExertion
      ? 'N99 / Valved N95 Respirator (Indoor Preferred)'
      : 'Certified N95 / N99 Respirator (Tight Nose Seal)';
  } else if (safeAqi > 150 || (safeAqi > 100 && (isSensitive || intent.isTwoWheeler))) {
    maskRecommendation = intent.isSchoolOrKids && profile === 'vulnerable'
      ? 'Child-Fit KF94 / N95 Mask'
      : 'Certified N95 / FFP2 Mask';
  } else if (safeAqi > 75) {
    maskRecommendation = intent.isTwoWheeler || isSensitive
      ? 'FFP2 / KF94 Mask on Busy Roads'
      : 'Optional Surgical / KF94 in Traffic';
  }

  let safeTimeWindow = cityPreset ? cityPreset.afternoonWindow : '1:30 PM – 4:00 PM';
  if (safeAqi <= 75) {
    safeTimeWindow = '6:30 AM – 11:00 AM & 4:30 PM – 7:30 PM';
  } else if (safeAqi > 300) {
    safeTimeWindow = `${cityPreset ? cityPreset.afternoonWindow : '1:30 PM – 3:45 PM'} (Essential Travel Only)`;
  }

  return {
    verdict,
    maskRecommendation,
    safeTimeWindow,
    checklist: [
      { title: `Mask: ${maskRecommendation}`, detail: 'Ensure tight nose-bridge seal.' },
      { title: 'Saline Nasal Wash', detail: `Flush ${getDominantPollutant({ pm25, pm10, no2 })} particulates after return.` },
      { title: 'Indoor Air Management', detail: 'Keep windows closed during smog peaks.' },
      { title: 'Hydration Support', detail: 'Drink 2.5–3L warm fluids daily.' },
    ],
    alternatives: [
      { title: 'Indoor Activity Swap', detail: 'Shift activity indoors with filtration.' },
      { title: 'Afternoon Window Shift', detail: `Reschedule to ${safeTimeWindow}.` },
      { title: 'Low-Exposure Route', detail: 'Avoid high-traffic intersections.' },
    ],
  };
}

/**
 * Safely parses JSON returned from an LLM, stripping surrounding markdown fences if needed.
 * @param {string} text - Raw response string from Gemini API.
 * @returns {Record<string, unknown>} Parsed JSON object.
 * @throws {Error} Throws when no valid JSON object can be extracted.
 */
function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text ?? '').match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Malformed JSON returned by AI');
  }
}

/**
 * Escapes unsafe HTML characters to prevent XSS when rendering AI output.
 * @param {string|number|null|undefined} str - Raw string value.
 * @returns {string} HTML-escaped string.
 */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats a concise, human-readable AQI banner summary string.
 * @param {string} cityName - City or zone name.
 * @param {number} aqi - Current AQI value.
 * @param {number} pm25 - Current PM2.5 concentration in µg/m³.
 * @returns {string} Formatted advisory summary.
 */
function formatAqiSummary(cityName, aqi, pm25) {
  const clamped = clampAqi(aqi);
  const { label } = getSeverityTier(clamped);
  return `${cityName} • AQI ${clamped} (${label}) • PM2.5: ${Math.max(0, Number(pm25) || 0)} µg/m³`;
}

/**
 * Validates a Google Gemini API key and determines the active AI execution mode.
 * Empty keys cleanly resolve to Smart Demo Mode rather than throwing.
 * @param {string|null|undefined} rawKey - User-supplied API key.
 * @returns {{ valid: boolean, mode: 'gemini' | 'demo', sanitizedKey: string, reason: string }} Validation result.
 */
function validateGeminiApiKey(rawKey) {
  const sanitizedKey = typeof rawKey === 'string' ? rawKey.trim() : '';

  if (!sanitizedKey) {
    return {
      valid: false,
      mode: 'demo',
      sanitizedKey: '',
      reason: 'No API key provided; Smart Demo Mode active.',
    };
  }

  if (/\s/.test(sanitizedKey)) {
    return {
      valid: false,
      mode: 'demo',
      sanitizedKey: '',
      reason: 'API key must not contain whitespace.',
    };
  }

  // Google AI Studio keys start with "AIza" followed by 30–45 URL-safe characters
  const geminiKeyPattern = /^AIza[0-9A-Za-z_-]{30,45}$/;
  if (!geminiKeyPattern.test(sanitizedKey)) {
    return {
      valid: false,
      mode: 'demo',
      sanitizedKey: '',
      reason: 'Invalid Gemini API key format (expected AIza... token).',
    };
  }

  return {
    valid: true,
    mode: 'gemini',
    sanitizedKey,
    reason: 'Valid Gemini API key format.',
  };
}

/* ==========================================================================
   VITEST UNIT TEST SUITES
   ========================================================================== */

describe('VayuRakshak AI – Core AQI & Pollutant Logic', () => {
  it('clamps out-of-range and invalid AQI values safely between 0 and 500', () => {
    expect(clampAqi(-45)).toBe(0);
    expect(clampAqi(0)).toBe(0);
    expect(clampAqi(249.6)).toBe(250);
    expect(clampAqi(720)).toBe(500);
    expect(clampAqi('not-a-number')).toBe(0);
  });

  it('classifies AQI severity tiers accurately across all boundary values', () => {
    expect(getSeverityTier(0).label).toBe('Good');
    expect(getSeverityTier(50).label).toBe('Good');
    expect(getSeverityTier(51).label).toBe('Moderate');
    expect(getSeverityTier(150).label).toBe('Moderate');
    expect(getSeverityTier(151).label).toBe('Poor');
    expect(getSeverityTier(300).label).toBe('Poor');
    expect(getSeverityTier(301).label).toBe('Severe');
    expect(getSeverityTier(500).label).toBe('Severe');
  });

  it('identifies the dominant pollutant relative to Indian CPCB safe thresholds', () => {
    expect(getDominantPollutant({ pm25: 246, pm10: 388, no2: 78 })).toBe('PM2.5');
    expect(getDominantPollutant({ pm25: 30, pm10: 250, no2: 40 })).toBe('PM10');
    expect(getDominantPollutant({ pm25: 25, pm10: 50, no2: 140 })).toBe('NO₂');
  });
});

describe('VayuRakshak AI – Activity Intent & Personalized Smart Demo Advisor', () => {
  it('detects morning, two-wheeler commute, high exertion, and school drop-off intents', () => {
    const morningWalk = analyzeActivityIntent('Morning walk at 7 AM');
    expect(morningWalk.isMorning).toBe(true);
    expect(morningWalk.isHighExertion).toBe(false);

    const bikeCommute = analyzeActivityIntent('Commuting by bike at 9 AM');
    expect(bikeCommute.isCommute).toBe(true);
    expect(bikeCommute.isTwoWheeler).toBe(true);
    expect(bikeCommute.isMorning).toBe(true);

    const eveningRun = analyzeActivityIntent('Outdoor 5K run at 6 PM');
    expect(eveningRun.isHighExertion).toBe(true);
    expect(eveningRun.isEvening).toBe(true);

    const schoolDrop = analyzeActivityIntent('School drop-off at 8 AM');
    expect(schoolDrop.isSchoolOrKids).toBe(true);
  });

  it('returns "Avoid" with N95/N99 mask and afternoon window for Delhi severe winter smog', () => {
    const advice = buildSmartDemoAdvice({
      cityKey: 'Delhi',
      aqi: 392,
      pm25: 246,
      pm10: 388,
      no2: 78,
      profile: 'general',
      activity: 'Morning walk at 7 AM',
    });

    expect(advice.verdict).toBe('Avoid');
    expect(advice.maskRecommendation).toContain('N95');
    expect(advice.safeTimeWindow).toContain('1:30 PM – 3:45 PM');
    expect(advice.checklist).toHaveLength(4);
    expect(advice.alternatives).toHaveLength(3);
  });

  it('applies stricter protection for asthma patients even at Moderate AQI', () => {
    const advice = buildSmartDemoAdvice({
      cityKey: 'Mumbai',
      aqi: 110,
      pm25: 58,
      pm10: 115,
      no2: 45,
      profile: 'asthma',
      activity: 'Morning walk at 7 AM',
    });

    expect(advice.verdict).toBe('Caution');
    expect(advice.maskRecommendation).toContain('N95');
  });

  it('returns "Safe" in Bengaluru Good/Low-Moderate conditions for a general adult', () => {
    const advice = buildSmartDemoAdvice({
      cityKey: 'Bengaluru',
      aqi: 48,
      pm25: 20,
      pm10: 44,
      no2: 22,
      profile: 'general',
      activity: 'Evening walk at 5 PM',
    });

    expect(advice.verdict).toBe('Safe');
    expect(advice.maskRecommendation).toContain('No Mask Needed');
  });
});

describe('VayuRakshak AI – Data Formatting & Security Utilities', () => {
  it('parses clean JSON and markdown-wrapped JSON from Gemini responses', () => {
    expect(parseJsonSafely('{"verdict":"Caution"}')).toEqual({ verdict: 'Caution' });

    const wrapped = '```json\n{"verdict":"Avoid","safeTimeWindow":"1:30 PM – 4:00 PM"}\n```';
    expect(parseJsonSafely(wrapped)).toEqual({
      verdict: 'Avoid',
      safeTimeWindow: '1:30 PM – 4:00 PM',
    });

    expect(() => parseJsonSafely('invalid non-json text')).toThrow('Malformed JSON returned by AI');
  });

  it('escapes HTML special characters to prevent XSS injection', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
    expect(escapeHtml("O'Connor & Co")).toBe('O&#39;Connor &amp; Co');
    expect(escapeHtml(null)).toBe('');
  });

  it('formats AQI banner summaries consistently', () => {
    expect(formatAqiSummary('Delhi', 392, 246)).toBe('Delhi • AQI 392 (Severe) • PM2.5: 246 µg/m³');
    expect(formatAqiSummary('Bengaluru', 42, -10)).toBe('Bengaluru • AQI 42 (Good) • PM2.5: 0 µg/m³');
  });
});

describe('VayuRakshak AI – Gemini API Key Validation', () => {
  it('defaults gracefully to Smart Demo Mode when API key is empty or missing', () => {
    expect(validateGeminiApiKey('')).toEqual({
      valid: false,
      mode: 'demo',
      sanitizedKey: '',
      reason: 'No API key provided; Smart Demo Mode active.',
    });
    expect(validateGeminiApiKey('   ')).toMatchObject({ valid: false, mode: 'demo' });
    expect(validateGeminiApiKey(null)).toMatchObject({ valid: false, mode: 'demo' });
    expect(validateGeminiApiKey(undefined)).toMatchObject({ valid: false, mode: 'demo' });
  });

  it('rejects malformed keys or keys containing spaces', () => {
    expect(validateGeminiApiKey('sk-openai-1234567890')).toMatchObject({
      valid: false,
      mode: 'demo',
    });
    expect(validateGeminiApiKey('AIzaTooShort')).toMatchObject({
      valid: false,
      mode: 'demo',
    });
    expect(validateGeminiApiKey('AIzaSyD12345 6789012345678901234567890')).toMatchObject({
      valid: false,
      mode: 'demo',
      reason: 'API key must not contain whitespace.',
    });
  });

  it('accepts valid Google Gemini API keys and trims surrounding whitespace', () => {
    const sampleKey = 'AIzaSyD-TestKey_1234567890123456789012345';
    expect(validateGeminiApiKey(`  ${sampleKey}  `)).toEqual({
      valid: true,
      mode: 'gemini',
      sanitizedKey: sampleKey,
      reason: 'Valid Gemini API key format.',
    });
  });
});