/** Everything the UI can ask the session to do. `DropLinkSession` implements this. */
export interface SessionActions {
  addFiles(files: Iterable<File>): void;
  removeFile(id: string): void;
  clearFiles(): void;
  createRoom(): Promise<void> | void;
  joinRoom(code: string): Promise<void> | void;
  confirmPairing(): void;
  rejectPairing(): void;
  leave(): void;
  reset(): void;
  sendSelected(): void;
  acceptIncoming(toDisk?: boolean): Promise<void> | void;
  declineIncoming(): void;
  cancelTransfer(): void;
  clearFinished(): void;
}
