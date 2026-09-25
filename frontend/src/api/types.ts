/** Friendly names for the generated API schema. Never hand-write a response shape. */
import type { components } from './schema.gen';

type Schemas = components['schemas'];

export type Me = Schemas['MeOut'];
export type User = Schemas['UserOut'];
export type Role = User['role'];
export type DemoAccount = Schemas['DemoAccount'];
export type Taxonomy = Schemas['TaxonomyOut'];
export type IssueTypeSpec = Schemas['IssueTypeOut'];
export type Dock = Schemas['DockOut'];
export type Order = Schemas['OrderOut'];
export type OrderDetail = Schemas['OrderDetailOut'];
export type OrderItem = Schemas['OrderItemOut'];
export type LoadPlan = Schemas['LoadPlanOut'];
export type PlacedPallet = Schemas['PlacedPalletOut'];
export type ScanResult = Schemas['ScanOut'];
export type TemperatureCheck = Schemas['TemperatureCheckOut'];
export type Issue = Schemas['IssueOut'];
export type IssueCreate = Schemas['IssueCreate'];
export type IssueCreated = Schemas['IssueCreated'];
export type Severity = Issue['severity'];
export type IssueStatus = Issue['status'];
export type RecurringPattern = Schemas['RecurringPattern'];
export type Photo = Schemas['PhotoOut'];
export type InspectionCreate = Schemas['InspectionCreate'];
export type InspectionResult = Schemas['InspectionResult'];
export type QuickRequest = Schemas['QuickRequestOut'];
export type Broadcast = Schemas['BroadcastOut'];
export type Handoff = Schemas['ShiftHandoffOut'];
export type ChatMessage = Schemas['ChatMessageOut'];
export type ChatReply = Schemas['ChatReply'];
export type Analytics = Schemas['AnalyticsSummary'];

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
