export interface Repository<T extends object> {
  readonly state: T;
  save(): Promise<void>;
  replace(next: T): Promise<void>;
  close?(): void;
  audit?(event: { action: string; correlationId?: string; detail?: string }): Promise<void>;
}
