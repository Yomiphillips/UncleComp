/**
 * Event contract between the ExtendScript engine and the CEP panel.
 * Dispatch with dispatchTS() in jsx, listen with listenTS() in the panel.
 */
export type EventTS = {
  /** Engine finished tagging/publishing a symbol. */
  linkonSymbolPublished: {
    symbolId: string;
    version: number;
    name: string;
  };
  /** Engine finished repointing instances during a sync. */
  linkonSyncComplete: {
    symbolId: string;
    version: number;
    swapped: number;
  };
};
