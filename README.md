# FairSplit Engine 🧾⚡

> A zero-leakage, multimodal bill-splitting engine powered by Google Gemini and Computational Social Choice algorithms.

[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/Frontend-React_18_%2B_Vite-61DAFB.svg?logo=react&logoColor=black)](https://react.dev/)
[![Gemini](https://img.shields.io/badge/Vision_AI-Google_Gemini-4285F4.svg?logo=google&logoColor=white)](https://ai.google.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Overview

Traditional bill-splitting tools rely on equal splitting or naive floating-point division ($10 / 3 = 3.33...$), causing penny leakage where total payments do not match the merchant's printed invoice. Furthermore, standard OCR fails on crumpled, multi-column, or folded receipts.

**FairSplit** solves this using an end-to-end pipeline:
1. **Multimodal Document AI**: Ingests single or multi-part folded receipts (e.g., long thermal slips) via Google Gemini, extracting line items and metadata without regex fragility.
2. **The Broken Total Trap (Human-in-the-Loop)**: Detects mismatches between line-item sums and printed subtotal/grand totals before settlement.
3. **Hamilton Apportionment**: Uses the Largest Remainder Method to allocate taxes, platform discounts, and fractional cents, guaranteeing mathematically strict zero-leakage settlement.
4. **Dynamic Settlement**: Produces per-person breakdowns and dynamic UPI intent QR codes.

---

## System Architecture

[ Receipt Photo(s) ] (Single / Multi-part)
│
▼
[ FastAPI Backend ]
│  ──► Google Gemini Multimodal API (Structured JSON Schema)
▼
[ Stage 2: Forensic Review & Broken Total Trap ]
│  ──► Math verification (Calculated Subtotal vs. Printed Subtotal)
▼
[ Stage 3: Item Claiming & Tagging ]
│  ──► Multi-member item attribution
▼
[ Hamilton Apportionment Engine ]
│  ──► Discrete cent allocation (Largest Remainder)
▼
[ Stage 4: Settlement Ledger & Dynamic UPI QR ]

---

## Key Technical Innovations

* **Multi-Part Long Bill Stitching**: Ingests continuous photos of long receipts, deduplicating seam boundary items automatically via spatial-semantic reasoning.
* **Proportional Overhead & Tax Scaling**: Discounts, service charges, packaging fees, and taxes (GST/VAT) are scaled proportionally to consumption rather than divided equally.
* **Zero-Leakage Guarantee**: Solves the integer representation constraint ($\sum x_i = T \text{ where } x_i \in \mathbb{Z}$) in $O(N \log N)$ time.
* **Dynamic Currency & Sanitization**: Strict schema boundaries prevent prompt token leakage while dynamically updating UI currency contexts ($₹, \$, €, £$).

---

## Tech Stack

* **Backend**: Python 3.10+, FastAPI, Pydantic v2, Pillow, Uvicorn, Google GenAI SDK.
* **Frontend**: React 18, Vite, Tailwind CSS, Lucide Icons, Canvas QR Engine.
* **Math / Algorithms**: Hamilton (Largest Remainder) Method, Proportional Apportionment.

---

## Quick Start

### 1. Backend Setup

```bash
cd backend
python -m venv venv

# Windows
.\venv\Scripts\activate
# Linux/macOS
source venv/bin/activate

pip install -r requirements.txt
Create a .env file in backend/:

Code snippet
GEMINI_API_KEY="your-gemini-api-key-here"
Start the API server:

Bash
uvicorn main:app --reload --port 8000
2. Frontend Setup
Bash
cd frontend
npm install
npm run dev
Open http://localhost:5173 in your browser.

API Reference
POST /api/extract
Accepts multipart/form-data: image (required) and image_part2 (optional).

Returns structured items, tax breakdown, and discrepancy detection flags.

POST /api/split
Accepts JSON containing item allocations, overhead metadata, and target settlement amounts.

Runs the Hamilton algorithm and returns individualized ledger summaries.

License
MIT


Save the file (`Ctrl + S`).

---
