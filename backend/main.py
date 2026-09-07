import os
import io
from typing import List
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

# Enable CORS for the React frontend
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
async def extract_receipt(images: List[UploadFile] = File(...)):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500, 
            detail="GEMINI_API_KEY environment variable is not set. Run: $env:GEMINI_API_KEY='your_key'"
        )

    if not images:
        raise HTTPException(status_code=400, detail="At least one bill photograph is required.")

    pil_images = []
    for img_file in images:
        content = await img_file.read()
        try:
            image = Image.open(io.BytesIO(content))
            pil_images.append(image)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid image file: {str(e)}")

    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[*pil_images, EXTRACTION_PROMPT],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=BillExtractionResponse,
                temperature=0.1
            ),
        )
        return BillExtractionResponse.model_validate_json(response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR Parsing failed: {str(e)}")


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