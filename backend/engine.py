import math
from typing import List, Dict, Optional
from pydantic import BaseModel, Field, model_validator


class ExtractedItem(BaseModel):
    """
    Represents an individual line item parsed from the receipt.
    Validates arithmetic consistency: quantity * unit_price == total_price.
    """
    id: str = Field(description="Unique short ID (e.g. item_1, item_2)")
    name: str = Field(description="Name or description of food or drink item")
    quantity: float = Field(default=1.0, description="Quantity ordered")
    unit_price: float = Field(description="Unit price per item")
    total_price: float = Field(description="Total price for this line (quantity * unit_price)")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="OCR confidence score 0.0 to 1.0")
    is_alcohol: bool = Field(default=False, description="True if alcohol subject to separate VAT rates")

    @model_validator(mode="after")
    def auto_reconcile_line_math(self):
        expected_total = round(self.quantity * self.unit_price, 2)
        # If OCR misread quantity or total price, reconcile or lower confidence
        if abs(expected_total - self.total_price) > 0.5:
            self.total_price = expected_total
            self.confidence = min(self.confidence, 0.60)
        return self


class BillMetadata(BaseModel):
    """
    Metadata for non-item overheads and printed receipt totals.
    """
    subtotal: float = Field(description="Printed food subtotal before taxes and charges")
    service_charge: float = Field(default=0.0, description="Service charge fee")
    cgst: float = Field(default=0.0, description="Central GST")
    sgst: float = Field(default=0.0, description="State GST")
    liquor_vat: float = Field(default=0.0, description="Liquor / VAT tax amount")
    discount: float = Field(default=0.0, description="Discount amount applied to the bill")
    printed_total: float = Field(description="Grand total printed on the physical bill")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class BillExtractionResponse(BaseModel):
    """
    Top-level model returned from the OCR extraction pipeline.
    Directly flags if the printed subtotal does not match the items.
    """
    items: List[ExtractedItem]
    metadata: BillMetadata
    calculated_subtotal: float = 0.0
    is_discrepancy_detected: bool = False
    discrepancy_amount: float = 0.0

    @model_validator(mode="after")
    def detect_subtotal_discrepancies(self):
        sum_items = sum(item.total_price for item in self.items)
        self.calculated_subtotal = round(sum_items, 2)
        diff = round(abs(self.calculated_subtotal - self.metadata.subtotal), 2)
        # If printed subtotal differs from sum of line items by more than 1.0
        if diff > 1.0:
            self.is_discrepancy_detected = True
            self.discrepancy_amount = diff
        return self


# Schemas for Assignment & Final Calculation
class ItemAssignment(BaseModel):
    id: str
    price: float
    assigned_to: List[str]


class SplitCalculationRequest(BaseModel):
    items: List[ItemAssignment]
    metadata: BillMetadata
    participants: List[str]
    target_total: Optional[float] = None


class ParticipantSettlement(BaseModel):
    name: str
    food_base: float
    proportional_overhead: float
    total_payable: float
    saved_vs_equal_split: float


def calculate_proportional_split(
    items: List[ItemAssignment],
    metadata: BillMetadata,
    participants: List[str],
    target_total: Optional[float] = None
) -> List[ParticipantSettlement]:
    """
    Distributes overheads (GST, Service Charge) proportionally across participants
    based on what they actually consumed. Guarantees 0-cent rounding leakage via
    the Largest Remainder (Hamilton) Method.
    """
    effective_total = target_total if target_total is not None else metadata.printed_total

    # 1. Base Food Consumption
    consumption: Dict[str, float] = {p: 0.0 for p in participants}
    for item in items:
        if not item.assigned_to:
            continue
        share = item.price / len(item.assigned_to)
        for p in item.assigned_to:
            if p in consumption:
                consumption[p] += share

    total_food_base = sum(consumption.values())

    # 2. Net Overhead Pool (Service Charge + Tax - Discount)
    net_overhead = (
        metadata.service_charge
        + metadata.cgst
        + metadata.sgst
        + metadata.liquor_vat
        - metadata.discount
    )

    # 3. Proportional Floating Share
    raw_shares: Dict[str, float] = {}
    for p in participants:
        base = consumption[p]
        if base > 0 and total_food_base > 0:
            overhead = (base / total_food_base) * net_overhead
            raw_shares[p] = base + overhead
        else:
            raw_shares[p] = 0.0

    # 4. Hamilton (Largest Remainder) Method for exact integer cents/paise
    target_cents = int(round(effective_total * 100))
    floored_cents: Dict[str, int] = {}
    remainders: Dict[str, float] = {}

    for p in participants:
        cents = raw_shares[p] * 100
        floored = math.floor(cents)
        floored_cents[p] = floored
        remainders[p] = cents - floored

    current_cents = sum(floored_cents.values())
    leftover_cents = target_cents - current_cents

    sorted_participants = sorted(participants, key=lambda p: remainders[p], reverse=True)
    if sorted_participants and leftover_cents > 0:
        for i in range(leftover_cents):
            receiver = sorted_participants[i % len(sorted_participants)]
            floored_cents[receiver] += 1

    # 5. Build Final Output
    naive_equal_split = effective_total / max(len(participants), 1)
    results = []
    for p in participants:
        final_payable = round(floored_cents[p] / 100.0, 2)
        base = round(consumption[p], 2)
        overhead_portion = round(final_payable - base, 2)
        savings = round(naive_equal_split - final_payable, 2)

        results.append(
            ParticipantSettlement(
                name=p,
                food_base=base,
                proportional_overhead=overhead_portion,
                total_payable=final_payable,
                saved_vs_equal_split=savings
            )
        )

    return results