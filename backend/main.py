import os
import io
import time
from typing import List, Annotated
from PIL import Image
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types

from engine import (
    BillExtractionResponse,
    SplitCalculationRequest,
    ParticipantSettlement,
    calculate_proportional_split
)

app = FastAPI(title="FairSplit Proportional Engine API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

EXTRACTION_PROMPT = """
You are a precise forensic bill analysis engine. Extract line items, prices, and overheads from the receipt image(s).
Strict rules:
1. NEVER include metadata headers ('Date', 'Table No', 'Server', 'Bill ID', 'GSTIN') inside the items array.
2. Summary lines ('SUBTOTAL', 'CGST', 'SGST', 'VAT', 'ROUND OFF', 'TOTAL') belong exclusively in metadata.
3. If ink is faded, blurry, or handwritten, extract best guess and mark confidence <= 0.65.
4. Mark alcoholic beverages as is_alcohol: true.
5. If two photos of a single long bill are provided, do not duplicate boundary items.
"""

@app.post("/api/extract", response_model=BillExtractionResponse)
async def extract_receipt(
    image: UploadFile = File(...),
    image_part2: UploadFile | None = File(default=None)
):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500, 
            detail="GEMINI_API_KEY environment variable is not set."
        )

    incoming_files = [image]
    if image_part2:
        incoming_files.append(image_part2)

    pil_images = []
    for img_file in incoming_files:
        content = await img_file.read()
        try:
            img = Image.open(io.BytesIO(content))
            pil_images.append(img)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid image file: {str(e)}")

    client = genai.Client(api_key=api_key)
    
    # Models to try with fallback and retry on high demand (503)
    candidate_models = ["gemini-3.6-flash", "gemini-2.5-flash"]
    last_error = None

    for model_name in candidate_models:
        for attempt in range(3):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=[*pil_images, EXTRACTION_PROMPT],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=BillExtractionResponse,
                        temperature=0.1
                    ),
                )
                return BillExtractionResponse.model_validate_json(response.text)
            except Exception as e:
                last_error = str(e)
                if "503" in last_error or "UNAVAILABLE" in last_error:
                    time.sleep(2 ** attempt)  # Wait 1s, 2s before retrying
                    continue
                # If it's a 404 or other non-transient error, break to next model
                break

    raise HTTPException(status_code=500, detail=f"OCR Parsing failed: {last_error}")


@app.post("/api/split", response_model=List[ParticipantSettlement])
async def calculate_split(req: SplitCalculationRequest):
    return calculate_proportional_split(
        items=req.items,
        metadata=req.metadata,
        participants=req.participants,
        target_total=req.target_total
    )


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "FairSplit Backend"}