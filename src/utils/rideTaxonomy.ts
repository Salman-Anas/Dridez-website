// ─── Ride taxonomy ───────────────────────────────────────────────────────────
// These strings are a contract with the Dridez mobile app: riders write
// `cabtype` onto every ride request, the driver feed filters on it, and
// `rates/rates` is keyed by it. Nothing here may be renamed without shipping a
// matching app release, so every component imports from this module rather
// than repeating the literals.
//
// A rider picks a category first, and for the two car tiers is then asked AC or
// Non-AC. The two answers are combined into one cabtype key; the ride document
// also carries `rideCategory` and `acOption` separately so either can be
// grouped on without parsing strings.

export type RideCategory =
  | 'mini' | 'comfort' | 'car_delivery' | 'rickshaw' | 'bike' | 'bike_delivery'
  /** Retired from the app — only ever seen on historical ride documents. */
  | 'freight';

export type AcOption = 'ac' | 'nonac';

export type Cabtype =
  | 'mini_ac' | 'mini_nonac' | 'comfort_ac' | 'comfort_nonac' | 'car_delivery'
  | 'rickshaw' | 'bike' | 'bike_delivery';

/** UI grouping for the rate editor. */
export type RateGroup = 'cars' | 'delivery' | 'other';

export interface CabtypeMeta {
  key: Cabtype;
  label: string;
  category: RideCategory;
  acOption: AcOption | null;
  group: RateGroup;
}

/** The eight bookable cabtypes, in the order the app shows them to riders. */
export const CABTYPES: CabtypeMeta[] = [
  { key: 'mini_ac',       label: 'Mini · AC',        category: 'mini',          acOption: 'ac',    group: 'cars' },
  { key: 'mini_nonac',    label: 'Mini · Non AC',    category: 'mini',          acOption: 'nonac', group: 'cars' },
  { key: 'comfort_ac',    label: 'Comfort · AC',     category: 'comfort',       acOption: 'ac',    group: 'cars' },
  { key: 'comfort_nonac', label: 'Comfort · Non AC', category: 'comfort',       acOption: 'nonac', group: 'cars' },
  { key: 'car_delivery',  label: 'Car Delivery',     category: 'car_delivery',  acOption: null,    group: 'delivery' },
  { key: 'bike_delivery', label: 'Bike Delivery',    category: 'bike_delivery', acOption: null,    group: 'delivery' },
  { key: 'rickshaw',      label: 'Rickshaw',         category: 'rickshaw',      acOption: null,    group: 'other' },
  { key: 'bike',          label: 'Bike',             category: 'bike',          acOption: null,    group: 'other' },
];

export const CABTYPE_KEYS: Cabtype[] = CABTYPES.map(c => c.key);

const CABTYPE_BY_KEY = new Map<string, CabtypeMeta>(CABTYPES.map(c => [c.key, c]));

export const RATE_GROUP_LABEL: Record<RateGroup, string> = {
  cars: 'Cars',
  delivery: 'Delivery',
  other: 'Other',
};

/**
 * Cabtypes written by app builds that predate the AC question, plus `freight`,
 * which was removed from the app entirely. Historical ride documents still
 * carry them, so they are display-mapped rather than migrated. `mini` is
 * deliberately left without an AC answer: it never recorded one, so it stays
 * "Mini" rather than being invented into one of the two mini tiers.
 */
export const LEGACY_CABTYPE_LABEL: Record<string, string> = {
  mini: 'Mini',
  regular: 'Comfort · Non AC',
  ac: 'Comfort · AC',
  deliver: 'Car Delivery',
  freight: 'Freight',
};

/** Human label for any cabtype string, current or legacy. */
export const cabtypeLabel = (raw?: string | null): string => {
  const key = (raw || '').toLowerCase().trim();
  if (!key) return '—';
  return CABTYPE_BY_KEY.get(key)?.label ?? LEGACY_CABTYPE_LABEL[key] ?? raw!;
};

/** The base category a cabtype belongs to — for grouping current or legacy rides. */
export const cabtypeCategory = (raw?: string | null): RideCategory | null => {
  const key = (raw || '').toLowerCase().trim();
  const meta = CABTYPE_BY_KEY.get(key);
  if (meta) return meta.category;
  if (key === 'mini') return 'mini';
  if (key === 'regular' || key === 'ac') return 'comfort';
  if (key === 'deliver') return 'car_delivery';
  if (key === 'freight') return 'freight';
  return null;
};

// ─── Ride list filters ───────────────────────────────────────────────────────
// The rides list is filtered on the same two questions the rider is asked:
// which vehicle, and which flavour of the service. Every ride falls in exactly
// one vehicle bucket and at most one variant, so the counts shown beside each
// option are exact rather than overlapping.

export type RideVehicle =
  | 'mini' | 'comfort' | 'car' | 'bike' | 'rickshaw' | 'intercity' | 'other';

export type RideVariant = 'ac' | 'nonac' | 'delivery';

export interface RideClass {
  vehicle: RideVehicle;
  /** null for a ride whose type asks neither question — a plain bike or rickshaw. */
  variant: RideVariant | null;
}

export interface RideVehicleFilter {
  id: RideVehicle;
  label: string;
  hint: string;
}

/**
 * `car` is its own bucket rather than a tier: `car_delivery` carries no tier at
 * all — every Mini and every Comfort driver receives it — so folding it into
 * either tier would both misreport it and count it twice.
 */
export const RIDE_VEHICLE_FILTERS: RideVehicleFilter[] = [
  { id: 'mini',       label: 'Mini',       hint: 'mini_ac and mini_nonac' },
  { id: 'comfort',    label: 'Comfort',    hint: 'comfort_ac and comfort_nonac' },
  { id: 'car',        label: 'Car',        hint: 'car_delivery — untiered, offered to every car driver' },
  { id: 'bike',       label: 'Bike',       hint: 'bike and bike_delivery' },
  { id: 'rickshaw',   label: 'Rickshaw',   hint: 'rickshaw' },
  { id: 'intercity',  label: 'Inter-City', hint: 'city-to-city requests' },
  { id: 'other',      label: 'Other',      hint: 'retired or unrecognised ride types' },
];

export interface RideVariantFilter {
  id: RideVariant;
  label: string;
  hint: string;
  /** Vehicles that can actually produce this variant — the rest are disabled. */
  vehicles: RideVehicle[];
}

export const RIDE_VARIANT_FILTERS: RideVariantFilter[] = [
  { id: 'ac',       label: 'AC',       hint: 'the rider asked for air conditioning', vehicles: ['mini', 'comfort', 'other'] },
  { id: 'nonac',    label: 'Non AC',   hint: 'the rider declined air conditioning',  vehicles: ['mini', 'comfort', 'other'] },
  { id: 'delivery', label: 'Delivery', hint: 'a package, not a passenger',           vehicles: ['car', 'bike', 'intercity'] },
];

/** Shape the classifier needs — satisfied by both an RTDB and a Firestore ride. */
export interface ClassifiableRide {
  source?: string;
  cabtype?: string | null;
  rideCategory?: string | null;
  acOption?: string | null;
}

/**
 * Place a ride on the two filter axes. The cabtype key is authoritative because
 * the app writes it and `acOption` together; `acOption` is consulted only for
 * the legacy keys that predate the combined key, where it is the only record of
 * what the rider chose.
 */
export const classifyRide = (ride: ClassifiableRide): RideClass => {
  const raw = (ride.cabtype || ride.rideCategory || '').toLowerCase().trim();

  // City-to-city has its own cabtype vocabulary (private / sharing / hiace /
  // delivery) and never asks about AC.
  if (ride.source === 'citytocity') {
    return { vehicle: 'intercity', variant: raw === 'delivery' ? 'delivery' : null };
  }

  const ac = (ride.acOption || '').toLowerCase().trim();
  const acVariant: RideVariant | null = ac === 'ac' ? 'ac' : ac === 'nonac' ? 'nonac' : null;

  switch (raw) {
    case 'mini_ac':       return { vehicle: 'mini',     variant: 'ac' };
    case 'mini_nonac':    return { vehicle: 'mini',     variant: 'nonac' };
    case 'comfort_ac':    return { vehicle: 'comfort',  variant: 'ac' };
    case 'comfort_nonac': return { vehicle: 'comfort',  variant: 'nonac' };
    case 'car_delivery':
    case 'deliver':
    case 'delivery':      return { vehicle: 'car',      variant: 'delivery' };
    case 'bike':          return { vehicle: 'bike',     variant: null };
    case 'bike_delivery': return { vehicle: 'bike',     variant: 'delivery' };
    case 'rickshaw':      return { vehicle: 'rickshaw', variant: null };
    // Builds from before the AC question: the tier was the whole answer.
    case 'mini':          return { vehicle: 'mini',     variant: acVariant };
    case 'ac':            return { vehicle: 'comfort',  variant: 'ac' };
    case 'regular':       return { vehicle: 'comfort',  variant: acVariant ?? 'nonac' };
    case 'comfort':       return { vehicle: 'comfort',  variant: acVariant };
    default:              return { vehicle: 'other',    variant: acVariant };
  }
};

/** Can this variant occur at all for the chosen vehicle? */
export const variantAppliesTo = (
  variant: RideVariantFilter,
  vehicle: RideVehicle | 'all',
): boolean => vehicle === 'all' || variant.vehicles.includes(vehicle);

// ─── Fares ───────────────────────────────────────────────────────────────────

/** The app's fare formula: rate per km, plus a flat base. */
export const FARE_BASE = 2.5;

export const computeFare = (ratePerKm: number, distanceInKm: number): number =>
  ratePerKm * distanceInKm + FARE_BASE;

/** Currency is PKR everywhere in the portal — never "Rs" or "$". */
export const formatPKR = (amount: number, opts: { decimals?: number } = {}): string => {
  const d = opts.decimals ?? 0;
  return `PKR ${amount.toLocaleString('en-PK', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};

// ─── Rate resolution ─────────────────────────────────────────────────────────

/** `rates/rates` is a flat map; values have been written as both numbers and
 *  numeric strings over the life of the document, so reads stay tolerant. */
export type RatesMap = Record<string, unknown>;

/** A rate only counts if it parses to a number greater than zero. */
export const parseRate = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The fallback chain the app walks when resolving a per-km rate: it takes the
 * first key in the chain with a value > 0.
 */
export const RATE_FALLBACK_CHAIN: Record<Cabtype, string[]> = {
  mini_ac:       ['mini_ac', 'mini', 'ac'],
  mini_nonac:    ['mini_nonac', 'mini', 'regular'],
  comfort_ac:    ['comfort_ac', 'comfort', 'ac'],
  comfort_nonac: ['comfort_nonac', 'comfort', 'regular'],
  car_delivery:  ['car_delivery', 'deliver', 'delivery'],
  bike_delivery: ['bike_delivery', 'bike', 'deliver'],
  rickshaw:      ['rickshaw', 'mini'],
  bike:          ['bike'],
};

export interface ResolvedRate {
  /** The rate the app will actually charge, or null when nothing resolves. */
  value: number | null;
  /** Which key the value came from — may differ from the cabtype requested. */
  sourceKey: string | null;
  /** True when the cabtype's own key is unset and a fallback supplied the value. */
  fromFallback: boolean;
  /** True when no key in the chain has a value: the app shows no fare and the
   *  rider cannot book this type at all. */
  missing: boolean;
}

/** Resolve a cabtype's effective rate exactly the way the app does. */
export const resolveRate = (rates: RatesMap, key: Cabtype): ResolvedRate => {
  for (const candidate of RATE_FALLBACK_CHAIN[key]) {
    const value = parseRate(rates[candidate]);
    if (value !== null) {
      return { value, sourceKey: candidate, fromFallback: candidate !== key, missing: false };
    }
  }
  return { value: null, sourceKey: null, fromFallback: false, missing: true };
};

// ─── Commission ──────────────────────────────────────────────────────────────

export type CommissionKey = 'comission' | 'ctc_commission';

/**
 * `comission` is spelt with one "m" in the live document and is the canonical
 * key; the app accepts two older spellings behind it. There is no hard-coded
 * default behind either chain — with nothing set, drivers cannot offer on or
 * complete rides at all.
 */
export const COMMISSION_CHAIN: Record<CommissionKey, string[]> = {
  comission: ['comission', 'commission', 'commissionRate'],
  ctc_commission: ['ctc_commission', 'ctcCommission'],
};

export const COMMISSION_KEYS = Object.keys(COMMISSION_CHAIN) as CommissionKey[];

export const COMMISSION_META: Record<CommissionKey, { label: string; description: string }> = {
  comission: {
    label: 'In-City Commission',
    description: 'Taken from the driver’s wallet when an in-city ride completes. Stored as a decimal (0.1 = 10%); enter a whole percentage.',
  },
  ctc_commission: {
    label: 'City-to-City Commission',
    description: 'Taken on city-to-city rides and on every confirmed seat booking. Stored as a decimal (0.05 = 5%); enter a whole percentage.',
  },
};

/** The app reads commission with parseFloat and accepts either 0.1 or 10 for 10%. */
export const parseCommission = (v: unknown): number | null => {
  const n = parseRate(v);
  if (n === null) return null;
  if (n <= 1) return n;
  if (n < 100) return n / 100;
  return null;
};

export const resolveCommission = (rates: RatesMap, key: CommissionKey): ResolvedRate => {
  for (const candidate of COMMISSION_CHAIN[key]) {
    const value = parseCommission(rates[candidate]);
    if (value !== null) {
      return { value, sourceKey: candidate, fromFallback: candidate !== key, missing: false };
    }
  }
  return { value: null, sourceKey: null, fromFallback: false, missing: true };
};

// ─── Legacy rate keys ────────────────────────────────────────────────────────

/** Keys the current app reads by name. These are never deleted. */
export const CANONICAL_RATE_KEYS: string[] = [...CABTYPE_KEYS, ...COMMISSION_KEYS];

export interface LegacyRateKeyMeta {
  key: string;
  reason: string;
}

/**
 * Keys left in `rates/rates` by app versions that no longer exist. Several of
 * them still sit in a live fallback chain, so a cabtype with no rate of its own
 * may be priced entirely from one — deleting such a key without first writing
 * its value onto the canonical key takes the price away with it.
 * `rateKeyImpact` reports exactly that before anything is removed.
 */
export const LEGACY_RATE_KEYS: LegacyRateKeyMeta[] = [
  { key: 'mini',           reason: 'Old single Mini rate, from before Mini split into AC and Non AC. Still the fallback for mini_ac, mini_nonac and rickshaw.' },
  { key: 'regular',        reason: 'Old non-AC sedan rate. Still the fallback for comfort_nonac and mini_nonac.' },
  { key: 'ac',             reason: 'Old AC sedan rate. Still the fallback for comfort_ac and mini_ac.' },
  { key: 'comfort',        reason: 'Tier-wide Comfort rate, from before the AC split. Still the fallback for comfort_ac and comfort_nonac.' },
  { key: 'deliver',        reason: 'Old delivery rate. Still the fallback for car_delivery and bike_delivery.' },
  { key: 'delivery',       reason: 'Alternate spelling of the old delivery rate. Last fallback for car_delivery.' },
  { key: 'freight',        reason: 'Freight was removed from the app — nothing reads this key any more.' },
  { key: 'city-to-city',   reason: 'Unused: city-to-city fares are set by the rider, not from a per-km rate.' },
  { key: 'commission',     reason: 'Older spelling of the in-city commission. The canonical key is comission, with one "m".' },
  { key: 'commissionRate', reason: 'Older spelling of the in-city commission. The canonical key is comission, with one "m".' },
  { key: 'ctcCommission',  reason: 'Older spelling of the city-to-city commission. The canonical key is ctc_commission.' },
];

export const LEGACY_RATE_KEY_SET = new Set(LEGACY_RATE_KEYS.map(k => k.key));

/** A value that must be written onto a canonical key before a legacy key goes. */
export interface RatePromotion {
  /** The canonical key to write. */
  target: string;
  /** What that key is being priced at right now, through the legacy key. */
  value: number;
  /** Human label of what is being rescued. */
  label: string;
  /** Commissions are stored as a decimal fraction rather than a per-km rate. */
  isCommission: boolean;
}

export interface RateKeyImpact {
  /** Canonical keys priced from this legacy key right now. */
  promotions: RatePromotion[];
  /** Canonical keys that would be left with no value at all if it were deleted
   *  without promoting first. */
  breaks: string[];
  /** Nothing currently depends on this key — it can simply go. */
  safe: boolean;
}

/**
 * What deleting one legacy key from `rates/rates` would do to the prices the
 * app actually charges. A key is only "safe" when no canonical key resolves
 * through it.
 */
export const rateKeyImpact = (rates: RatesMap, key: string): RateKeyImpact => {
  const promotions: RatePromotion[] = [];
  const breaks: string[] = [];

  const without: RatesMap = { ...rates };
  delete without[key];

  for (const meta of CABTYPES) {
    const before = resolveRate(rates, meta.key);
    if (before.sourceKey !== key) continue;
    promotions.push({ target: meta.key, value: before.value!, label: meta.label, isCommission: false });
    if (resolveRate(without, meta.key).missing) breaks.push(meta.key);
  }

  for (const ck of COMMISSION_KEYS) {
    const before = resolveCommission(rates, ck);
    if (before.sourceKey !== key) continue;
    promotions.push({ target: ck, value: before.value!, label: COMMISSION_META[ck].label, isCommission: true });
    if (resolveCommission(without, ck).missing) breaks.push(ck);
  }

  return { promotions, breaks, safe: promotions.length === 0 };
};

export interface RateCleanupPlan {
  /** Legacy keys actually present in the document. */
  deletions: string[];
  /**
   * Canonical keys currently priced through one of those legacy keys. Each must
   * be written with its present value before the deletions land, or the price
   * disappears with the key.
   */
  promotions: RatePromotion[];
  /**
   * Canonical keys that already resolve to nothing. The cleanup neither causes
   * nor fixes these — they need a rate typed in — but an admin about to edit
   * this document should see them.
   */
  alreadyBroken: string[];
  /** Canonical keys that would still resolve to nothing once the plan applies. */
  wouldBreak: string[];
}

/**
 * Work out how to remove every legacy key from `rates/rates` without changing a
 * single price the app charges.
 *
 * The order matters. Promotions are computed against the document as it stands,
 * so each canonical key captures the value it is being charged at right now;
 * once those are written, nothing resolves through a legacy key any more and
 * all the deletions are safe to apply together in one atomic update.
 */
export const buildRateCleanupPlan = (rates: RatesMap): RateCleanupPlan => {
  const deletions = LEGACY_RATE_KEYS
    .map(k => k.key)
    .filter(k => rates[k] !== undefined);

  const promotions: RatePromotion[] = [];
  const alreadyBroken: string[] = [];

  for (const meta of CABTYPES) {
    const r = resolveRate(rates, meta.key);
    if (r.missing) { alreadyBroken.push(meta.key); continue; }
    // A fallback onto another *canonical* key (bike_delivery → bike) survives
    // the cleanup untouched, so only legacy sources need rescuing.
    if (r.sourceKey && r.sourceKey !== meta.key && LEGACY_RATE_KEY_SET.has(r.sourceKey)) {
      promotions.push({ target: meta.key, value: r.value!, label: meta.label, isCommission: false });
    }
  }

  for (const ck of COMMISSION_KEYS) {
    const r = resolveCommission(rates, ck);
    if (r.missing) { alreadyBroken.push(ck); continue; }
    if (r.sourceKey && r.sourceKey !== ck && LEGACY_RATE_KEY_SET.has(r.sourceKey)) {
      promotions.push({ target: ck, value: r.value!, label: COMMISSION_META[ck].label, isCommission: true });
    }
  }

  // Prove the plan: apply it to a copy and check nothing lost its price.
  const after: RatesMap = { ...rates };
  for (const p of promotions) after[p.target] = p.value;
  for (const key of deletions) delete after[key];

  const wouldBreak = [
    ...CABTYPES.filter(m => resolveRate(after, m.key).missing).map(m => m.key),
    ...COMMISSION_KEYS.filter(ck => resolveCommission(after, ck).missing),
  ].filter(k => !alreadyBroken.includes(k));

  return { deletions, promotions, alreadyBroken, wouldBreak };
};

// ─── Driver vehicle → ride types served ──────────────────────────────────────

export type DriverVehicleType = 'car' | 'rickshaw' | 'bike' | 'hiace' | 'freight' | 'unknown';

export const DRIVER_VEHICLE_TYPES: DriverVehicleType[] =
  ['car', 'rickshaw', 'bike', 'hiace', 'freight'];

/** Car tier on a driver application. Legacy records used "regular"/"ac" here. */
export type DriverCarClass = 'mini' | 'comfort' | '';

export interface NormalisedVehicle {
  vehicleType: DriverVehicleType;
  carClass: DriverCarClass;
  acOption: AcOption | null;
  /** True when the values were reconstructed from a legacy record. */
  normalised: boolean;
}

/**
 * Applications submitted against the old three-tier picker have no `acOption`
 * and folded the AC answer into `carClass`. Without reconstructing those two
 * fields the legacy drivers match none of the tier filters and vanish from the
 * list entirely.
 */
export const normaliseVehicle = (raw: {
  vehicleType?: string | null;
  carClass?: string | null;
  acOption?: string | null;
}): NormalisedVehicle => {
  const typeRaw = (raw.vehicleType || '').toLowerCase().trim();
  let vehicleType: DriverVehicleType = 'unknown';
  if ((DRIVER_VEHICLE_TYPES as string[]).includes(typeRaw)) {
    vehicleType = typeRaw as DriverVehicleType;
  } else if (typeRaw === 'van' || typeRaw === 'hi-ace') {
    vehicleType = 'hiace';
  } else if (typeRaw === 'motorcycle' || typeRaw === 'motorbike') {
    vehicleType = 'bike';
  }

  if (vehicleType !== 'car') {
    return { vehicleType, carClass: '', acOption: null, normalised: false };
  }

  const classRaw = (raw.carClass || '').toLowerCase().trim();
  const acRaw = (raw.acOption || '').toLowerCase().trim();

  let carClass: DriverCarClass = '';
  let acOption: AcOption | null = acRaw === 'ac' ? 'ac' : acRaw === 'nonac' ? 'nonac' : null;
  let normalised = false;

  if (classRaw === 'mini' || classRaw === 'comfort') {
    carClass = classRaw;
  } else if (classRaw === 'regular') {
    // legacy: the non-AC sedan tier
    carClass = 'comfort';
    if (acOption === null) acOption = 'nonac';
    normalised = true;
  } else if (classRaw === 'ac') {
    // legacy: the AC sedan tier
    carClass = 'comfort';
    if (acOption === null) acOption = 'ac';
    normalised = true;
  }

  // a mini/comfort record with no AC answer predates the question — the app
  // treats the absent answer as Non-AC
  if (carClass && acOption === null) {
    acOption = 'nonac';
    normalised = true;
  }

  return { vehicleType, carClass, acOption, normalised };
};

/**
 * The cabtypes a driver's feed actually receives. A car driver also serves car
 * deliveries and a bike driver also serves bike deliveries — same vehicle,
 * carrying a package instead of a person. Matching on the car tier is exact: a
 * Mini AC car only ever sees mini_ac requests.
 */
export const getServedCabtypes = (v: NormalisedVehicle): string[] => {
  switch (v.vehicleType) {
    case 'car':
      // without a tier the app builds an unmatched "<class>_<ac>" key, so the
      // driver only ever sees car deliveries
      return v.carClass && v.acOption
        ? [`${v.carClass}_${v.acOption}`, 'car_delivery']
        : ['car_delivery'];
    case 'bike':     return ['bike', 'bike_delivery'];
    case 'rickshaw': return ['rickshaw'];
    // "hiace" is not one of the rider-facing cabtypes, so nothing a rider can
    // book matches it — see isBookableCabtype below
    case 'hiace':    return ['hiace'];
    case 'freight':  return ['freight'];
    default:         return [];
  }
};

/** Is this served cabtype something a rider can actually request today? */
export const isBookableCabtype = (key: string): boolean =>
  CABTYPE_BY_KEY.has(key.toLowerCase().trim());

// ─── Driver list filter ──────────────────────────────────────────────────────

export interface VehicleFilterOption {
  id: string;
  label: string;
  vehicleType: DriverVehicleType;
  carClass?: DriverCarClass;
  acOption?: AcOption;
}

export const VEHICLE_FILTERS: VehicleFilterOption[] = [
  { id: 'car_mini_ac',       label: 'Mini · AC',        vehicleType: 'car', carClass: 'mini',    acOption: 'ac' },
  { id: 'car_mini_nonac',    label: 'Mini · Non AC',    vehicleType: 'car', carClass: 'mini',    acOption: 'nonac' },
  { id: 'car_comfort_ac',    label: 'Comfort · AC',     vehicleType: 'car', carClass: 'comfort', acOption: 'ac' },
  { id: 'car_comfort_nonac', label: 'Comfort · Non AC', vehicleType: 'car', carClass: 'comfort', acOption: 'nonac' },
  { id: 'rickshaw',          label: 'Rickshaw',         vehicleType: 'rickshaw' },
  { id: 'bike',              label: 'Bike',             vehicleType: 'bike' },
  { id: 'hiace',             label: 'Hiace',            vehicleType: 'hiace' },
  { id: 'freight',           label: 'Freight',          vehicleType: 'freight' },
];

/** Does a (normalised) driver vehicle match the chosen filter? */
export const matchesVehicleFilter = (v: NormalisedVehicle, option: VehicleFilterOption): boolean => {
  if (v.vehicleType !== option.vehicleType) return false;
  if (option.carClass && v.carClass !== option.carClass) return false;
  if (option.acOption && v.acOption !== option.acOption) return false;
  return true;
};

/** "Mini · AC", "Bike", "Unknown" — the driver's own tier, for display. */
export const vehicleTierLabel = (v: NormalisedVehicle): string => {
  if (v.vehicleType === 'unknown') return 'No vehicle type';
  if (v.vehicleType !== 'car') {
    return v.vehicleType.charAt(0).toUpperCase() + v.vehicleType.slice(1);
  }
  if (!v.carClass) return 'Car · tier not set';
  const tier = v.carClass === 'mini' ? 'Mini' : 'Comfort';
  return `${tier} · ${v.acOption === 'ac' ? 'AC' : 'Non AC'}`;
};
