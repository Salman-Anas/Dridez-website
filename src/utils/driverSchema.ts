// ─── Driver application helpers ──────────────────────────────────────────────
// `driverProfileRequests` is mid-migration. The rewritten "Join as Driver" flow
// writes a structured vehicle/document set (vehicleType, carClass, seats,
// vehicleCompany/Model/Variant, engineCc, vehicleImages, registrationImg,
// status/rejectionReason), while older records only carry the flat legacy
// fields (carMake, carModel, carYear, carImg, cnicImg, driversLicense…).
// Everything that reads an application goes through these resolvers so both
// shapes render identically instead of showing blanks.

export interface DriverApplicationFields {
  /** Ownership — the request document id is the auth uid on new records. */
  userId?: string;
  userRef?: string;
  /** Legacy alias for `userId`. */
  userid?: string;

  fullName?: string;
  phoneNumber?: string;
  cnicNum?: string;
  email?: string;

  /** Vehicle (new schema). */
  vehicleType?: string;
  carClass?: string;
  seats?: number | null;
  vehicleCompany?: string;
  vehicleModel?: string;
  vehicleVariant?: string;
  engineCc?: string | number;
  carPlate?: string;

  /** Documents (new schema). */
  licenseImg?: string;
  vehicleImages?: string[];
  registrationImg?: string;

  freight?: boolean;
  status?: string;
  rejectionReason?: string;

  /** Legacy mirrors / legacy-only fields. */
  carMake?: string;
  carModel?: string;
  carYear?: string;
  carImg?: string;
  cnicImg?: string;
  cnicExp?: string;
  driversLicense?: string;
  driversLicenseExpiration?: string;
  isVerified?: boolean;
}

// ─── Status ──────────────────────────────────────────────────────────────────

export type AppStatus = 'pending' | 'approved' | 'rejected';

/**
 * Resolve the review status. New records carry `status`; legacy records only
 * had the `isVerified` boolean, so an approved legacy record still reads as
 * "approved" rather than falling into "pending".
 */
export const getStatus = (a: DriverApplicationFields): AppStatus => {
  const raw = (a.status || '').toLowerCase();
  if (raw === 'approved' || raw === 'verified' || raw === 'accepted') return 'approved';
  if (raw === 'rejected' || raw === 'declined') return 'rejected';
  if (raw === 'pending' || raw === 'submitted' || raw === 'in_review') return 'pending';
  if (a.isVerified) return 'approved';
  return 'pending';
};

export const STATUS_LABEL: Record<AppStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

// ─── Vehicle type & class ────────────────────────────────────────────────────

export type VehicleType = 'car' | 'rickshaw' | 'bike' | 'hiace' | 'freight' | 'unknown';

export const VEHICLE_TYPES: VehicleType[] = ['car', 'rickshaw', 'bike', 'hiace', 'freight'];

export const VEHICLE_TYPE_LABEL: Record<VehicleType, string> = {
  car: 'Car',
  rickshaw: 'Rickshaw',
  bike: 'Bike',
  hiace: 'Hiace',
  freight: 'Freight',
  unknown: 'Unknown',
};

/**
 * Legacy applications predate `vehicleType`; infer it from the `freight` flag,
 * and otherwise assume a car when any of the legacy car fields are filled in.
 */
export const getVehicleType = (a: DriverApplicationFields): VehicleType => {
  const raw = (a.vehicleType || '').toLowerCase().trim();
  if ((VEHICLE_TYPES as string[]).includes(raw)) return raw as VehicleType;
  if (raw === 'van' || raw === 'hi-ace') return 'hiace';
  if (raw === 'motorcycle' || raw === 'motorbike') return 'bike';
  if (a.freight) return 'freight';
  if (a.carMake || a.carModel || a.carYear || a.carPlate) return 'car';
  return 'unknown';
};

export type CarClass = 'mini' | 'regular' | 'ac' | '';

export const CAR_CLASS_LABEL: Record<Exclude<CarClass, ''>, string> = {
  mini: 'Mini',
  regular: 'Regular',
  ac: 'AC',
};

/** Car class only applies to `vehicleType === "car"`; blank everywhere else. */
export const getCarClass = (a: DriverApplicationFields): CarClass => {
  const raw = (a.carClass || '').toLowerCase().trim();
  return raw === 'mini' || raw === 'regular' || raw === 'ac' ? raw : '';
};

/** Bikes carry `null` seats — that is a real value, not a missing one. */
export const getSeats = (a: DriverApplicationFields): number | null => {
  const raw = a.seats as unknown;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return isNaN(n) ? null : n;
};

export const isFreight = (a: DriverApplicationFields): boolean =>
  a.freight === true || getVehicleType(a) === 'freight';

// ─── Vehicle identity (new fields → legacy mirrors) ──────────────────────────

export const getCompany = (a: DriverApplicationFields): string =>
  (a.vehicleCompany || a.carMake || '').trim();

export const getModel = (a: DriverApplicationFields): string =>
  (a.vehicleModel || a.carModel || '').trim();

export const getVariant = (a: DriverApplicationFields): string =>
  (a.vehicleVariant || '').trim();

export const getEngineCc = (a: DriverApplicationFields): string => {
  if (a.engineCc === null || a.engineCc === undefined || a.engineCc === '') return '';
  return String(a.engineCc).trim();
};

/** "Toyota Corolla GLi" — whatever parts of it exist. */
export const getVehicleTitle = (a: DriverApplicationFields): string =>
  [getCompany(a), getModel(a), getVariant(a)].filter(Boolean).join(' ');

// ─── Documents ───────────────────────────────────────────────────────────────

const clean = (v?: string) => (typeof v === 'string' && v.trim() ? v.trim() : '');

/** Driving licence photo — same field name on both schemas. */
export const getLicenceImg = (a: DriverApplicationFields): string => clean(a.licenseImg);

/** Vehicle ownership / registration proof — new schema only. */
export const getRegistrationImg = (a: DriverApplicationFields): string => clean(a.registrationImg);

/** CNIC photo attached to the application itself — legacy schema only. */
export const getCnicImg = (a: DriverApplicationFields): string => clean(a.cnicImg);

/**
 * 1–3 vehicle photos on new records; legacy records only ever had the single
 * `carImg`, which newer records also mirror — so de-duplicate before returning.
 */
export const getVehicleImages = (a: DriverApplicationFields): string[] => {
  const list = Array.isArray(a.vehicleImages) ? a.vehicleImages.map(clean).filter(Boolean) : [];
  const legacy = clean(a.carImg);
  if (legacy && !list.includes(legacy)) list.push(legacy);
  return list;
};

/** Every reviewable document on the application, in review order. */
export const getDocumentCount = (a: DriverApplicationFields): number =>
  (getLicenceImg(a) ? 1 : 0) + (getRegistrationImg(a) ? 1 : 0) +
  (getCnicImg(a) ? 1 : 0) + getVehicleImages(a).length;

// ─── Identity ────────────────────────────────────────────────────────────────

/**
 * The auth uid the application belongs to. New records store it three ways
 * (document id, `userId`, `userRef`); legacy records only had `userid` and a
 * random document id, so the fields win over the fallback id.
 */
export const getUid = (a: DriverApplicationFields, docId: string): string => {
  const fromRef = clean(a.userRef).replace(/^users\//, '');
  return clean(a.userId) || clean(a.userid) || fromRef || docId;
};
