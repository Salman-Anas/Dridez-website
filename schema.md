# Dridez — Data Schema & Admin Portal Contract

This document describes every piece of data the Dridez mobile app reads and
writes, and exactly what the admin portal must read and write so that the app
behaves correctly. It was produced from the app's source code **and** checked
against the live database (project `dridez-93e11`).

If you are building or updating the admin portal, treat the **"Portal must"**
notes as requirements: field names, value spellings and types matter, because
the app and the Cloud Functions match on them exactly. A misspelt status or a
number stored where a string is expected will silently break a flow.

---

## 1. Environment

| Thing | Value |
|---|---|
| Firebase project | `dridez-93e11` |
| Firestore | default database, location `nam5` (US) |
| Realtime Database | `https://dridez-93e11-default-rtdb.firebaseio.com` (us-central1) |
| Cloud Functions | 2nd gen, Node 22, `us-central1`, source in `functions/` of the app repo |
| Auth | Firebase Auth (email + password). `uid` is the key everywhere below. |
| Currency | PKR, whole rupees |

### Where live vs. historical data lives

- **Realtime Database (RTDB)** holds *live, fast-changing* state: in-city ride
  requests and trips in progress, the driver's moving position, trip chat, and
  which drivers are online.
- **Firestore** holds *records*: users, driver applications, wallets, rates,
  completed/cancelled in-city ride history, all city-to-city data, ratings,
  support tickets.

### Conventions

- **Timestamps come in two forms.** Fields written by the app as plain numbers
  (`createdAt`, `acceptedAt`, `completedAt`, `expiresAt`, `departAt`, …) are
  **milliseconds since epoch (number)**. Fields written with
  `serverTimestamp()` (`submittedAt`, `lastLoginAt`, `updatedAt`, …) are
  **Firestore Timestamps**. The tables below say which. Handle both when
  displaying dates.
- **Money** is a number of whole rupees, except in `rates/rates`, where values
  are often **strings** (see §3.4).
- **Never hard-delete** users, rides, wallets or ledger entries from the portal.
  History and wallet balances are reconstructed from them.

---

## 2. Cloud Functions — what portal writes trigger

The app sends **all push notifications from Cloud Functions** reacting to
database writes. Several of those writes are made **by the portal**, so the
portal gets notifications "for free" as long as it writes the right fields:

| Portal write | Notification sent to | Trigger |
|---|---|---|
| `users/{uid}.driver` changes to `true` | that user: "You're approved to drive" | `onUserUpdated` |
| `users/{uid}.verificationStatus` → `"verified"` | user: "Your account is verified" | `onUserUpdated` |
| `users/{uid}.verificationStatus` → `"rejected"` | user: "Verification needs another look" | `onUserUpdated` |
| `driverProfileRequests/{uid}.status` → `"rejected"` | user: "Your driver application needs changes" | `onDriverApplicationUpdated` |
| `wallets/{uid}.balance` increases | driver: "PKR X added to your balance" | `onWalletUpdated` |
| `wallets/{uid}.balance` drops below 200 | driver: "Low balance" | `onWalletUpdated` |
| `tickets/{id}.comment` set/changed | ticket owner: "Support replied" | `onTicketUpdated` |
| `tickets/{id}.status` changed | ticket owner: "Your support ticket is …" | `onTicketUpdated` |

Other functions (rides, offers, chat, city-to-city, bookings) react to app
writes; the portal doesn't need to do anything for them.

**Server-side money movement:** `onTripBookingCreated/Updated` and
`onDriverTripUpdated` **charge and refund the city-to-city commission** on
driver-posted trip bookings (see §3.12). The portal must not duplicate this.

---

## 3. Firestore collections

### 3.1 `users/{uid}` — every account (riders and drivers)

One document per Firebase Auth user. A driver is a user with extra fields; the
rider and driver sides are the **same account**.

| Field | Type | Written by | Meaning |
|---|---|---|---|
| `uid` | string | app | Same as the document id |
| `name` | string | app | Full name ("First Last") |
| `firstName`, `lastName` | string | app | Name halves |
| `phone` | string | app (at registration only) | `03XXXXXXXXX`, 11 digits. **Locked in the app after registration — only the portal/support can change it.** |
| `email` | string | app | Login email |
| `emailVerified` | boolean | app | |
| `accountType` | string | app | Always `"user"` |
| `profileCompleted` | boolean | app | Name + phone present |
| `profileCompletedAt`, `createdAt` | Timestamp | app | |
| `devicePlatform` | `"android"` \| `"ios"` | app | Platform at registration |
| `devicePlatformVersion` | string | app | |
| `lastLoginAt` | Timestamp | app | |
| `lastLoginPlatform` | `"android"` \| `"ios"` | app | |
| `lastLoginDevice` | string | app | |
| `loginCount` | number | app | |
| `expoPushTokens` | string[] | app | Push tokens of this user's phones. **Portal: read-only.** The server prunes dead ones. |
| `pushTokenUpdatedAt` | Timestamp | app | |
| **Identity verification** | | | |
| `verificationStatus` | `"unverified"` \| `"verified"` \| `"rejected"` | app sets `unverified`; **portal sets `verified` / `rejected`** | Riders can't book until `verified` |
| `verificationSubmitted` | boolean | app | `true` once the user has sent details for review |
| `verificationSubmittedAt` | Timestamp | app | |
| `verifiedName` | string | app | Name as on ID card |
| `cnic` | string | app | 13 digits, no dashes. Unique per account — checked by the `checkAccountUnique` Cloud Function (as are `phone` and `email`). |
| `address` | string | app | |
| `idCardFrontUrl`, `idCardBackUrl` | string (URL) | app (older flow) | Storage URLs, may be absent |
| `rejectionReason` | string | **portal** | Shown to the user when `verificationStatus` is `rejected` |
| `verifiedBy` | string | **portal** | Admin who decided |
| `verificationUpdatedAt` | Timestamp | **portal** | |
| `isVerified` | boolean | **portal** (legacy mirror) | Keep equal to `verificationStatus === "verified"` |
| **Driver** | | | |
| `driver` | boolean | **portal** | **`true` unlocks driver mode in the app.** This is the switch. |
| `driverApplicationStatus` | `"pending"` \| `"approved"` \| `"rejected"` | app sets `pending`; **portal sets the rest** | Mirror of the application status |
| `driverProfileRef` | string | app | `"driverProfileRequests/{uid}"` |
| `driverVehicleType`, `driverCarClass` | string | app | Mirror of the application |
| `driverAcOption` | string | app | **Obsolete** — always `""` now. Ignore. |
| `driverStatusUpdatedAt` | Timestamp | **portal** | |

**Portal must — verify a rider:**
```
users/{uid}: verificationStatus = "verified", isVerified = true,
             verifiedBy = <admin>, verificationUpdatedAt = serverTimestamp()
```
**Portal must — reject verification:**
```
users/{uid}: verificationStatus = "rejected", isVerified = false,
             rejectionReason = "<shown to user>", verifiedBy, verificationUpdatedAt
```
When the user resubmits, the app sets `verificationStatus` back to
`"unverified"` and `verificationSubmitted = true` — that is the review queue:
**`verificationSubmitted == true && verificationStatus == "unverified"`**.

#### 3.1.1 `users/{uid}/loginHistory/{autoId}` — audit log (app writes, portal reads)

| Field | Type | Notes |
|---|---|---|
| `event` | `"signup"` \| `"login"` \| `"logout"` \| `"account_deleted"` \| `"details_updated"` | |
| `method` | string | e.g. `password`, `google`, `restored_session` (login only) |
| `at` | Timestamp | |
| `platform`, `osVersion`, `device`, `brand`, `manufacturer`, `model`, `appVersion` | string | Device info |

---

### 3.2 `driverProfileRequests/{uid}` — driver applications

Document id = the user's `uid`. Created/edited by the app, **decided by the portal**.

| Field | Type | Meaning |
|---|---|---|
| `userId`, `userid` | string | The applicant's uid (`userid` is a legacy duplicate — keep both) |
| `userRef` | string | `"users/{uid}"` |
| `fullName`, `phoneNumber`, `cnicNum`, `email` | string | Copied from the user account |
| `vehicleType` | `"car"` \| `"rickshaw"` \| `"bike"` \| `"hiace"` | **Freight has been removed** from the app; old docs may still say `freight` |
| `carClass` | `"mini"` \| `"comfort"` \| `""` | Cars only. Legacy values `"regular"` and `"ac"` both mean **comfort**. |
| `acOption` | string | **Obsolete** — drivers are no longer asked. Always `""` on new submissions; old docs may say `ac`/`nonac`. Ignore it. |
| `seats` | number \| null | Passenger seats (null for bikes) |
| `vehicleCompany`, `vehicleModel`, `vehicleVariant` | string | e.g. Toyota / Corolla / GLi |
| `engineCc` | string | |
| `carPlate` | string | Upper-case |
| `carMake`, `carModel`, `carImg` | string | Legacy mirrors of company/model/first photo |
| `licenseImg` | string (URL) | Driving licence photo |
| `vehicleImages` | string[] (URLs) | Up to 3 vehicle photos |
| `registrationImg` | string (URL) | Registration proof |
| `freight` | boolean | **Obsolete.** Ignore. |
| `driver` | string | Always `"yes"` (legacy) |
| `status` | `"pending"` \| `"approved"` \| `"rejected"` | App sets `pending` on submit/resubmit; **portal decides** |
| `submittedAt` | Timestamp | |
| `rejectionReason` | string | **Portal** — shown to the applicant |
| `reviewedBy`, `reviewedAt` | string / Timestamp | **Portal** |
| `isVerified` | boolean | **Portal** (legacy mirror of approved) |

**What the app matches rides on:** a car driver sees in-city requests of their
tier only — `mini` sees `mini_ac` + `mini_nonac`, `comfort` sees
`comfort_ac` + `comfort_nonac` (both also see `car_delivery`); a bike sees
`bike` + `bike_delivery`; rickshaw/hiace see their own type. AC is **not** a
driver attribute any more — each ride carries the rider's AC choice.

**Portal must — approve a driver (all of these):**
```
driverProfileRequests/{uid}: status = "approved", isVerified = true,
                             reviewedBy, reviewedAt = serverTimestamp(), rejectionReason = ""
users/{uid}: driver = true, driverApplicationStatus = "approved",
             driverStatusUpdatedAt = serverTimestamp()
```
`users.driver = true` is what actually unlocks driver mode and sends the
"approved" push.

**Portal must — reject an application:**
```
driverProfileRequests/{uid}: status = "rejected", rejectionReason = "<shown to driver>",
                             reviewedBy, reviewedAt
users/{uid}: driverApplicationStatus = "rejected", driverStatusUpdatedAt
```
(Do not set `users.driver = false` for a first-time applicant — it was never
true. To **revoke** an approved driver, set `users.driver = false`.)

---

### 3.3 `wallets/{uid}` — driver prepaid balance

Commission is taken from this balance. The app creates the wallet (with a
starting credit) the first time a driver opens the driver side.

| Field | Type | Meaning |
|---|---|---|
| `balance` | number | PKR. **May go negative** (commission on a finished ride is always taken). A driver whose balance can't cover a ride's commission can't offer on it. |
| `currency` | `"PKR"` | |
| `openingCredit` | number | Starting credit given on creation (currently 1000) |
| `createdAt`, `updatedAt` | Timestamp | |

#### 3.3.1 `wallets/{uid}/entries/{entryId}` — ledger (one entry per money movement)

| `type` | Written by | `entryId` | Fields |
|---|---|---|---|
| `commission` | app (driver completes an in-city ride) | the ride id | `amount` (negative), `rate`, `fare`, `rideId`, `balanceAfter`, `at` |
| `ctc_commission` | app (driver completes a rider-posted city ride) | `ctc_{rideId}` | same fields |
| `ctc_commission` | **server** (rider books seats on a driver trip) | `trip_{bookingId}_{ms}` | `amount` (negative), `rate`, `fare`, `bookingId`, `tripId`, `balanceAfter`, `at` |
| `ctc_commission_refund` | **server** (booking or trip cancelled) | `trip_{bookingId}_{ms}_refund` | `amount` (positive), `bookingId`, `tripId`, `balanceAfter`, `at` |
| `topup` *(recommended — see below)* | **portal** | auto id | `amount` (positive), `method`, `reference`, `by`, `balanceAfter`, `at` |

Entry ids are deterministic so that a retried completion can never charge twice.

**Portal must — top up a driver (use a transaction):**
```
read wallets/{uid}.balance
wallets/{uid}: balance = balance + amount, updatedAt = serverTimestamp()
wallets/{uid}/entries/{autoId}: { type: "topup", amount, method, reference,
                                  by: <admin>, balanceAfter, at: serverTimestamp() }
```
The balance increase alone sends the driver a "PKR X added" push.

**Commission reporting:** sum `-amount` of `commission` + `ctc_commission`
entries, minus `ctc_commission_refund` amounts, per period / per driver.

---

### 3.4 `rates/rates` — fares and commission (single document)

**Values are read with `parseFloat`/`Number`, so numbers or numeric strings
both work** — the existing document mixes both. Keep new values consistent
with what's already there.

| Key | Current value | Used for |
|---|---|---|
| `comission` *(one "m" — do not rename without also keeping this key)* | `"0.1"` | **In-city commission**, 10%. Accepts `0.1` or `10`. |
| `ctc_commission` | `"0.05"` | **City-to-city commission**, 5%. Same format. |
| `mini_ac` | `55` | PKR per km, Mini with AC |
| `mini_nonac` | `50` | Mini without AC |
| `comfort_ac` | `85` | Comfort with AC |
| `comfort_nonac` | `80` | Comfort without AC |
| `car_delivery` | *(not set)* | Falls back to `deliver`, then `delivery` |
| `bike_delivery` | *(not set)* | Falls back to `bike`, then `deliver` |
| `rickshaw` | `50` | Falls back to `mini` |
| `bike` | `30` | |
| `deliver` | `"100"` | Legacy; still used as a fallback |
| `mini` | `"35"` | Legacy; fallback for Mini and rickshaw |
| `ac`, `regular` | `"150"`, `"100"` | Legacy (old Comfort AC / non-AC); fallbacks only |
| `freight` | `"300"` | **Unused** — freight was removed |
| `city-to-city` | `"80"` | **Unused** by the app (city-to-city fares are set by the rider) |

The app also accepts `commission` or `commissionRate` for the in-city rate and
`ctcCommission` for the city rate, but **`comission` and `ctc_commission` are
the canonical keys**.

**Portal must:** provide an editor for at least `comission`, `ctc_commission`,
`mini_ac`, `mini_nonac`, `comfort_ac`, `comfort_nonac`, `car_delivery`,
`bike_delivery`, `rickshaw`, `bike`. Validate commission as a fraction between
0 and 1 (or a percentage 1–99). There is **no hard-coded fallback** in the app:
if a commission key is missing or invalid, drivers can't offer or complete
rides until it's fixed.

---

### 3.5 `config/appVersion` — forced/optional app update (**does not exist yet**)

Read by the app on launch (before login, so it must be publicly readable).

```
config/appVersion
  enabled: boolean                 // false = never prompt
  android: {
    latestVersion: "3.8.0"         // live on Play Store → optional "update" prompt
    minVersion:    "3.7.0"         // older than this → blocking "update required" screen
    storeUrl:      "https://play.google.com/store/apps/details?id=com.dridez.dridez2"
    notes:         "What's new…"   // optional, shown in the prompt
  }
  ios: { same four fields; storeUrl = "https://apps.apple.com/app/id<AppStoreId>" }
```
Versions are dotted strings compared numerically (`3.10.0` > `3.9.2`).

**Portal must:** offer an editor for this document. Warn loudly before raising
`minVersion`: it locks every older install out of the app.

---

### 3.6 `rides/{rideId}` — in-city ride **history**

Written when an in-city ride ends (completed by the driver, or cancelled after
a driver was accepted). Rides that were never accepted are **not** kept. The
id matches the live RTDB ride id (§4.1). Shape = the RTDB ride plus:

| Field | Type | Meaning |
|---|---|---|
| `status` | `"completed"` \| `"cancelled"` | |
| `cancelledBy` | `"rider"` \| `"driver"` | On cancelled rides |
| `completedAt`, `cancelledAt` | number (ms) | |
| `date` | string | Locale date string (legacy display field) |
| `commission`, `commissionRate` | number | What was charged, and at what rate |
| `riderReview` | `"rated"` \| `"skipped"` | Set once the rider rates (`skipped` is legacy) |
| `riderRating` | number 1–5 | |
| `riderReviewAt` | Timestamp | |

---

### 3.7 `ratings/{rideId}` — rider reviews of drivers

| Field | Type | Notes |
|---|---|---|
| `rideId` | string | Doc id = ride id (one review per ride). Older docs have random ids and no `rideId`. |
| `driver` | string | Driver uid |
| `user` | string | Rider uid |
| `name` | string | Rider's name at the time |
| `rating` | number | 1–5 |
| `comment` | string | Optional |
| `createdAt` | Timestamp | |

Driver average = mean of `rating` where `driver == uid`.

---

### 3.8 `citytocity/{rideId}` — rider-posted city-to-city requests

A rider posts a trip; drivers send offers (§3.9); the rider accepts one.

| Field | Type | Meaning |
|---|---|---|
| `rider` | string | Rider uid |
| `pickup`, `dropoff` | string | Formatted addresses |
| `pickupCoords`, `dropoffCoords` | `{latitude, longitude}` | Drivers only see requests starting within **100 km** |
| `distance` | number \| null | Road km |
| `cabtype` | `"private"` \| `"sharing"` \| `"hiace"` \| `"delivery"` | Labels: Cabin, Sharing, Hiace, Delivery. Legacy `"cabin"` = private. |
| `passengers` | number \| `"Full car"` | Seats, for `sharing` only |
| `price` | number | **Agreed fare.** Starts as the rider's ask; replaced by the accepted offer's price. Legacy docs may store a **string**. |
| `askedPrice` | number | The rider's original ask |
| `expectations` | string | Rider's vehicle preferences |
| `detail`, `receiver` | string | Package description / receiver phone (delivery) |
| `status` | see below | |
| `driver` | string \| absent | Set on acceptance |
| `driverData` | map | Snapshot of the driver's application at acceptance |
| `createdAt` | number (ms) | Legacy docs only have `time` (Timestamp) |
| `acceptedAt`, `pickedUpAt`, `completedAt`, `cancelledAt` | number (ms) | |
| `cancelledBy` | `"rider"` \| `"driver"` | |

**Status lifecycle:**
```
pending ──(rider accepts an offer)──▶ accepted ──(driver: "picked up")──▶ ontrip ──(driver: "complete")──▶ completed
   │                                     │
   └──(rider cancels)──▶ cancelled ◀─────┘ (rider or driver cancels before pickup)
```
Legacy value **`"started"` means `accepted`** — treat them the same.

The driver pays **`ctc_commission`** on `price` when completing.
Rides with `status = "cancelled"` and `cancelledBy = "driver"` are **hidden
from the rider** in the app (the portal can still show them).

### 3.9 `citytocity_offers/{rideId}_{driverUid}` — offers on those requests

**One document per driver per ride** (the id enforces "one offer until declined").
Older docs have random ids.

| Field | Type | Meaning |
|---|---|---|
| `ride_id` | string | The `citytocity` doc id |
| `driver` | string | Driver uid |
| `price` | number | Offered fare |
| `driverInfo` | map | Snapshot of the driver's application |
| `driverImg` | string \| null | Photo URL |
| `status` | `"pending"` \| `"declined"` \| `"accepted"` | **Missing on legacy docs = `pending`** |
| `offeredAt`, `declinedAt` | number (ms) | |

---

### 3.10 `driver_trips/{tripId}` — driver-posted city-to-city trips

A driver making an intercity journey posts it; riders book seats (§3.11).

| Field | Type | Meaning |
|---|---|---|
| `driver`, `driverName`, `driverPhone` | string | |
| `vehicle` | string | "Company · Model · PLATE" |
| `pickup`, `dropoff` | string | Addresses |
| `pickupCoords`, `dropoffCoords` | `{latitude, longitude}` | Riders only see trips leaving within **100 km** |
| `departAt` | number (ms) | Departure time |
| `seats` | number | Capacity |
| `seatsLeft` | number | Maintained by booking transactions — **don't edit by hand** |
| `farePerSeat` | number | PKR |
| `notes` | string | |
| `status` | `"open"` \| `"full"` \| `"cancelled"` | `full` when `seatsLeft == 0`; back to `open` if a booking is cancelled |
| `createdAt`, `cancelledAt` | Timestamp | |

A trip counts as "upcoming" until 1 hour after `departAt`. To post one, the
driver's balance must cover `ctc_commission` × `seats × farePerSeat`.

### 3.11 `driver_trip_bookings/{tripId}_{riderUid}` — seat bookings

| Field | Type | Meaning |
|---|---|---|
| `tripId`, `driver`, `rider` | string | |
| `riderName`, `riderPhone` | string | |
| `seats` | number | |
| `fare` | number | `seats × farePerSeat` — the rider pays this to the driver in cash |
| `status` | `"confirmed"` \| `"cancelled"` | A rider who cancels and books again **reuses the same doc** |
| `createdAt` | Timestamp | New on every (re)booking |
| `cancelledAt` | Timestamp | |

### 3.12 City-to-city commission — who charges what

| Flow | When charged | By | Refunded |
|---|---|---|---|
| Rider-posted ride (§3.8) | Driver taps **Complete** | app → `wallets/{driver}/entries/ctc_{rideId}` | never (only charged on completion) |
| Driver-posted trip (§3.10) | Each booking **confirmed** | server → `entries/trip_{bookingId}_{ms}` | automatically when the booking **or** the whole trip is cancelled |

Rate = `rates/rates.ctc_commission` at the time of the charge.

---

### 3.13 `tickets/{autoId}` — support tickets (**none exist yet**)

| Field | Type | Written by | Meaning |
|---|---|---|---|
| `title`, `description` | string | app | |
| `image` | string (URL) | app | Optional screenshot |
| `user` | string | app | uid of the person who filed it |
| `date` | Timestamp | app | |
| `status` | string | app sets `"open"`; **portal** updates | Suggested: `open` → `in progress` → `resolved` |
| `comment` | string | **portal** | Support's reply, shown in the app |

**Portal must:** list tickets, set `comment` to reply (sends the user a push),
update `status`.

### 3.14 `tasks` — not used by the app

Present in the database (fields `title`, `description`, `status`, `score`,
`history`, …). The mobile app never reads or writes it; presumably the
portal's own. Leave as is.

---

## 4. Realtime Database nodes

### 4.1 `rides/{rideId}` — live in-city requests and trips

Created by the rider's app with `push()`. Deleted when the request expires,
is cancelled before acceptance, or after the trip ends (the rider's app
cleans up; a finished ride may linger briefly).

| Field | Type | Meaning |
|---|---|---|
| `rider` | string | uid |
| `pickup`, `dropoff` | `{latitude, longitude, address?}` | |
| `cabtype` | string | `mini_ac`, `mini_nonac`, `comfort_ac`, `comfort_nonac`, `car_delivery`, `rickshaw`, `bike`, `bike_delivery`. Legacy: `regular`, `ac`, `deliver`, `freight`. |
| `rideCategory` | string | The tier without AC: `mini`, `comfort`, `car_delivery`, … |
| `acOption` | `"ac"` \| `"nonac"` \| null | The rider's AC choice (car tiers only) |
| `distance` | string/number | km |
| `duration` | number | minutes |
| `price` | number | Rider's asking fare, then the accepted offer's fare |
| `items`, `receiver` | string | Delivery details |
| `status` | see below | |
| `createdAt`, `expiresAt` | number (ms) | Requests expire **10 minutes** after creation if no driver is accepted |
| `time` | map | Legacy serialised Timestamp |
| `offers` | array (or numbered map) of offer objects | see below |
| `driver` | string | Set on acceptance |
| `acceptedAt`, `startedAt` | number (ms) | |

**Offer object:** `{ driver, price, commission, driverInfo, driverCurrentLocation {latitude, longitude}, driverImg, offeredAt, status: "pending" | "declined", declinedAt? }`.
One live offer per driver; a declined driver may offer again.

**Status lifecycle:**
```
pending ──(rider accepts)──▶ inprogress ──(driver: picked up)──▶ started ──(driver: complete)──▶ completed
```
plus `cancelled` (by driver, after acceptance). Cancelling by the rider, or
expiry, **deletes** the node.

### 4.2 `rides_driver_location/{rideId}`
`{ latitude, longitude, heading, at }` — the driver's position during a live
trip. Deleted when the trip ends.

### 4.3 `rides_driver_chat/{rideId}/{timestampMs}`
`{ msg, sender (uid), senderRole ("rider" | "driver", newer messages), timestamp }`.
Used for both in-city (RTDB ride id) and city-to-city (`citytocity` doc id)
trips.

### 4.4 `drivers_online/{driverUid}`
`{ latitude, longitude, cabTypes: { <cabtype>: true, … }, busy, updatedAt (server ms) }`.
Written every 30 s while a driver is online in the app; removed when they go
offline or sign out. A driver counts as online for **30 minutes** after the
last update (so they keep getting nearby requests after closing the app).
**Portal:** can read this for a live "drivers online" map; ignore entries
with `updatedAt` older than 30 minutes.

---

## 5. Suggested portal features (checklist)

- [ ] **Rates & commission editor** for `rates/rates` (§3.4), with validation.
- [ ] **App version editor** for `config/appVersion` (§3.5), with a warning on `minVersion`.
- [ ] **Driver applications queue**: `driverProfileRequests` where `status == "pending"`; approve/reject exactly as in §3.2.
- [ ] **Identity verification queue**: `users` where `verificationSubmitted == true && verificationStatus == "unverified"`; verify/reject as in §3.1.
- [ ] **Wallets**: balances, ledger (§3.3.1), top-up form (transaction + `topup` entry).
- [ ] **Commission report**: from wallet entries by `type` and date.
- [ ] **In-city rides**: live (RTDB `rides`) and history (Firestore `rides`).
- [ ] **City to city**: requests + offers (§3.8–3.9), driver trips + bookings (§3.10–3.11).
- [ ] **Drivers online map** from RTDB `drivers_online` (§4.4).
- [ ] **Support tickets**: reply via `comment`, update `status` (§3.13).
- [ ] **Ratings** per driver (§3.7).
- [ ] **Login history** per user (§3.1.1).

---

## 6. Important warnings

1. **Security rules require a signed-in admin for the portal.** See §7 —
   the portal must sign in through Firebase Auth with an account carrying
   the `admin: true` custom claim. Without it, every portal read and write
   is refused.
2. **`comission` is spelt with one "m"** in `rates/rates`. Keep that key. If
   the portal renames it, also keep writing the old key, or the app stops
   finding the in-city commission.
3. **Don't edit `seatsLeft`, offer arrays, or ride statuses by hand** — they
   are maintained by transactions in the app and server.
4. **Status spellings are exact**: `pending`, `approved`, `rejected`,
   `verified`, `unverified`, `inprogress`, `started`, `completed`,
   `cancelled`, `accepted`, `ontrip`, `open`, `full`, `confirmed`, `declined`.
5. **Freight is gone** from the app. Old data may still mention it; don't
   offer it in new portal forms.

---

## 7. Security rules and portal authentication (**read this first**)

The database is protected by security rules kept in the app repo:
`firestore.rules`, `database.rules.json` and `storage.rules` (with tests in
`rules-tests/`). The short version:

- **Nothing** is readable or writable without being signed in to Firebase
  Auth, except `config/appVersion` (public, read-only).
- Riders and drivers can only touch their own records and the rides they are
  part of. They cannot approve themselves, verify themselves, or add money to
  a wallet.
- **Admins can read and write everything.** An admin is a Firebase Auth user
  whose ID token carries the custom claim **`admin: true`**.

### What the portal must change

The portal currently checks a hard-coded username/password **in the browser**
(`src/utils/auth.ts`) and talks to Firebase **anonymously**. Under the rules
that is refused. It must be replaced with real Firebase Auth:

1. **Sign in with Firebase Auth**: `signInWithEmailAndPassword(getAuth(app), email, password)`
   from `firebase/auth`, with an admin account. Remove the local password hash
   and the localStorage session entirely — Firebase Auth persists the session.
2. **Check the claim after sign-in**, and refuse anyone without it:
   ```ts
   const { claims } = await user.getIdTokenResult();
   if (claims.admin !== true) { await signOut(auth); /* "Not an admin account" */ }
   ```
3. **Guard routes** on `onAuthStateChanged` + that claim instead of the old
   `isAuthenticated()`.
4. The Firebase config in `src/firebase.ts` also needs the `apiKey` and
   `appId` (same values as the mobile app's web config) for Auth to work.

### Creating an admin account

1. Firebase console → **Authentication → Users → Add user** — a dedicated
   email and a strong password (not `Admin@123`).
2. From the app repo: `node functions/scripts/setAdmin.js <that email>`
   (`--list` shows current admins, `--revoke` removes one).
3. Sign in to the portal with it. A claim change reaches a session already
   signed in within an hour, or immediately after signing out and in.

### Rules the portal's writes must respect

Admins bypass the per-user restrictions, so the portal can write anything —
but it should still follow §3 exactly (field names, value spellings), because
the app and Cloud Functions read them.
