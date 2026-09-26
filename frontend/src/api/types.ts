/** Friendly names for the generated API schema. Never hand-write a response shape. */
import type { components } from './schema.gen';

type Schemas = components['schemas'];

export type Me = Schemas['MeOut'];
export type Role = Schemas['UserOut']['role'];
export type DemoAccount = Schemas['DemoAccount'];
export type Taxonomy = Schemas['TaxonomyOut'];
export type IssueTypeSpec = Schemas['IssueTypeOut'];
export type Dock = Schemas['DockOut'];
export type Order = Schemas['OrderOut'];
export type OrderDetail = Schemas['OrderDetailOut'];
export type OrderItem = Schemas['OrderItemOut'];
export type OrderCompleted = Schemas['OrderCompleted'];
export type LoadPlan = Schemas['LoadPlanOut'];
export type PlacedPallet = Schemas['PlacedPalletOut'];
export type ScanResult = Schemas['ScanOut'];
export type TemperatureCheck = Schemas['TemperatureCheckOut'];
export type TemperatureLog = Schemas['TemperatureLogOut'];
export type ReceivingChecks = Schemas['ReceivingChecksOut'];
export type ReceivingCheckSpec = Schemas['ReceivingCheckSpecOut'];
export type InspectionSummary = Schemas['InspectionSummary'];
export type LoadStep = Schemas['LoadStepOut'];
export type Issue = Schemas['IssueOut'];
export type IssueCreate = Schemas['IssueCreate'];
export type IssueCreated = Schemas['IssueCreated'];
export type Severity = Issue['severity'];
export type IssueStatus = Issue['status'];
export type Disposition = Schemas['Disposition'];
export type Carrier = Schemas['CarrierOut'];
export type RecurringPattern = Schemas['RecurringPattern'];
export type Photo = Schemas['PhotoOut'];
export type InspectionCreate = Schemas['InspectionCreate'];
export type InspectionResult = Schemas['InspectionResult'];
export type QuickRequest = Schemas['QuickRequestOut'];
export type Broadcast = Schemas['BroadcastOut'];
export type Handoff = Schemas['ShiftHandoffOut'];
export type HandoffDraft = Schemas['HandoffDraftOut'];
export type ChatMessage = Schemas['ChatMessageOut'];
export type Analytics = Schemas['AnalyticsSummary'];
export type SimStatus = Schemas['SimStatusOut'];
export type SimScenario = Schemas['SimInject']['scenario'];
export type SimSpeed = Schemas['SimSpeed']['speed'];
export type WmsStatus = Schemas['WmsStatusOut'];
export type YardEntry = Schemas['YardEntryOut'];
export type Pallet = Schemas['PalletOut'];
export type StockRow = Schemas['StockOut'];
export type LedgerEntry = Schemas['LedgerEntryOut'];
export type WarehouseTask = Schemas['WarehouseTaskOut'];
export type CrewProductivity = Schemas['CrewProductivityOut'];
export type Shipment = Schemas['ShipmentOut'];
export type GateEvent = Schemas['GateEventOut'];
export type ColdRoom = Schemas['ColdRoomOut'];
export type RoomCode = ColdRoom['code'];

export interface AiResolution {
  found: boolean;
  confidence: 'low' | 'medium' | 'high';
  scenario?: string;
  message?: string;
  steps: string[];
  source?: string;
  issue_type?: string;
}

/** `ai_resolution` is JSON on the wire; this narrows it for display. */
export function aiResolutionOf(issue: {
  ai_resolution?: Record<string, unknown> | null;
}): AiResolution | null {
  const raw = issue.ai_resolution;
  if (!raw || !Array.isArray(raw.steps)) return null;
  return raw as unknown as AiResolution;
}
