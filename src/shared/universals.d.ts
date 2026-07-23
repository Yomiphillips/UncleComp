/**
 * Event contract between the ExtendScript engine and the CEP panel.
 * Dispatch with dispatchTS() in jsx, listen with listenTS() in the panel.
 */
export type EventTS = {
  /** Engine finished tagging/publishing a symbol. */
  UncleCompSymbolPublished: {
    symbolId: string;
    version: number;
    name: string;
  };
  /** Engine finished repointing instances during a sync. */
  UncleCompSyncComplete: {
    symbolId: string;
    version: number;
    swapped: number;
  };
};
