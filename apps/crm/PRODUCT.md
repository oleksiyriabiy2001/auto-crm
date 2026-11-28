# Product

<!-- impeccable:product-schema 1 -->

Requirements, roles, data rules and the roadmap live in [SPEC.md](../../SPEC.md), the source of truth. This file records only the product context design work needs and does not restate the spec.

## Platform

web

## Users

- **First client:** the owner of a small auto shop who runs stock themselves, switching between a desk PC and a phone.
- **Larger shops (expected):** a storekeeper does most of the day-to-day work at a desk with a USB scanner, while mechanics look up parts or record consumption on phones in the bay.
- Roles are `staff`, `admin` and `super_admin` (SPEC.md "Roles and permissions"). Staff never see cost prices, analytics or the audit log.

## Product Purpose

An inventory tool for auto shops that lets a shop receive, find, sell and count parts, fluids and consumables with a barcode scanner, online or offline (SPEC.md "Functional requirements"). Success means the stock counts are correct and staff trust them more than their old spreadsheet.

## Positioning

Target shops track stock in Excel or on paper today. The product replaces that with scanning, counts that are always correct (an append-only movement ledger) and full history, without the learning curve of an ERP. It works offline and is sold as a one-time license.

## Operating Context

- Poor connectivity on the shop floor is normal. The app reads and writes locally and always shows sync status and the number of unsynced changes.
- Two usage scenes: a dense, keyboard-friendly table at the desk, and a phone scanning screen with large buttons.
- Hardware USB/Bluetooth scanners work anywhere in the app without focusing a field. Phones use the camera.

## Capabilities and Constraints

- Ukrainian UI only, and UAH only, but all text lives in i18n files.
- Installable PWA for current desktop browsers, Chrome on Android and Safari on iOS.
- Catalogs can reach tens of thousands of products, so lists must stay instant.
- Negative stock is flagged, never blocked. Rejected sync operations land in a "needs attention" list.

## Brand Commitments

- The name is **Auto CRM** (final).
- Logo, colors, typography and voice are undecided. Do not invent them.

## Evidence on Hand

No customers, testimonials, screenshots or usage data exist yet. Do not make up any.

## Product Principles

1. **Simpler than the spreadsheet it replaces.** An owner with no training should be able to receive and find stock on day one.
2. **The numbers are trustworthy.** Stock, sync state and problems such as negative stock or unsynced changes are always visible and never hidden.
3. **Offline is the normal case, not an error.** Every flow works without a connection.
4. **Fast at both scenes.** Scanning and keyboard come first at the desk; one-handed use with large targets comes first on the phone.
