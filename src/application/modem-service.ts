import type { AtCommandPort } from '../domain/ports/at-command-port.js';
import type { PduSegment } from '../domain/entities/types.js';

interface SmsCodec {
  encodeSubmitPdus(to: string, text: string): PduSegment[];
}
interface ServiceOptions {
  smsCodec?: SmsCodec;
}
/** Domain service boundary for capabilities. Hardware-specific AT strings stay behind it. */
export class ModemService {
  constructor(
    private readonly at: AtCommandPort,
    private readonly options: ServiceOptions = {},
  ) {}
  command(command: string, timeout?: number, data?: string): Promise<string[]> {
    return this.at.execute(command, timeout, data);
  }
  async sendSms(to: string, text: string): Promise<number> {
    if (!this.options.smsCodec) throw new Error('SMS codec unavailable');
    const pdus = this.options.smsCodec.encodeSubmitPdus(to, text);
    for (const pdu of pdus) await this.command(`AT+CMGS=${pdu.length}`, 60000, pdu.hex);
    return pdus.length;
  }
  capabilities() {
    return {
      sms: !!this.options.smsCodec,
      ussd: true,
      phonebook: true,
      forwarding: true,
      network: true,
    };
  }
}
