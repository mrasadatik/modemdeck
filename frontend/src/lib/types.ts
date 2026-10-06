export interface Status {
  connected: boolean;
  port: string;
  error: string;
  capabilities: Record<string, boolean>;
}
export interface State {
  status: Status;
  sms: Sms[];
  sent: Sent[];
  calls: Call[];
  ussd: Ussd[];
}
export interface Sms {
  id: string;
  from: string;
  text: string;
  ts: string;
}
export interface Sent {
  to: string;
  text: string;
  ts: string;
  parts: number;
}
export interface Call {
  number: string;
  ts: string;
}
export interface Ussd {
  code: string;
  text: string;
  ts: string;
  more: boolean;
  status: number;
}
export interface Network {
  signal?: { pct: number; dbm: number };
  operator?: string;
  tech?: string;
  sim?: string;
  cs?: string;
  ps?: string;
  eps?: string;
  imei?: string;
  firmware?: string;
  apn?: string[];
}
export interface DataState {
  configured: boolean;
  on: boolean;
  name?: string;
  candidates?: Array<{ method: string; name: string; control: string; connected: boolean }>;
}
export interface Readiness {
  ready: boolean;
  modem: string;
}
export interface Health {
  ok: boolean;
  service: string;
  time: string;
}
export interface Compatibility {
  profile?: string;
  observed: Record<string, boolean>;
  generatedAt: string;
  note: string;
}
