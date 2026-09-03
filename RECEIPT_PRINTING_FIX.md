# SEL Center Receipt Printing Fix

This version replaces the old `window.print()` POS behavior with a dedicated receipt-only print document.

## Fixed
- Blank or incomplete receipt output caused by print CSS hiding `.cart-summary`, which contained the receipt.
- Full application UI appearing in print output.
- Receipt sizing for thermal printers.

## Improved
- 80mm receipt layout.
- SEL Center logo on printed receipts.
- Receipt reference and date.
- Line items and totals.
- Payment method.
- Cash received and customer change for cash sales.
- Staff/cashier name.
- Gate Entry receipt printing.

## Deployment
No SQL migration is required.
No Edge Function change is required.
Deploy the updated contents of `frontend/dist`.
