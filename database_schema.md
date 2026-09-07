# Comprehensive Firebase Database Schema

This document outlines the complete schema used by your Android app across both **Cloud Firestore** and the **Firebase Realtime Database**, including optional and rarely used fields.

---

## 1. Cloud Firestore Collections

### `users` Collection
Stores customer profile, identity-verification and device/session information.
| Field | Type | Description |
| :--- | :--- | :--- |
| `uid` | `string` | The Firebase Auth UID (matches the document ID). |
| `name` | `string` | User's full name. |
| `phone` | `string` | User's phone number. |
| `email` | `string` | User's email address. |
| `emailVerified` | `boolean` | Whether the email has been confirmed. |
| `accountType` | `string` | `"user"` for customers. |
| `cnic` | `string` | 13-digit CNIC (National ID) number, unformatted. |
| `idCardFrontUrl` | `string` (URL) | Storage download URL for the CNIC front image. |
| `idCardBackUrl` | `string` (URL) | Storage download URL for the CNIC back image. |
| `verificationStatus` | `string` | `unverified` \| `pending` \| `verified` \| `rejected`. **Set by the Admin Portal.** |
| `devicePlatform` | `string` | `"android"` or `"ios"` — platform at registration. |
| `devicePlatformVersion` | `string` | OS API level / version string. |
| `lastLoginPlatform` | `string` | Platform used on the most recent login. |
| `lastLoginDevice` | `string` | Device name of the most recent login (e.g. `google Pixel 6 Pro`). |
| `lastLoginAt` | `timestamp` | Time of the most recent login. |
| `loginCount` | `number` | Total number of logins. |
| `createdAt` | `timestamp` | Account creation time. |
| `detailsSubmittedAt` | `timestamp` | When the user submitted their verification details. |
| `os` | `string` | *Legacy* device OS field — superseded by `devicePlatform`. |
| `isVerified` | `boolean` | *Legacy* verification flag — kept in sync with `verificationStatus`. |
| `driver` | `boolean` | `true` once the driver application is approved. **Set by the Admin Portal** — the app's drawer reads this to unlock driver mode. |
| `driverApplicationStatus` | `string` | Mirrors `driverProfileRequests/{uid}.status`. **Set by the Admin Portal.** |
| `driverStatusUpdatedAt` | `timestamp` | **Admin Portal Only**: when the driver decision was last written. |
| `driverVehicleType` | `string` | Mirror of `driverProfileRequests/{uid}.vehicleType`. |
| `driverCarClass` | `string` | Mirror of `driverProfileRequests/{uid}.carClass`. |
| `driverAcOption` | `string` | Mirror of `driverProfileRequests/{uid}.acOption`. |

#### `users/{uid}/loginHistory` Subcollection
One document per login/session event.
| Field | Type | Description |
| :--- | :--- | :--- |
| `at` | `timestamp` | When the event occurred. |
| `event` | `string` | Event type, e.g. `"login"`. |
| `method` | `string` | How the session started, e.g. `"restored_session"`. |
| `platform` | `string` | `"android"` or `"ios"`. |
| `osVersion` | `string` | Device OS version. |
| `appVersion` | `string` | App version at the time of login. |
| `device` | `string` | Full device name. |
| `brand` / `manufacturer` / `model` | `string` | Device hardware identifiers. |

### `driverProfileRequests` Collection
Stores every "Join as Driver" application. The document ID is the applicant's auth UID.
The mobile app rewrote this flow, so documents come in two shapes — the Admin Portal
reads both through `src/utils/driverSchema.ts`.

**Current schema**
| Field | Type | Description |
| :--- | :--- | :--- |
| `userId` | `string` | The Firebase Auth UID of the applicant (matches the document ID). |
| `userRef` | `string` | Path reference to the account, `"users/{uid}"`. |
| `userid` | `string` | *Legacy alias* for `userId`. |
| `fullName` | `string` | Applicant's full name — copied from `users/{uid}`. |
| `phoneNumber` | `string` | Contact number — copied from `users/{uid}`. |
| `cnicNum` | `string` | CNIC (National ID) number — copied from `users/{uid}`. |
| `email` | `string` | Email address — copied from `users/{uid}`. |
| `vehicleType` | `string` | `car` \| `rickshaw` \| `bike` \| `hiace` \| `freight`. |
| `carClass` | `string` | `mini` \| `comfort` — only when `vehicleType === "car"`, otherwise `""`. Legacy records stored `regular` (non-AC sedan) or `ac` (AC sedan) here. |
| `acOption` | `string` | `ac` \| `nonac` — cars only; absent on records predating the AC question, which the portal reads back as `nonac`. |
| `seats` | `number` \| `null` | Passenger seats; `null` for bikes. |
| `vehicleCompany` | `string` | Vehicle manufacturer (e.g., Toyota). |
| `vehicleModel` | `string` | Vehicle model (e.g., Corolla). |
| `vehicleVariant` | `string` | Trim/variant (e.g., GLi). |
| `engineCc` | `string`/`number` | Engine displacement in cc. |
| `carPlate` | `string` | Vehicle number plate. |
| `licenseImg` | `string` (URL) | Driving licence photo. |
| `vehicleImages` | `string[]` (URLs) | 1–3 photos of the vehicle. |
| `registrationImg` | `string` (URL) | Vehicle ownership / registration proof. |
| `freight` | `boolean` | `true` when `vehicleType === "freight"`. |
| `status` | `string` | `pending` \| `approved` \| `rejected`. **Set by the Admin Portal.** |
| `rejectionReason` | `string` | Shown to the driver in the app when rejected; they can fix it and resubmit. **Set by the Admin Portal.** |
| `submittedAt` | `timestamp` | Server timestamp of submission. |
| `carMake` / `carModel` / `carImg` | `string` | Legacy mirrors of `vehicleCompany` / `vehicleModel` / first `vehicleImages` entry. |
| `reviewedAt` | `timestamp` | **Admin Portal Only**: when the decision was made. |
| `reviewedBy` | `string` | **Admin Portal Only**: who made the decision. |
| `isVerified` | `boolean` | *Legacy* approval flag — the portal keeps it in sync with `status`. |

**Legacy-only fields** (older applications; the portal falls back to these so existing records still render)
| Field | Type | Description |
| :--- | :--- | :--- |
| `carYear` | `string` | Year of vehicle manufacture. |
| `cnicImg` | `string` (URL) | CNIC photo uploaded with the application itself. |
| `cnicExp` | `string` | CNIC expiration date. |
| `driversLicense` | `string` | Licence identification number. |
| `driversLicenseExpiration` | `string` | Licence expiration date. |
| `driver` | `string` | Static flag set to `"yes"`. |

> **Approval writes two documents.** The app's drawer reads `users/{uid}.driver` to unlock
> driver mode, while the portal reads `status` — so approving must set
> `driverProfileRequests/{uid}.status = "approved"` **and** `users/{uid}.driver = true`, or the
> driver stays locked out. The portal commits both in a single `writeBatch`, and mirrors the
> decision into `users/{uid}.driverApplicationStatus`.

### `tickets` Collection (Support & Complaints)
| Field | Type | Description |
| :--- | :--- | :--- |
| `title` | `string` | Subject of the support ticket. |
| `description` | `string` | Detailed complaint or suggestion. |
| `image` | `string` (URL) | Optional image attachment URL. |
| `status` | `string` | Ticket status (e.g., `"open"`, `"closed"`). |
| `user` | `string` | The UID of the user who submitted the ticket. |
| `date` | `timestamp` | Date and time the ticket was created. |

### `citytocity` Collection (Inter-City Ride Requests)
| Field | Type | Description |
| :--- | :--- | :--- |
| `rider` | `string` | The UID of the rider requesting the trip. |
| `pickup` | `string` / `object` | Pickup location details. |
| `dropoff` | `string` / `object` | Dropoff location details. |
| `cabtype` | `string` | One of the nine ride types — see the Ride Taxonomy section below. |
| `rideCategory` | `string` | The base choice behind `cabtype`, so rides can be grouped without parsing keys. |
| `acOption` | `string` \| `null` | `ac` \| `nonac` for the two car tiers; `null` otherwise. |
| `price` | `number` | Offered price for the trip. |
| `passengers` | `number` | Number of passengers traveling. |
| `detail` | `string` | Additional ride details or instructions. |
| `receiver` | `string` | Optional: Information if receiving goods/freight. |
| `status` | `string` | Current ride status (e.g., `"pending"`, `"ongoing"`). |
| `time` | `timestamp` | Time the ride was requested. |

### `citytocity_offers` Collection
Stores counter-offers made by drivers on `citytocity` ride requests.

### `ratings` Collection
| Field | Type | Description |
| :--- | :--- | :--- |
| `driver` | `string` | UID of the driver being rated. |
| `rider` | `string` | UID of the rider leaving the rating. |
| `rating` | `number` | Rating out of 5 stars. |
| `review` | `string` | Text review/feedback. |
| `rideId` | `string` | Reference to the associated ride. |

### `rates/rates` Document
A flat map of ride-type key → per-km rate in PKR. The app's fare formula is
`price = rate * distanceInKm + 2.5`.

When a ride type's own key is unset the app walks a fallback chain and takes the
first key with a value greater than zero:

| Ride type | Fallback chain |
| :--- | :--- |
| `mini_ac` | `mini_ac` → `mini` → `ac` |
| `mini_nonac` | `mini_nonac` → `mini` → `regular` |
| `comfort_ac` | `comfort_ac` → `comfort` → `ac` |
| `comfort_nonac` | `comfort_nonac` → `comfort` → `regular` |
| `car_delivery` | `car_delivery` → `deliver` → `delivery` |
| `bike_delivery` | `bike_delivery` → `bike` → `deliver` |
| `rickshaw` | `rickshaw` → `mini` |
| `bike` | `bike` |
| `freight` | `freight` — **no fallback** |

A key with no value anywhere in its chain means the app shows no fare and the
rider cannot book that type. **`freight` is the sharpest case**: the freight
booking screen reads `rates["freight"]` directly, so leaving it unset breaks
freight fares entirely.

The document also holds `city-to-city` (intercity per-km rate) and `comission`
(platform cut, stored as a decimal multiplier — `0.1` means 10%).

**Legacy keys** — `mini`, `regular`, `ac`, `comfort`, `deliver`, `delivery` — are
read directly by app builds still installed on real phones, and several act as
fallback sources above. They are never deleted or renamed, only kept in sync;
the Settings page keeps them editable under a collapsed "Legacy" section. Values
have been written as both numbers and numeric strings over the document's life,
so readers parse tolerantly and writers preserve whatever type a key already has.

---

## 1b. Ride Taxonomy

Riders pick a category first, and for the two car tiers are then asked AC or
Non-AC. The two answers are combined into a single `cabtype` string, which is
written onto every ride request, keys `rates/rates`, and is what the driver feed
filters on. These strings are a contract with the mobile client and are defined
once in `src/utils/rideTaxonomy.ts`.

| `cabtype` | Label | `rideCategory` | `acOption` |
| :--- | :--- | :--- | :--- |
| `mini_ac` | Mini · AC | `mini` | `ac` |
| `mini_nonac` | Mini · Non AC | `mini` | `nonac` |
| `comfort_ac` | Comfort · AC | `comfort` | `ac` |
| `comfort_nonac` | Comfort · Non AC | `comfort` | `nonac` |
| `car_delivery` | Car Delivery | `car_delivery` | `null` |
| `rickshaw` | Rickshaw | `rickshaw` | `null` |
| `bike` | Bike | `bike` | `null` |
| `bike_delivery` | Bike Delivery | `bike_delivery` | `null` |
| `freight` | Freight | `freight` | `null` |

**Legacy cabtypes** still present in historical rides are display-mapped, not
migrated: `regular` → Comfort · Non AC, `ac` → Comfort · AC, `deliver` → Car
Delivery. `mini` stays "Mini" — it never recorded an AC answer, so it is not
invented into one of the two mini tiers.

### Which ride types a driver receives
| `vehicleType` | Receives |
| :--- | :--- |
| `car` | `<carClass>_<acOption>`, `car_delivery` |
| `bike` | `bike`, `bike_delivery` |
| `rickshaw` | `rickshaw` |
| `hiace` | `hiace` |
| `freight` | `freight` |

A car driver also serves car deliveries and a bike driver bike deliveries — the
same vehicle carrying a package instead of a person. Matching on the car tier is
exact: a Mini AC car only ever sees `mini_ac` requests, never `mini_nonac` or
`comfort_ac`. A driver with no `vehicleType` matches nothing and silently
receives no work, which the Drivers page flags on the row.

Note that `hiace` is not one of the nine rider-facing cabtypes, so no rider
request currently matches a Hiace driver.

The same three values are mirrored on `users/{uid}` as `driverVehicleType`,
`driverCarClass` and `driverAcOption`.

---

## 2. Realtime Database (RTDB) Paths
Realtime Database is used for live tracking, chat, and active intra-city rides.

### `rides/` (Active & Local Rides)
Used for creating new standard/freight rides where drivers can listen for requests.
| Field | Type | Description |
| :--- | :--- | :--- |
| `pickup` | `object` | Pickup coordinates & address details. |
| `dropoff` | `object` | Dropoff coordinates & address details. |
| `cabtype` | `string` | One of the nine ride types — see the Ride Taxonomy section below. |
| `distance` | `string`/`number`| Estimated distance of the trip. |
| `duration` | `string`/`number`| Estimated time duration of the trip. |
| `price` | `number` | Offered price. |
| `status` | `string` | Ride status (`"pending"`, `"ongoing"`, `"completed"`, etc.). |
| `time` | `timestamp` | Time the ride was requested. |
| `rider` | `string` | UID of the rider. |
| `driver` | `string` | UID of the assigned driver (added when accepted). |
| `receiver` | `string` | *(Rare)* Information if the trip involves a receiver. |
| `items` | `string` | *(Rare)* Details of items (used mainly for freight). |
| `when` | `string` / `Date` | *(Rare)* Scheduled date for the ride. |
| `freightSize` | `string` | *(Rare)* Size of the freight payload. |

### `rides_driver_location/`
Stores live location data of drivers while a ride is active.
| Field | Type | Description |
| :--- | :--- | :--- |
| `latitude` | `number` | Driver's current latitude. |
| `longitude` | `number` | Driver's current longitude. |
| `heading` | `number` | Direction the driver is facing/moving. |

### `rides_driver_chat/`
Stores live chat messages between the driver and rider for an active ride.
