export type DataTransportMethod =
  'ras-ppp' | 'mbim' | 'ndis' | 'rndis' | 'qmi' | 'vendor' | 'unknown';
export type DataTransportControl = 'controllable' | 'detectable-only' | 'unsupported';

export interface DataTransportCandidate {
  method: DataTransportMethod;
  control: DataTransportControl;
  name: string;
  profile?: string;
  interfaceIndex?: number;
  interfaceDescription?: string;
  modemName?: string;
  port?: string;
  connected: boolean;
  evidence: string[];
}
