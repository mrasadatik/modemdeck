import { SerialPort } from 'serialport';
import type { SerialTransportPort } from '../../domain/ports/serial-transport.js';
import { createSerialTransport } from '../serial/serial-transport.js';
import { AtCommandEngine } from '../at/at-engine.js';
import { ModemService } from '../../application/modem-service.js';
import { createSmsCodec } from '../../domain/services/sms-codec.js';
import { ModemDiscovery } from '../../application/modem-discovery.js';
import { createTraceRecorder } from '../serial/trace-recorder.js';
import type { ModemProfile } from '../../domain/ports/modem-profile.js';
import type { WindowsModem } from '../windows/modem-provider.js';

export interface LifecycleStatus {
  connected: boolean;
  port: string;
  error: string;
  capabilities: Record<string, boolean>;
  capabilityEvidence?: unknown;
}
type InteractionRecorder = (
  kind: 'command' | 'response' | 'error',
  name: string,
  payload?: unknown,
  sensitive?: boolean,
) => void;
export class ModemLifecycle {
  private transport: SerialTransportPort | null = null;
  private engine: AtCommandEngine | null = null;
  private service: ModemService | null = null;
  private timer: NodeJS.Timeout | null = null;
  private connecting = false;
  private delay = 1000;
  private stopping = false;
  constructor(
    private port: string,
    private baud: number,
    private readonly status: LifecycleStatus,
    private readonly onUrc: (line: string) => Promise<void>,
    private readonly onReady: () => Promise<void>,
    private trace?: { enabled: boolean; path: string },
    private profile?: ModemProfile,
    private readonly interaction?: InteractionRecorder,
    private readonly windowsModems?: () => Promise<WindowsModem[]>,
  ) {}
  async command(command: string, timeout = 8000, data?: string): Promise<string[]> {
    if (!this.engine) throw new Error('modem not connected');
    this.interaction?.('command', command, data, /CMGS|CUSD|CPBW|CCFC/i.test(command));
    try {
      const result = await this.engine.execute(command, timeout, data);
      this.interaction?.('response', command, result);
      return result;
    } catch (error) {
      this.interaction?.('error', command, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  sendSms(to: string, text: string): Promise<number> {
    return this.service?.sendSms(to, text) ?? Promise.reject(new Error('modem not connected'));
  }
  async start(): Promise<void> {
    this.stopping = false;
    await this.connect();
  }
  async reconfigure(
    port: string,
    baud: number,
    profile?: ModemProfile,
    trace?: { enabled: boolean; path: string },
  ): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.engine?.disconnect(new Error('modem reconfiguring'));
    this.transport?.removeAllListeners();
    this.transport?.close();
    this.transport = null;
    this.engine = null;
    this.service = null;
    this.status.connected = false;
    this.status.port = '';
    this.status.error = '';
    this.port = port;
    this.baud = baud;
    this.profile = profile;
    this.trace = trace;
    this.delay = 1000;
    this.stopping = false;
    await this.connect();
  }
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.engine?.disconnect(new Error('server shutting down'));
    this.transport?.removeAllListeners();
    this.transport?.close();
    this.transport = null;
    this.engine = null;
  }
  private schedule(): void {
    if (!this.stopping && !this.timer && !this.connecting) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.connect();
      }, this.delay);
      this.delay = Math.min(this.delay * 2, 30000);
    }
  }
  private async connect(): Promise<void> {
    if (this.connecting || this.transport || this.stopping) return;
    this.connecting = true;
    try {
      const discovery = new ModemDiscovery(
        async () => {
          const listed = (await SerialPort.list()).map((item) => ({
            path: item.path,
            friendlyName: (item as unknown as { friendlyName?: string }).friendlyName,
            manufacturer: item.manufacturer,
            vendorId: item.vendorId,
            productId: item.productId,
          }));
          const providerPorts = (await (this.windowsModems?.() ?? Promise.resolve([])))
            .filter((item) => item.status === 'OK' && item.attachedTo)
            .map((item) => ({
              path: item.attachedTo as string,
              friendlyName: item.name,
              role: 'modem' as const,
              score: 90,
            }));
          const all = [...listed, ...providerPorts].filter(
            (item, index, items) =>
              items.findIndex((candidate) => candidate.path === item.path) === index,
          );
          if (!this.port) return all;
          const configured = {
            ...(listed.find((item) => item.path === this.port) || { path: this.port }),
            score: 1000,
          };
          return [configured, ...all.filter((item) => item.path !== this.port)];
        },
        (path) => {
          return createSerialTransport(path, this.baud).then((transport) =>
            this.trace
              ? createTraceRecorder(transport, this.trace.path, this.trace.enabled)
              : transport,
          );
        },
      );
      this.transport = await discovery.find();
      this.status.port = this.transport.path ?? '';
      this.engine = new AtCommandEngine(this.transport, {
        onUrc: (line) => {
          void this.onUrc(line).catch((error) => {
            this.status.error = error instanceof Error ? error.message : String(error);
            this.interaction?.('error', 'URC', this.status.error);
          });
        },
      });
      this.service = new ModemService(this.engine, { smsCodec: createSmsCodec() });
      this.transport.on('data', (data: Buffer): void => this.engine?.receive(data));
      this.transport.on('close', () => this.lost());
      this.transport.on('error', () => this.lost());
      for (const command of [
        'ATE0',
        'AT+CMEE=1',
        'AT+CMGF=0',
        'AT+CSCS="IRA"',
        'AT+CNMI=2,1,0,0,0',
        'AT+CLIP=1',
      ])
        await this.command(command).catch((): undefined => undefined);
      for (const [feature, command] of Object.entries({
        sms: 'AT+CMGF?',
        ussd: 'AT+CUSD?',
        phonebook: 'AT+CPBS=?',
        forwarding: 'AT+CCFC=?',
        network: 'AT+CSQ',
      }))
        this.status.capabilities[feature] = await this.command(command, 5000)
          .then(() => true)
          .catch(() => false);
      if (this.profile) {
        const evidence = await this.profile.probe({
          execute: (command, timeout, data) => this.command(command, timeout, data),
        });
        this.status.capabilityEvidence = evidence;
        for (const [feature, item] of Object.entries(evidence.capabilities))
          this.status.capabilities[feature] = item.supported;
      }
      this.status.connected = true;
      this.status.error = '';
      this.delay = 1000;
      await this.onReady();
    } catch (reason) {
      this.status.connected = false;
      this.status.error = reason instanceof Error ? reason.message : String(reason);
      this.transport?.close();
      this.transport = null;
      this.schedule();
    } finally {
      this.connecting = false;
    }
  }
  private lost(): void {
    if (!this.transport || this.stopping) return;
    this.status.connected = false;
    this.engine?.disconnect();
    this.transport.removeAllListeners();
    this.transport = null;
    this.engine = null;
    this.service = null;
    this.schedule();
  }
}
