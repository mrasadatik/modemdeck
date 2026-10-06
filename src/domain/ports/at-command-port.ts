/** Application-facing port for serialized modem commands. */
export interface AtCommandPort {
  execute(command: string, timeout?: number, data?: string): Promise<string[]>;
}
