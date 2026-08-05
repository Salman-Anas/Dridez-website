# Comprehensive Firebase Database Schema

This document outlines the complete schema used by your Android app across both **Cloud Firestore** and the **Firebase Realtime Database**, including optional and rarely used fields.

---

## 1. Cloud Firestore Collections

### `users` Collection
Stores basic customer and user information.
| Field | Type | Description |
| :--- | :--- | :--- |
| `uid` | `string` | The Firebase Auth UID. |
| `name` | `string` | User's full name. |
| `phone` | `string` | User's phone number. |
| `os` | `string` | Device OS (Android/iOS) *(Recommended addition)*. |

### `driverProfileRequests` Collection
Stores all driver registration requests and vehicle information.
| Field | Type | Description |
| :--- | :--- | :--- |
| `userid` | `string` | The Firebase Auth UID of the driver. |
| `fullName` | `string` | Driver's full name. |
| `phoneNumber` | `string` | Driver's contact number. |
| `carMake` | `string` | Vehicle manufacturer (e.g., Toyota). |
| `carModel` | `string` | Vehicle model (e.g., Corolla). |
| `carYear` | `string` | Year of vehicle manufacture. |
| `carPlate` | `string` | Vehicle license plate number. |
| `driversLicense` | `string` | License identification number. |
| `driversLicenseExpiration` | `string` | Date of license expiration. |
| `cnicNum` | `string` | CNIC (National ID) number. |
| `cnicExp` | `string` | CNIC expiration date. |
| `freight` | `boolean` | Indicates if the driver offers freight services. |
| `driver` | `string` | Static flag set to `"yes"`. |
| `carImg` | `string` (URL) | Download URL for the car image in Storage. |
| `cnicImg` | `string` (URL) | Download URL for the CNIC image in Storage. |
| `licenseImg` | `string` (URL) | Download URL for the license image in Storage. |
| `isVerified` | `boolean` | **Admin Portal Only**: Set to `true` when a driver is verified. |

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
| `cabtype` | `string` | Requested vehicle type (e.g., car, mini). |
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

---

## 2. Realtime Database (RTDB) Paths
Realtime Database is used for live tracking, chat, and active intra-city rides.

### `rides/` (Active & Local Rides)
Used for creating new standard/freight rides where drivers can listen for requests.
| Field | Type | Description |
| :--- | :--- | :--- |
| `pickup` | `object` | Pickup coordinates & address details. |
| `dropoff` | `object` | Dropoff coordinates & address details. |
| `cabtype` | `string` | Vehicle type requested. |
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
