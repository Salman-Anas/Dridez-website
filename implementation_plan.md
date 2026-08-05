# Rides Management Dashboard (`/rides`) in React Portal

Create an exhaustive, real-time analytics and management page at `/rides` in the React Admin Portal (`d:\job\portal`). This dashboard aggregates ride metrics from both Firebase Realtime Database (RTDB) and Cloud Firestore to give a unified view of intra-city, freight, and inter-city rides. 

## User Review Required

> [!IMPORTANT]
> **Dual Database Synchronization**: Active and pending intra-city rides are actively tracked in **Firebase Realtime Database (RTDB)** under `rides/`, whereas completed/cancelled history records and inter-city trips reside in **Cloud Firestore** (`rides` and `citytocity` collections). The proposed implementation syncs both sources into a unified state so that all rides appear accurately regardless of life-cycle state.

## Open Questions

> [!TIP]
> **Inter-City Rides Integration**: Should inter-city trips (`citytocity` Firestore collection) be included on the new `/rides` screen alongside standard and freight rides? *(Recommended: Yes, displayed with a clean "Inter-City" type badge for a complete operational overview).*

> [!NOTE]
> **Live Tracking & Chat Inspection**: For ongoing active rides, should the ride details modal display read-only live driver telemetry (`rides_driver_location`) and chat transcripts (`rides_driver_chat`) from RTDB? *(Recommended: Include a section in the details drawer that shows driver GPS coordinates and chat message count when a ride is active).*

## Proposed Changes

### Portal Core & Firebase Services

#### [MODIFY] [firebase.ts](file:///d:/job/portal/src/firebase.ts)
- Initialize and export Firebase Realtime Database: `export const rtdb = getDatabase(app);`.

---

### Rides Dashboard Page & Components

#### [NEW] [Rides.tsx](file:///d:/job/portal/src/pages/Rides.tsx)
- **Data Aggregation Engine**:
  - Implement custom hooks/listeners to simultaneously pull live RTDB `rides/` records and Firestore `rides` (and optional `citytocity`) records.
  - De-duplicate and sort rides chronologically by creation timestamp.
- **Interactive Top Stat Cards (Filtering Control)**:
  - **Active Rides**: Displays count of rides with status `ongoing`, `started`, or `active`. Clicking filters the view to Active rides.
  - **Pending Rides**: Displays count of rides with status `pending`, `searching`, or `waiting`. Clicking filters to Pending rides.
  - **Completed Rides**: Displays count of finished trips. Clicking filters to Completed rides.
  - **Cancelled Rides**: Displays count of cancelled or rejected trips. Clicking filters to Cancelled rides.
  - **All Rides**: Master card showing aggregate count to quickly clear active filters.
- **Interactive Rides Data Table**:
  - Modern glassmorphic table rows showing:
    - **Type Badge**: Mini, AC, Delivery, Freight, or Intercity (with distinct colors and Lucide icons).
    - **Status Pill**: Vibrant green (Completed), red (Cancelled), yellow/amber (Pending), or blinking blue (Active).
    - **Route Summary**: Pickup point → Dropoff point.
    - **Financials & Metrics**: Fare price, estimated distance, and duration.
    - **Timestamp**: Formatted date and time.
- **Deep-Dive Ride Inspector (Modal / Slide-over Drawer)**:
  - Clicking any row opens a comprehensive detail modal.
  - Automatically queries Firestore `users/{riderUid}` to display rider information: Full Name, Phone number, OS type, and account verification status.
  - Automatically queries Firestore `driverProfileRequests/{driverUid}` (when assigned) to display driver information: Driver full name, contact phone, vehicle make/model/year, license plate, and clickable photo thumbnails (vehicle image, license).
  - **Freight Specifics**: Displays payload size, items description, scheduled execution date (`when`), and designated receiver contact info when viewing Freight bookings.

---

### Navigation & Layout Integration

#### [MODIFY] [App.tsx](file:///d:/job/portal/src/App.tsx)
- Import `Rides` component and register `<Route path="rides" element={<Rides />} />` inside the root layout wrapper.

#### [MODIFY] [Sidebar.tsx](file:///d:/job/portal/src/Sidebar.tsx)
- Add a dedicated navigation link for `/rides` using the `Navigation` or `MapPin` icon from `lucide-react`, placed right below the Dashboard link.

#### [MODIFY] [index.css](file:///d:/job/portal/src/index.css)
- Add glassmorphic table styles (`.rides-table`, `.ride-row-hover`, badge token utility classes) and interactive filter card highlight animations (`.stat-card.selected`).

## Verification Plan

### Automated Tests
- Run TypeScript verification and linter in the portal workspace:
  ```powershell
  cd d:\job\portal; npm run build; npm run lint
  ```

### Manual Verification
- Start the Vite development server (`npm run dev` in `d:\job\portal`).
- Open the portal in browser and click **Rides** in the left sidebar.
- Verify that top statistic cards accurately reflect counts for active, pending, completed, and cancelled rides from both Firebase Realtime Database and Firestore.
- Click on each individual Stat Card to confirm that the table filters correctly with smooth visual transitions.
- Click on an individual ride row to verify that the detail modal pops up and loads complete profiles for both the rider and assigned driver without lag.
