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
  | 'mini' | 'comfort' | 'car_delivery' | 'rickshaw' | 'bike' | 'bike_delivery' | 'freight';

export type AcOption = 'ac' | 'nonac';

export type Cabtype =
  | 'mini_ac' | 'mini_nonac' | 'comfort_ac' | 'comfort_nonac' | 'car_delivery'
  | 'rickshaw' | 'bike' | 'bike_delivery' | 'freight';

/** UI grouping for the rate editor. */
export type RateGroup = 'cars' | 'delivery' | 'other' | 'freight';

export interface CabtypeMeta {
  key: Cabtype;
  label: string;
  category: RideCategory;
  acOption: AcOption | null;
  group: RateGroup;
}

/** The nine cabtypes, in the order the app shows them to riders. */
export const CABTYPES: CabtypeMeta[] = [
  { key: 'mini_ac',       label: 'Mini · AC',        category: 'mini',          acOption: 'ac',    group: 'cars' },
  { key: 'mini_nonac',    label: 'Mini · Non AC',    category: 'mini',          acOption: 'nonac', group: 'cars' },
  { key: 'comfort_ac',    label: 'Comfort · AC',     category: 'comfort',       acOption: 'ac',    group: 'cars' },
  { key: 'comfort_nonac', label: 'Comfort · Non AC', category: 'comfort',       acOption: 'nonac', group: 'cars' },
  { key: 'car_delivery',  label: 'Car Delivery',     category: 'car_delivery',  acOption: null,    group: 'delivery' },
  { key: 'rickshaw',      label: 'Rickshaw',         category: 'rickshaw',      acOption: null,    group: 'other' },
  { key: 'bike',          label: 'Bike',             category: 'bike',          acOption: null,    group: 'other' },
  { key: 'bike_delivery', label: 'Bike Delivery',    category: 'bike_delivery', acOption: null,    group: 'delivery' },
  { key: 'freight',       label: 'Freight',          category: 'freight',       acOption: null,    group: 'freight' },
];

export const CABTYPE_KEYS: Cabtype[] = CABTYPES.map(c => c.key);

const CABTYPE_BY_KEY = new Map<string, CabtypeMeta>(CABTYPES.map(c => [c.key, c]));

export const RATE_GROUP_LABEL: Record<RateGroup, string> = {
  cars: 'Cars',
  delivery: 'Delivery',
  other: 'Other',
  freight: 'Freight',
};

/**
 * Cabtypes written by app builds that predate the AC question. Historical ride
 * documents still carry them, so they are display-mapped rather than migrated.
 * `mini` is deliberately absent: it never recorded an AC answer, so it stays
 * "Mini" rather than being invented into one of the two mini tiers.
 */
export const LEGACY_CABTYPE_LABEL: Record<string, string> = {
  mini: 'Mini',
  regular: 'Comfort · Non AC',
  ac: 'Comfort · AC',
  deliver: 'Car Delivery',
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
  return null;
};

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
 * first key in the chain with a value > 0. `freight` has no fallback at all —
 * the freight booking screen reads rates["freight"] directly, so an unset key
 * breaks freight fares outright.
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
  freight:       ['freight'],
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

/**
 * Rate keys read directly by app builds still installed on real phones. They
 * are never deleted or renamed — only kept in sync — and several of them are
 * fallback sources for the current keys.
 */
export const LEGACY_RATE_KEYS = ['mini', 'regular', 'ac', 'comfort', 'deliver', 'delivery'] as const;

/** Rate keys that are neither a cabtype nor legacy, but still in active use. */
export const OTHER_RATE_KEYS = ['city-to-city', 'comission'] as const;

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
    // "hiace" is not one of the nine rider-facing cabtypes, so nothing a rider
    // can book matches it — see isBookableCabtype below
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
