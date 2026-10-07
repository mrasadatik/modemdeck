/** Shared domain contracts. Keeping these independent of Node makes the modem core testable. */
export interface SmsMessage {
  id: string;
  from: string;
  ts: string;
  text: string;
  /** SIM identity (hashed IMSI) this message was received under. */
  simId?: string;
}

export interface SentMessage {
  to: string;
  text: string;
  ts: string;
  parts: number;
  simId?: string;
}

export interface CallRecord {
  number: string;
  ts: string;
  simId?: string;
}
export interface UssdResult {
  text: string;
  more: boolean;
  status: number;
  simId?: string;
}
export interface PduSegment {
  length: number;
  hex: string;
}
export interface DecodedPdu {
  from: string;
  ts: string;
  text: string;
  ref: number;
  seq: number;
  total: number;
}

export interface ModemDatabase {
  sms: SmsMessage[];
  sent: SentMessage[];
  calls: CallRecord[];
  ussd: Array<UssdResult & { code: string; ts: string }>;
  contacts: Array<{ index: number; name: string; number: string; simId?: string }>;
  parts: Record<string, Record<number, string>>;
  seen: Record<string, number>;
}

export interface ModemConfig {
  port: string;
  http: number;
  dialup: string;
  baud: number;
  authToken?: string;
  https?: boolean;
  dataPath?: string;
  persistSensitive?: boolean;
  retentionDays?: number;
  profile?: string;
  captureRaw?: boolean;
  capturePath?: string;
  logPayloads?: boolean;
  lockMinutes?: number;
  sessionMaxMinutes?: number;
}
export interface ModemCapabilities {
  sms: boolean;
  ussd: boolean;
  phonebook: boolean;
  forwarding: boolean;
  network: boolean;
  data: boolean;
}

export type EventMap = {
  status: string | { connected: boolean; port: string; error: string };
  sms: SmsMessage;
  call: CallRecord;
};

/** Normalized identities and state shared by all modem adapters. */
export interface PortIdentity {
  path: string;
  baud: number;
  dataBits?: number;
  stopBits?: number;
  parity?: string;
}
export interface ModemIdentity {
  manufacturer?: string;
  model?: string;
  revision?: string;
  imei?: string;
  serial?: string;
  profileId: string;
  port: PortIdentity;
}
export type CapabilityEvidence = {
  supported: boolean;
  command: string;
  observed: string[];
  observedAt: string;
  error?: string;
};
export interface CapabilityMatrix {
  sms: CapabilityEvidence;
  ussd: CapabilityEvidence;
  phonebook: CapabilityEvidence;
  forwarding: CapabilityEvidence;
  network: CapabilityEvidence;
  data: CapabilityEvidence;
  pdu: CapabilityEvidence;
  binarySms: CapabilityEvidence;
  deliveryReports: CapabilityEvidence;
}
export interface SimState {
  status: 'ready' | 'pin-required' | 'puk-required' | 'absent' | 'unknown';
  raw?: string;
}
export interface NetworkState {
  registration: 'home' | 'roaming' | 'searching' | 'denied' | 'unknown' | 'not-registered';
  operator?: string;
  technology?: string;
  signal?: { csq: number; dbm?: number; percent?: number };
}
export interface SmsDeliveryStatus {
  reference?: number;
  recipient?: string;
  status: 'pending' | 'delivered' | 'failed' | 'unknown';
  timestamp?: string;
  raw?: string;
}
export interface UssdSession {
  id: string;
  code: string;
  state: 'requested' | 'interactive' | 'complete' | 'cancelled' | 'failed';
  text: string;
  dcs?: number;
  startedAt: string;
  endedAt?: string;
}
export interface PhonebookEntry {
  index: number;
  number: string;
  name: string;
  memory: string;
  type?: number;
}
export interface ForwardingRule {
  reason: number;
  active: boolean;
  number?: string;
  serviceClass?: number;
}
export interface DataConnection {
  configured: boolean;
  connected: boolean;
  name?: string;
  device?: string;
  error?: string;
}
export class ModemError extends Error {
  readonly code: string;
  readonly operation?: string;
  readonly raw?: string;
  constructor(message: string, code = 'MODEM_ERROR', operation?: string, raw?: string) {
    super(message);
    this.name = 'ModemError';
    this.code = code;
    this.operation = operation;
    this.raw = raw;
  }
}
