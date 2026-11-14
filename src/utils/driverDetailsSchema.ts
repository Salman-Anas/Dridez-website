// ─── Editing a driver's details (dridez/schema.md §3.1, §3.2) ────────────────
//
// A driver's details live in two documents:
//   • users/{uid}: the name, phone and CNIC. The application keeps copies of
//     them (`fullName`, `phoneNumber`, `cnicNum`), so a change lands on both.
//   • driverProfileRequests/{id}: the vehicle and who owns it. Ride matching
//     reads the car class from here; `users.driverCarClass` mirrors it, and
//     `carMake` / `carModel` mirror the company and model.
//
// Validated with the app's own rules (dridez/screens/RequestDriverProfile.tsx).
// The vehicle type, documents and photos aren't editable here: a different
// vehicle means a new application. Saving never changes the review status,
// so nothing is pushed to the driver.
//
// Shared with the Admin-App (src/lib/driverDetailsSchema.ts); keep them equal.

import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { bareDigits, CNIC_RULE, PHONE_RULE, takenBy } from './userDetailsSchema';
import {
  getCompany, getEngineCc, getModel, getOwnerCnic, getOwnerName, getOwnership, getSeats,
  getVariant, getVehicle, getVehicleType,
  type DriverApplicationFields, type DriverCarClass, type VehicleOwnership,
} from './driverSchema';

/** Seats the app offers per vehicle (dridez/constants/vehicles.ts). Bikes have none. */
export const SEAT_RANGE: Partial<Record<string, { min: number; max: number }>> = {
  car: { min: 2, max: 7 },
  rickshaw: { min: 2, max: 6 },
};

export interface DriverDetails {
  firstName: string;
  lastName: string;
  phone: string;
  cnic: string;
  /** Cars only: "mini" or "comfort". */
  carClass: DriverCarClass;
  /** Kept as typed; "" when the vehicle has no seat count. */
  seats: string;
  company: string;
  model: string;
  variant: string;
  engineCc: string;
  plate: string;
  /** "" on applications from before the question was asked. */
  ownership: VehicleOwnership | '';
  ownerName: string;
  ownerCnic: string;
}

/** The parts of `users/{uid}` the form reads. */
export interface DriverAccountSource {
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  cnic?: string;
}

/** What `saveDriverDetails` wrote to each document. */
export interface DriverDetailsChanges {
  account: Record<string, string>;
  application: Record<string, string | number | null>;
}

/** The form's starting values: the account first, the application's copies after. */
export const driverDetailsOf = (app: DriverApplicationFields, account: DriverAccountSource | null): DriverDetails => {
  const [first = '', ...rest] = (account?.name || app.fullName || '').trim().split(/\s+/);
  const seats = getSeats(app);
  return {
    firstName: account?.firstName ?? first,
    lastName: account?.lastName ?? rest.join(' '),
    phone: account?.phone || app.phoneNumber || '',
    cnic: account?.cnic || app.cnicNum || '',
    carClass: getVehicleType(app) === 'car' ? getVehicle(app).carClass : '',
    seats: seats === null ? '' : String(seats),
    company: getCompany(app),
    model: getModel(app),
    variant: getVariant(app),
    engineCc: getEngineCc(app),
    plate: (app.carPlate || '').trim(),
    ownership: getOwnership(app) ?? '',
    ownerName: getOwnerName(app),
    ownerCnic: getOwnerCnic(app),
  };
};

const tidy = (f: DriverDetails): DriverDetails => ({
  ...f,
  firstName: f.firstName.trim(),
  lastName: f.lastName.trim(),
  phone: bareDigits(f.phone),
  cnic: bareDigits(f.cnic),
  seats: f.seats.trim(),
  company: f.company.trim(),
  model: f.model.trim(),
  variant: f.variant.trim(),
  engineCc: f.engineCc.trim().replace(/\s*cc$/i, ''),
  plate: f.plate.trim().toUpperCase(),
  // The owner's details are only kept when that isn't the driver, as in the app.
  ownerName: f.ownership === 'driver' ? f.ownerName.trim() : '',
  ownerCnic: f.ownership === 'driver' ? bareDigits(f.ownerCnic) : '',
});

const VEHICLE_TEXT: [keyof DriverDetails, string][] = [
  ['company', 'The company'], ['model', 'The model'], ['variant', 'The variant'],
  ['engineCc', 'The engine capacity'], ['plate', 'The number plate'],
];

const problemWith = (f: DriverDetails, had: DriverDetails, vehicleType: string): string | null => {
  if (!f.firstName) return 'Enter a first name.';
  if (!f.lastName) return 'Enter a last name.';
  if (f.phone !== had.phone && !PHONE_RULE.test(f.phone)) return 'The phone number must start with 03 and be 11 digits.';
  if ((f.cnic || had.cnic) && !CNIC_RULE.test(f.cnic)) return 'The CNIC must be 13 digits.';

  // Older applications may lack some of these; only refuse emptying a filled one.
  for (const [key, label] of VEHICLE_TEXT) {
    if (!f[key] && had[key]) return `${label} can't be left empty.`;
  }
  if (f.engineCc && !/^\d{2,4}$/.test(f.engineCc)) return 'The engine capacity must be a number of cc, like 1300.';
  const range = SEAT_RANGE[vehicleType];
  if (range && (f.seats || had.seats)) {
    const n = Number(f.seats);
    if (!Number.isInteger(n) || n < range.min || n > range.max) {
      return `Seats must be between ${range.min} and ${range.max}.`;
    }
  }
  if (f.ownership === 'driver') {
    if (!f.ownerName) return "Enter the owner's name.";
    if (!CNIC_RULE.test(f.ownerCnic)) return "The owner's CNIC must be 13 digits.";
  }
  return null;
};

/**
 * Checks the form and writes only what changed, to both documents in one
 * batch. `appId` is the application's document id, which differs from the uid
 * on some legacy records; `account` is null when the user document is missing,
 * and then only the application is written. Throws an Error whose message can
 * be shown as is.
 */
export const saveDriverDetails = async (args: {
  uid: string;
  appId: string;
  app: DriverApplicationFields;
  account: DriverAccountSource | null;
  form: DriverDetails;
}): Promise<DriverDetailsChanges> => {
  const { uid, appId, app, account } = args;
  const vehicleType = getVehicleType(app);
  const had = tidy(driverDetailsOf(app, account));
  const next = tidy(args.form);
  const problem = problemWith(next, had, vehicleType);
  if (problem) throw new Error(problem);

  const changed = (key: keyof DriverDetails) => next[key] !== had[key];
  const out: DriverDetailsChanges = { account: {}, application: {} };

  if (changed('firstName') || changed('lastName')) {
    const name = `${next.firstName} ${next.lastName}`;
    if (changed('firstName')) out.account.firstName = next.firstName;
    if (changed('lastName')) out.account.lastName = next.lastName;
    out.account.name = name;
    out.application.fullName = name;
  }
  if (changed('phone')) {
    out.account.phone = next.phone;
    out.application.phoneNumber = next.phone;
  }
  if (changed('cnic')) {
    out.account.cnic = next.cnic;
    out.application.cnicNum = next.cnic;
  }
  if (vehicleType === 'car' && changed('carClass')) {
    out.application.carClass = next.carClass;
    out.account.driverCarClass = next.carClass;
  }
  if (SEAT_RANGE[vehicleType] && changed('seats')) out.application.seats = next.seats ? Number(next.seats) : null;
  if (changed('company')) {
    out.application.vehicleCompany = next.company;
    out.application.carMake = next.company;
  }
  if (changed('model')) {
    out.application.vehicleModel = next.model;
    out.application.carModel = next.model;
  }
  if (changed('variant')) out.application.vehicleVariant = next.variant;
  if (changed('engineCc')) out.application.engineCc = next.engineCc;
  if (changed('plate')) out.application.carPlate = next.plate;
  if (changed('ownership')) out.application.vehicleOwnership = next.ownership;
  if (changed('ownerName')) out.application.ownerName = next.ownerName;
  if (changed('ownerCnic')) out.application.ownerCnic = next.ownerCnic;

  if (!account) out.account = {};
  if (!Object.keys(out.account).length && !Object.keys(out.application).length) return out;

  let duplicate: string | null = null;
  try {
    if (changed('phone') && await takenBy(uid, 'phone', next.phone)) {
      duplicate = 'Another account already uses this phone number.';
    } else if (changed('cnic') && next.cnic && await takenBy(uid, 'cnic', next.cnic)) {
      duplicate = 'Another account already uses this CNIC.';
    } else {
      const batch = writeBatch(db);
      if (Object.keys(out.application).length) batch.update(doc(db, 'driverProfileRequests', appId), out.application);
      if (Object.keys(out.account).length) batch.update(doc(db, 'users', uid), out.account);
      await batch.commit();
    }
  } catch (e) {
    console.error(e);
    throw new Error('Could not save the details. Check the connection and try again.');
  }
  if (duplicate) throw new Error(duplicate);
  return out;
};
