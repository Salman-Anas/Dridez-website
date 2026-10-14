# Dridez admin portal — changes to match the app

You're working in the **Dridez admin portal**: `/home/sacrebleu/Desktop/Workspace/job/portal`. It's React 19, Vite, TypeScript, Firebase JS SDK 12 and lucide-react icons, with plain CSS in `src/index.css`.

The portal manages the data of the Dridez ride-hailing app. The app repo is `/home/sacrebleu/Desktop/Workspace/job/dridez`. **Its `schema.md` is the contract.** Read §3.1, §3.3, §3.3.1 and §3.4.2 before you change anything:
- §3.1 covers users and suspension.
- §3.3 and §3.3.1 cover wallets, the trust settings and the ledger.
- §3.4.2 covers top-up requests and their statuses.

Field names and status spellings must match **exactly**. The app, the Cloud Functions and the Firestore security rules all match on them.

The portal signs in through Firebase Auth as an admin, meaning an account with the custom claim `admin: true`. Admins can read and write everything. Keep using `useAdminLabel()` (`src/utils/adminAuthContext`) for every `reviewedBy`, `by` and `suspendedBy` value.

---

## 0. Start here: there is uncommitted work

A first pass of sections 1–4 is already in the working tree, uncommitted:
- `src/utils/topupSchema.ts`
- `src/utils/walletSchema.ts`
- `src/components/TopupQueue.tsx`
- `src/components/TopupTrustPanel.tsx` (new)
- `src/pages/DriverAccounts.tsx`
- `src/pages/Users.tsx`
- `src/index.css`

Run `git diff` and read it first. **Keep what's correct.** Check it against the requirements below, fix gaps or bugs, and don't rewrite it from scratch.

---

## 1. Top-up statuses: the double-credit risk (critical)

The app now files top-ups through a Cloud Function, `requestTopup`. Small top-ups from trusted drivers are **credited to the wallet immediately**.

A top-up request (`topupRequests/{id}.status`) is now one of these:

| status | money already in wallet? | allowed portal actions |
|---|---|---|
| `pending` | no | **Approve** (credit the wallet) or **Reject** |
| `auto_credited` | **yes** | **Verify** (no wallet change) or **Reverse** (take the money back) |
| `approved` | yes | none |
| `rejected` | no | none |
| `reversed` | taken back | none |

Requirements:
- `topupStatus()` must return `'unknown'` for any status it doesn't recognise, and treat it as **read-only**. Never map it to `pending`, because approving an `auto_credited` request would credit the driver twice. A request with no `status` field at all may stay `pending`; those are legacy hand-made records.
- **Approve** (`pending` only), in one transaction. The flow is unchanged:
  1. Re-check the request is still `pending`.
  2. `wallets/{driver}.balance += creditedAmount`.
  3. Add a ledger entry `{type:"topup", amount, method:"bank_transfer", reference:<requestId>, by, balanceAfter, at}`.
  4. Set the request's `status:"approved"`, `creditedAmount`, `reviewedBy` and `reviewedAt`.
  - Never create a wallet here.
- **Reject** (`pending` only): set `status:"rejected"`, `rejectionReason` (required), `reviewedBy` and `reviewedAt`. Don't touch the wallet.
- **Verify** (`auto_credited` only): set `status:"approved"`, `reviewedBy` and `reviewedAt`. **No wallet change.**
- **Reverse** (`auto_credited` only), in one transaction:
  1. Re-check the status.
  2. Update the wallet:
     - `balance -= creditedAmount` (fall back to `amount`). It **may go negative**.
     - `authentic = false`
     - `unauthenticReason = <reason>`
     - `unauthenticAt = serverTimestamp()`
     - `safeLimit = request.safeLimitBefore` (only if that's a positive number)
     - `updatedAt`
  3. Add a ledger entry `{type:"topup_reversal", amount:-creditedAmount, reference:<requestId>, by, reason, balanceAfter, at}`.
  4. Update the request: `status:"reversed"`, `reversalReason` (required, and the driver sees it in a push notification), `reviewedBy` and `reviewedAt`.
- Every action re-checks the status inside its transaction and throws a clear "already reviewed" error if another admin got there first.

## 2. Payment Verification queue (`TopupQueue`)

- Tabs, with counts: **Awaiting verification** (`pending`), **Added instantly** (`auto_credited`), Approved, Rejected, Reversed and All. Show an "Other" tab only when there are `unknown` statuses.
- The header badge shows `pending + auto_credited` as the "awaiting" count.
- Sort both waiting tabs oldest first. Sort the other tabs by `reviewedAt`, falling back to `createdAt`, newest first.
- `pending` rows: show `reviewReason`, which says why the server didn't auto-credit:
  - `over_limit`: "Above the driver's safe limit"
  - `previous_unverified`: "An earlier payment wasn't verified yet"
  - `unauthentic`: "Driver is marked unauthentic"
- `auto_credited` rows: show "Credited instantly PKR X · <creditedAt>" and "Safe limit A → B" (from `safeLimitBefore` and `safeLimitAfter`). Add a **Verify** button and a **Reverse** button. Reverse opens a form with a required reason. Before confirming, the form spells out the effect: the new balance (it may go negative), "marked unauthentic", and that the safe-limit increase is undone.
- `reversed` rows: show the reason and who reversed it and when.
- Use distinct row and status colours for `auto_credited` (blue) and `reversed` (red), following the existing `.tq-row-*` and `.tq-status-*` classes.

## 3. Per-driver top-up trust settings

These fields live on `wallets/{uid}` and only the portal (or the `requestTopup` function) writes them:

| field | default when missing | meaning |
|---|---|---|
| `minTopup` | 200 | Smallest top-up the app accepts |
| `safeLimit` | 1000 | Largest top-up credited **instantly**. The server adds 20% of every instant top-up to it. |
| `authentic` | true | `false` = every top-up waits for manual review |
| `unauthenticReason`, `unauthenticAt` | — | Set when a reversal marks the driver unauthentic |

- In the driver account drawer (`DriverAccounts`, Wallet section), show a panel that:
  - reads the wallet **live** with `onSnapshot`, because the safe limit grows on its own;
  - shows authentic or unauthentic, with the reason if there is one;
  - lets an admin edit `minTopup`, `safeLimit` and `authentic`, and save them in a transaction;
  - only fills the inputs from the live data while the admin hasn't started editing.
  - Validation: both are whole numbers above 0, and `safeLimit >= minTopup`.
  - Turning `authentic` back on clears `unauthenticReason` and `unauthenticAt`.
  - If the wallet doesn't exist yet, say so and don't create it.
- In the driver accounts **list**: add an "Unauthentic" pill on those rows and a filter for unauthentic drivers. Show each driver's safe limit somewhere scannable, such as a column or the row meta.

## 4. Wallet ledger types

- Ledger types (`wallets/{uid}/entries`) are now `commission`, `ctc_commission`, `ctc_commission_refund`, `topup` and **`topup_reversal`** (negative amount).
- `normaliseLedgerType`, `LEDGER_META`, `ledgerSource` and `summariseEntries` must all know `topup_reversal`. In totals it **subtracts** from "topped up".
- `topup` entries now have two methods:
  - `method:"bank_transfer"`: approved by an admin (`by` is the admin label).
  - `method:"bank_transfer_instant"`, `by:"auto"`: credited instantly.
  - Label them differently, e.g. "Approved by …" and "Added instantly".
- The driver account drawer currently lists top-ups by `type === 'topup'` only. Show reversals in that list too (or in their own list), with the reason, so the balance can be reconciled.

## 5. Account suspension

The app replaced "Delete account" with "Suspend account". The fields are on `users/{uid}`:
- `suspended` (boolean)
- `suspendedBy`: `"self"` if the user did it in the app, otherwise the admin label
- `suspendedAt` (Timestamp)

A suspended account sees only an "Account suspended" screen with a Log out button. The app reacts live and takes a suspended driver offline. Users can suspend themselves but **only the portal can reactivate them**.

On the Users page:
- Show a "Suspended" badge on cards and in the user drawer.
- Add a **Suspended** filter pill, with its count.
- In the drawer, add an "Account status" section showing who suspended the account and when ("by the user from the app" when `suspendedBy == "self"`).
- Add a **Suspend account** / **Reactivate account** button with a `confirm()`:
  - Suspend writes `{suspended:true, suspendedBy:<admin>, suspendedAt:serverTimestamp()}`.
  - Reactivate writes `{suspended:false}`.
  - Update local state optimistically, the way verification already does.

On the Drivers and DriverAccounts pages, show the same Suspended badge where a driver's user doc is available.

## 6. Ledgers and Excel export (new)

The app now has a driver ledger and a rider spending ledger with Excel export. Its data logic is in `dridez/constants/ledger.ts`. Read it and **mirror its rules** so the portal and the app agree on every number.

Data sources:
- **Driver wallet movements:** `wallets/{uid}/entries`. The date is `at`, and `amount` is signed (positive in, negative out).
- **Driver earnings:** completed trips, where earnings are the fare.
  - In-city: `rides` where `driver == uid` and `status == "completed"`. Fare is `price` (it may be a string). Date is `completedAt` (ms), falling back to `time` and then `createdAt`.
  - City to city: `citytocity` where `driver == uid` and `status == "completed"`. Fare is `price`. Date is `completedAt`.
  - Seat bookings: `driver_trip_bookings` where `driver == uid` and `status == "confirmed"`, whose trip (`driver_trips/{tripId}`) isn't `cancelled` and whose `departAt <= now`. Fare is `fare`. Date is the trip's `departAt`.
- **Commission per trip:** from the ledger entries, net of refunds.
  - In-city: the entry id is the ride id.
  - City to city: the entry id is `ctc_<rideId>`.
  - Seat bookings: entries carry `bookingId`.
  - Net earnings = fares − commission.
- **Rider spending:** the same three trip sources, filtered on `rider == uid` instead of `driver == uid`.

Build:
1. **Driver statement**, in the driver account drawer:
   - a period selector (Last 7 days, Last 30 days, This month, All time, plus a custom date range);
   - totals: earnings, commission paid, net, balance added (top-ups minus reversals) and trip count;
   - two lists: wallet movements, and trips with fare and commission;
   - an **Export to Excel** button. Sheets:
     - Summary
     - Wallet: Date, Type, Details, Amount, Balance after, Reference
     - Trips: Date, Type, Details, Route, Fare, Commission, Net, Trip ID
     - Monthly: Month, Trips, Earnings, Commission, Net, Balance added
2. **Rider spending**, in the Users drawer:
   - the same period selector;
   - totals: spent, trips and average fare;
   - the trip list;
   - **Export to Excel**. Sheets: Summary; Trips (Date, Type, Details, Route, Fare, Trip ID); Monthly.
3. **Portal-wide exports** on the DriverAccounts page, for the selected period:
   - **All top-ups**: every `topupRequests` doc with driver name and phone, amount, credited amount, status, review reason, reviewer and dates.
   - **Commission report**: one row per driver, with earnings, commission, net, balance added and current balance.

Excel details:
- Use SheetJS in the browser:
  ```bash
  npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
  ```
  Use the official CDN tarball, **not** the outdated `xlsx` package on npm.
- Write with `XLSX.writeFile(book, name, { compression: true })`.
- Dates go in as real `Date` cells (`cellDates: true`, `dateNF: "dd mmm yyyy hh:mm"`). Money goes in as **numbers**, not formatted strings. Set column widths with `!cols`.
- File names follow `dridez-<driver|rider|topups|commission>-<name-or-scope>-YYYY-MM-DD.xlsx`.
- Put the shared workbook helper in `src/utils/excelExport.ts`, and the ledger data logic in `src/utils/ledgerSchema.ts`.
- Use only single-field queries (`where(field, "==", value)`) and filter by status and date client-side, so no composite indexes are needed.

---

## Constraints

- Don't edit the app repo (`dridez`), its Cloud Functions or its security rules.
- **Never hard-delete** users, wallets, ledger entries or top-up requests.
- Every money movement is a single Firestore transaction that re-reads what it depends on.
- Match the existing code style, components and CSS classes (`tq-*`, `da-*`, `dv-*`, `rate-*`, `modal-*`). Don't add a UI library. The only new dependency is `xlsx`.
- Handle both time shapes the database uses: number milliseconds and Firestore Timestamps. Use `toMs`, `toNum` and `formatDateTime` from `src/utils/firebaseValues`.

## Verify before finishing

1. Run each of these; all must pass cleanly:
   ```bash
   npx tsc -b
   npx oxlint src
   npx vite build
   ```
2. Walk through these by hand, against test data or the Firebase emulator (never real money):
   - A `pending` request: Approve credits once, and Approve on an already-approved request errors.
   - An `auto_credited` request has **no** Approve button. Verify leaves the balance unchanged. Reverse lowers the balance (it can go negative), sets `authentic:false`, restores `safeLimitBefore`, and writes a `topup_reversal` entry.
   - A request with an odd status shows as "Other" and is read-only.
   - The trust panel saves, rejects `safeLimit < minTopup`, and updates live.
   - Suspend shows the badge and the filter count; Reactivate clears it.
   - Each export opens in Excel with date-typed and number-typed cells, and its totals match the on-screen totals for the same period.
3. Summarise what changed, file by file, and anything you couldn't verify.

**Deploy order:** deploy this portal **before** the app's `requestTopup` Cloud Function goes live (or immediately if it already has). Until then, an older portal would show instant top-ups as `pending`.
