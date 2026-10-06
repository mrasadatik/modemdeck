import type { DataTransportCandidate } from '../domain/entities/data-transport.js';

const rank = (candidate: DataTransportCandidate): number =>
  ({
    'ras-ppp': 100,
    mbim: 90,
    ndis: 80,
    rndis: 70,
    qmi: 60,
    vendor: 40,
    unknown: 0,
  })[candidate.method];

export class DataTransportSelector {
  constructor(private readonly discover: () => Promise<DataTransportCandidate[]>) {}
  async select(): Promise<DataTransportCandidate | undefined> {
    const candidates = (await this.discover()).sort((a, b) => rank(b) - rank(a));
    return candidates[0];
  }
  async all(): Promise<DataTransportCandidate[]> {
    return this.discover();
  }
}
