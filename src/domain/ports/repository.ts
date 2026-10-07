export interface Repository<T extends object> {
  readonly state: T;
  save(): Promise<void>;
  replace(next: T): Promise<void>;
  close?(): void;
  audit?(event: { action: string; correlationId?: string; detail?: string }): Promise<void>;
  /** Provide the data-encryption key; decrypts and populates state. */
  unlock?(key: Buffer): void;
  /** Drop all decrypted state from memory while records stay on disk. */
  lock?(): void;
}
