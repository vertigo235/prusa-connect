import type { SaveToStorageProps } from '../save-to-storage';
import type { Component } from 'svelte';

import type {
  DeviceDetail,
  SendOptions,
  SendOutcome,
  Transfers,
} from '../../../data';
import type { Device, UploadBlock } from '../../../domain';
import type { Selection } from '../../../primitives';
import type { SendsIndicatorRow } from '../../sends-indicator';
import type { CommandControl } from '../status/presentation';
import type { CommandPort } from '../types';

/** What the Files panel reads of one printer's storage. */
export type PrinterFilesSource = Pick<
  DeviceDetail,
  | 'changedAt'
  | 'collapse'
  | 'directory'
  | 'entries'
  | 'expand'
  | 'expanded'
  | 'filesError'
  | 'filesLoaded'
  | 'filesLoading'
  | 'filesReadingSince'
  | 'filesUnread'
  | 'filesRefreshing'
  | 'load'
  | 'openFolder'
>;
/** One entry of that storage, as the core answers it. */
export type PrinterFileEntry = PrinterFilesSource['entries'][number];

/** The files this server has sent to the printer. */
export type PrinterFileTransfers = Pick<Transfers, 'current' | 'stop'>;

/** One of those transfers, as the store keeps it. */
export type PrinterFileTransfer = PrinterFileTransfers['current'][number];

/**
 * What the Files tab sends its commands through. It answers what became of
 * each verb, so the tab can read the folder again and say which writes did
 * not happen.
 */
export interface PrinterFilesCommandPort extends Omit<
  CommandPort,
  'onCommand'
> {
  onCommand: (
    verb: string,
    args?: Readonly<Record<string, string>>,
    options?: SendOptions,
  ) => Promise<SendOutcome>;
}

export interface PrinterFilesPanelProps {
  /** The printer the storage belongs to. Its capabilities say which acts are offered. */
  device: Device;
  files: PrinterFilesSource;
  commands: PrinterFilesCommandPort;
  /** Takes the files a reader drops or picks. */
  onUpload?: ((files: File[], directory: string) => void) | undefined;
  /**
   * Why an upload cannot start, shown where the drop zone would be. Read only
   * while `onUpload` is absent.
   */
  uploadBlock?: UploadBlock | undefined;
  /**
   * Whether a dropped file is kept on this server, and where, drawn under
   * the drop zone. Absent, nothing is drawn and the host decides.
   */
  keep?: SaveToStorageProps | undefined;
  /** The printer is being asked again for its storages. */
  checkingStorages?: boolean | undefined;
  /** Asks the printer again for its storages. */
  onRecheck?: (() => void) | undefined;
  /** Absent, or with nothing to report, and the panel names no transfer. */
  transfers?: PrinterFileTransfers | undefined;
  /** The files this tab is still sending from the browser to this server, for this printer. */
  uploads?: readonly SendsIndicatorRow[] | undefined;
  /** Stops one of those uploads. */
  onCancelUpload?: ((id: string) => void) | undefined;
  /**
   * The picture of the plate behind one file on the printer, keyed by the path
   * the printer addresses it by. Absent for a file that cannot carry one. An
   * address whose request fails is drawn as the file's glyph.
   */
  thumbnailFor?: ((path: string) => string | undefined) | undefined;
}

/** What one row of the listing may ask of the panel that owns it. */
export interface PrinterFileRowContext {
  /** The printer that owns the file, for module file actions. */
  deviceId: string;
  nameOf(entry: PrinterFileEntry): string;
  glyphOf(entry: PrinterFileEntry): Component;
  thumbnailOf(entry: PrinterFileEntry): string | undefined;
  printControl(entry: PrinterFileEntry): CommandControl | undefined;
  isFirmware(entry: PrinterFileEntry): boolean;
  isModel(entry: PrinterFileEntry): boolean;
  canFlash(entry: PrinterFileEntry): boolean;
  canDelete(entry: PrinterFileEntry): boolean;
  shows(field: string): boolean;
  /** The ticked rows, keyed by path. */
  selection: Selection<string>;
  /** Whether a folder may be opened in place, which a search turns off. */
  discloses(): boolean;
  isOpen(entry: PrinterFileEntry): boolean;
  childrenOf(entry: PrinterFileEntry): readonly PrinterFileEntry[] | undefined;
  onDisclose(entry: PrinterFileEntry): void;
  onOpenFolder(path: string): void;
  onPrint(entry: PrinterFileEntry): void;
  onFlash(entry: PrinterFileEntry): void;
  onDelete(entry: PrinterFileEntry): void;
}

/** One reason a set of files was not deleted, in the words of whoever refused. */
export interface RefusalReason {
  /** The files this reason was given for, already joined into a list. */
  readonly names: string;
  readonly detail: string;
}

/** One error code under a delete toast, with each distinct reason it came with. */
export interface RefusalLinesProps {
  readonly title: string;
  readonly reasons: readonly RefusalReason[];
  readonly action?: string | undefined;
  readonly code: string;
}
