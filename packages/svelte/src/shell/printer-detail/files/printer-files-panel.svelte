<!-- What is on the printer's own storage. -->
<script lang="ts">
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';

  import type { DataFault } from '../../../data';
  import {
    type CommandProjection,
    LIFECYCLE_TRANSITIONS,
    newestFirst,
    projectCommand,
    STATE_PATH,
    textAt,
  } from '../../../domain';
  import { describeFault, formatList, t } from '../../../i18n';
  import {
    Button,
    Card,
    CardContent,
    FolderTrail,
    type ListField,
    ListingControls,
    ListingSearchSummary,
    ListingState,
    Selection,
    toast,
    viewModes,
  } from '../../../primitives';
  import { browserStore } from '../../printers/presentation';
  import {
    glyphOf,
    isFirmware,
    isFirmwareName,
    isModel,
    isPrintable,
    nameOf,
    SPLIT_LEADING,
    SPLIT_ROW,
    SPLIT_TRAILING,
  } from './presentation';
  import PrinterFileActions from './printer-file-actions.svelte';
  import PrinterFileListing from './printer-file-listing.svelte';
  import PrinterFilesDialogs from './printer-files-dialogs.svelte';
  import PrinterFilesIngest from './printer-files-ingest.svelte';
  import PrinterFilesToolbar from './printer-files-toolbar.svelte';
  import RefusalLines from './refusal-lines.svelte';

  import { type CommandControl, commandControl } from '../status/presentation';
  import type {
    PrinterFileEntry,
    PrinterFilesPanelProps,
    PrinterFileRowContext,
    PrinterFilesSource,
    RefusalLinesProps,
  } from './types';

  /** The split, at the one tier where both columns fit side by side. */
  const START_PRINT = 'core.command.start_print';
  const CREATE_FOLDER = 'core.command.create_folder';
  const DELETE_FILE = 'core.command.delete_file';
  const DELETE_FOLDER = 'core.command.delete_folder';
  const FLASH = 'core.command.flash';

  let {
    device,
    files,
    commands,
    onUpload,
    transfers,
    uploads,
    onCancelUpload,
    thumbnailFor,
    uploadBlock,
    keep,
    checkingStorages = false,
    onRecheck,
  }: PrinterFilesPanelProps = $props();

  /** The entries a confirmed Delete would remove. Empty closes the dialog. */
  let pending = $state<PrinterFileEntry[]>([]);
  let pendingFlash = $state<PrinterFileEntry | undefined>(undefined);
  let query = $state('');
  let creating = $state(false);
  let folderName = $state('');

  const FIELDS: ListField[] = [
    { id: 'name', label: t('printerDetailFiles.column.name'), required: true },
    { id: 'size', label: t('printerDetailFiles.column.size') },
    { id: 'modified', label: t('printerDetailFiles.column.modified') },
  ];

  // Reads nothing reactive, so it runs once when the panel mounts.
  $effect(() => {
    void files.load();
  });

  const project = (verb: string): CommandProjection =>
    projectCommand(verb, {
      capabilities: device.capabilities,
      // The port's own vocabulary when it fetched one.
      transitions: commands.transitions ?? LIFECYCLE_TRANSITIONS,
      state: textAt(device, STATE_PATH),
      locked: commands.locked ?? false,
      permitted: device.verbs,
    });

  const allows = (verb: string): boolean =>
    commands.sending !== true && project(verb).kind === 'available';

  /** What the row's Print offers. */
  const printControl = (entry: PrinterFileEntry): CommandControl | undefined =>
    !isPrintable(entry)
      ? undefined
      : commandControl(project(START_PRINT), commands.sending === true);

  const canFlash = (entry: PrinterFileEntry): boolean =>
    isFirmware(entry) && allows(FLASH);

  const deleteVerb = (entry: PrinterFileEntry): string =>
    entry.folder ? DELETE_FOLDER : DELETE_FILE;

  const canDelete = (entry: PrinterFileEntry): boolean =>
    !entry.read_only && allows(deleteVerb(entry));

  const refusal = $derived(
    files.filesError === undefined
      ? undefined
      : describeFault(files.filesError),
  );
  const atRoot = $derived(files.directory === '');
  const empty = $derived(files.filesLoaded && files.entries.length === 0);

  /** The drives the printer reports. */
  let drives = $state.raw<PrinterFileEntry[]>([]);

  // A printer with no drive leaves the panel at the root, and the first drive
  // put in later is opened as the first one was.
  let opened = false;
  $effect(() => {
    if (!files.filesLoaded || files.directory !== '') return;

    const found = files.entries.filter((entry) => entry.folder);
    drives = found;

    const first = found[0];
    if (first === undefined) {
      opened = false;
      return;
    }
    if (opened) return;

    opened = true;
    void files.openFolder(first.path);
  });

  // The empty path is where the panel waits for the drives.
  const canCreateFolder = $derived(!atRoot && allows(CREATE_FOLDER));

  // The taker itself rather than a flag.
  const dropzone = $derived(atRoot ? undefined : onUpload);

  /** The drive the open folder is on, which is its first path segment. */
  const drive = $derived(files.directory.split('/')[0] ?? '');

  /** That drive as a person reads it, which only the drives listing carries. */
  const driveName = $derived.by(() => {
    const open = drives.find((entry) => entry.path === drive);

    return open === undefined ? drive : nameOf(open);
  });

  // The first segment is the drive.
  const trail = $derived.by(() => {
    const parts = files.directory.split('/').filter((part) => part !== '');

    return parts.map((part, index) => ({
      label: index === 0 ? driveName : part,
      path: parts.slice(0, index + 1).join('/'),
    }));
  });

  // A transfer that arrived has nothing left to say, and its row sat there
  // reading `Done` until the page was reloaded. One that failed, was stopped
  // or was interrupted stays, because the row is where its reason is written,
  // but only for a transfer the store saw moving: older ones are history.
  const queue = $derived(
    (transfers?.current ?? []).filter((row) => row.state !== 'done'),
  );

  // The root says why on the listing itself, where the drives would be.
  const blocked = $derived(
    atRoot || dropzone !== undefined ? undefined : uploadBlock,
  );

  // The rule divides two columns or it divides nothing.
  const ingesting = $derived(
    dropzone !== undefined ||
      blocked !== undefined ||
      queue.length > 0 ||
      (uploads?.length ?? 0) > 0,
  );

  // A firmware image goes to the top of the drive whatever folder is open,
  // because M997 flashes only a file in the root of the stick.
  const receive = (dropped: File[]): void => {
    const images = dropped.filter((file) => isFirmwareName(file.name));
    const rest = dropped.filter((file) => !isFirmwareName(file.name));

    if (images.length > 0) onUpload?.(images, drive);
    if (rest.length > 0) onUpload?.(rest, files.directory);
  };

  // A search or another folder is a new list, so nothing in it is ticked:
  // a tick the person can no longer see is never acted on.
  const searchFor = (next: string): void => {
    query = next;
    listing.setPage(0);
    selection.clear();
  };

  const clearSearch = (): void => {
    searchFor('');
  };

  const openFolder = (path: string): void => {
    selection.clear();
    void files.openFolder(path);
  };

  const needle = $derived(query.trim().toLowerCase());
  const searching = $derived(needle !== '');
  const matching = $derived(
    searching
      ? files.entries.filter((entry) =>
          nameOf(entry).toLowerCase().includes(needle),
        )
      : files.entries,
  );

  // The printer answers in whatever order its storage walked.
  const byNewest = newestFirst(nameOf);

  /** What an open folder lists, in the order of the listing around it. */
  const childrenOf = (
    entry: PrinterFileEntry,
  ): PrinterFileEntry[] | undefined =>
    files.expanded[entry.path]?.slice().sort(byNewest);

  // A search answers with a flat list of hits.
  const discloses = $derived(!searching);

  /** Whether this folder's own rows are on screen under it. */
  const isOpen = (entry: PrinterFileEntry): boolean =>
    discloses && entry.folder && Object.hasOwn(files.expanded, entry.path);

  /** Expands a folder under its own row, or folds it away. */
  const disclose = (entry: PrinterFileEntry): void => {
    if (Object.hasOwn(files.expanded, entry.path)) {
      files.collapse(entry.path);
    } else {
      void files.expand(entry.path);
    }
  };

  const listing = new ListingState<PrinterFileEntry>({
    id: 'printer-files',
    viewSetting: 'files',
    fields: FIELDS,
    views: viewModes(['table', 'cards']),
    initialView: 'table',
    store: browserStore(),
    rows: () => matching,
    compare: byNewest,
  });

  /** Every row the listing puts on screen, in its order, on every page. */
  const revealed = $derived.by(() => {
    const walk = (rows: readonly PrinterFileEntry[]): PrinterFileEntry[] =>
      rows.flatMap((row) => {
        const children = childrenOf(row);

        return children === undefined ? [row] : [row, ...walk(children)];
      });

    return discloses ? walk(listing.rows) : listing.rows;
  });

  const selection = new Selection<string>({
    rows: () => revealed.map((entry) => entry.path),
  });

  const shows = (field: string): boolean =>
    listing.fields.visible.includes(field);

  const pickedEntries = $derived(
    revealed.filter((entry) => selection.has(entry.path)),
  );
  const deletable = $derived(pickedEntries.filter(canDelete));

  // This answers the folder that holds a path. A write to the path changes
  // that folder.
  const folderOf = (path: string): string =>
    path.slice(0, Math.max(0, path.lastIndexOf('/')));

  // A write changes a folder on screen, so each folder a write touched is
  // read again once the printer has answered.
  const reread = async (
    store: PrinterFilesSource,
    paths: readonly string[],
  ): Promise<void> => {
    const firstInFolder = paths.filter(
      (path, at) =>
        paths.findIndex((other) => folderOf(other) === folderOf(path)) === at,
    );
    for (const path of firstInFolder) await store.changedAt(path);
  };

  // The printer takes one command at a time, so the deletes go one after
  // another. They are sent quiet, and the ones that did not happen are named
  // together at the end. The port and the store are read once, when the
  // delete is confirmed. A port bound to one printer then sends every delete
  // to the printer the person confirmed them on.
  const remove = async (): Promise<void> => {
    const port = commands;
    const store = files;
    const printerName = device.name;
    const entries = pending;
    pending = [];
    selection.clear();
    // The refusals are grouped by their error code, so each code is said once
    // with the files it stopped. Each reason is kept with its own files.
    const refused: Record<
      string,
      { fault: DataFault; names: string[]; reasons: Record<string, string[]> }
    > = {};
    const unsent: PrinterFileEntry[] = [];
    for (const entry of entries) {
      const outcome = await port.onCommand(
        deleteVerb(entry),
        { path: entry.path },
        { quiet: true },
      );
      if (outcome.kind === 'unsent') unsent.push(entry);
      if (outcome.kind === 'refused' && outcome.fault !== undefined) {
        const group = (refused[outcome.fault.code] ??= {
          fault: outcome.fault,
          names: [],
          reasons: {},
        });
        group.names.push(nameOf(entry));
        const reason = outcome.fault.message ?? '';
        (group.reasons[reason] ??= []).push(nameOf(entry));
      }
    }
    await reread(
      store,
      entries.map((entry) => entry.path),
    );
    for (const { fault, names, reasons } of Object.values(refused)) {
      toast.error(
        t('printerDetailFiles.delete.refused', {
          printer: printerName,
          names: formatList(names),
        }),
        {
          description: RefusalLines,
          componentProps: refusalLines(fault, reasons),
        },
      );
    }
    if (unsent.length > 0) {
      toast.error(
        t('printerDetailFiles.delete.unsent', {
          printer: printerName,
          names: formatList(unsent.map(nameOf)),
        }),
      );
    }
  };

  // The parts of one error under a toast. The title comes from the catalogue
  // by the code, and a reason is left out where the printer gave none.
  const refusalLines = (
    fault: DataFault,
    reasons: Record<string, string[]>,
  ): RefusalLinesProps => {
    const text = describeFault({ code: fault.code, params: fault.params });

    return {
      title: text.title,
      reasons: Object.entries(reasons)
        .filter(([detail]) => detail !== '')
        .map(([detail, files]) => ({ detail, names: formatList(files) })),
      action: text.action,
      code: fault.code,
    };
  };

  const flash = (): void => {
    const entry = pendingFlash;
    pendingFlash = undefined;
    if (entry === undefined) return;

    void commands.onCommand(FLASH, { path: entry.path });
  };

  // A path segment and never a path.
  const folderFault = $derived(
    folderName.includes('/')
      ? t('printerDetailFiles.newFolder.invalid')
      : undefined,
  );

  const createFolder = (): void => {
    const segment = folderName.trim();
    creating = false;
    folderName = '';
    if (segment === '') return;

    const store = files;
    const path = `${store.directory}/${segment}`;
    void commands
      .onCommand(CREATE_FOLDER, { path })
      .then(() => reread(store, [path]));
  };

  // A range or "Select all" sweeps folders in with the files, and a folder
  // goes with everything inside it, so the title counts the two apart.
  const bulkTitle = (files: number, folders: number): string => {
    if (folders === 0) {
      return t('printerDetailFiles.bulk.titleFiles', { count: files });
    }
    if (files === 0) {
      return t('printerDetailFiles.bulk.titleFolders', { count: folders });
    }

    return t('printerDetailFiles.bulk.titleBoth', { files, folders });
  };

  const deleteTitle = $derived(
    pending.length === 1
      ? t('printerDetailFiles.delete.title', {
          name: pending[0] === undefined ? '' : nameOf(pending[0]),
        })
      : bulkTitle(
          pending.filter((entry) => !entry.folder).length,
          pending.filter((entry) => entry.folder).length,
        ),
  );

  const rowContext: PrinterFileRowContext = $derived.by(() => ({
    deviceId: device.id,
    nameOf,
    glyphOf,
    thumbnailOf: (entry) => thumbnailFor?.(entry.path),
    printControl,
    isFirmware,
    isModel,
    canFlash,
    canDelete,
    shows,
    selection,
    discloses: () => discloses,
    isOpen,
    childrenOf,
    onDisclose: disclose,
    onOpenFolder: openFolder,
    onPrint: (entry) => {
      void commands.onCommand(START_PRINT, { path: entry.path });
    },
    onFlash: (entry) => {
      pendingFlash = entry;
    },
    onDelete: (entry) => {
      pending = [entry];
    },
  }));

  const deleteNote = $derived(
    pending.some((entry) => entry.folder)
      ? t('printerDetailFiles.delete.folderNote')
      : t('printerDetailFiles.delete.fileNote'),
  );
</script>

<!-- One definition of what a file offers. -->
{#snippet tileActions(entry: PrinterFileEntry)}
  <PrinterFileActions {entry} row={rowContext} />
{/snippet}

<div class="@container/printer-files flex flex-col gap-4">
  <Card>
    <CardContent class={SPLIT_ROW}>
      <div
        class={[
          'flex min-w-0 flex-1 flex-col gap-3',
          ingesting && SPLIT_TRAILING,
        ]}
      >
        <PrinterFilesToolbar
          {selection}
          {deletable}
          {query}
          {drives}
          {drive}
          {canCreateFolder}
          {nameOf}
          onQuery={searchFor}
          onDelete={() => {
            pending = [...deletable];
          }}
          onOpenDrive={openFolder}
          onNewFolder={() => {
            creating = true;
          }}
        />
        <!-- The view switch rides this row rather than the toolbar above. -->
        <div class="flex items-center gap-3">
          {#if searching}
            <ListingSearchSummary
              summary={t('printerDetailFiles.search.results', {
                count: listing.total,
              })}
              clearLabel={t('printerDetailFiles.search.clear')}
              onClear={clearSearch}
            />
          {:else if !atRoot}
            <FolderTrail
              crumbs={trail}
              label={t('printerDetailFiles.trail.label')}
              onOpen={openFolder}
            />
          {/if}
          <Button
            class="ms-auto shrink-0"
            variant="ghost"
            size="icon-md"
            label={t('printerDetailFiles.refresh')}
            disabled={files.filesRefreshing}
            aria-busy={files.filesRefreshing}
            onclick={() => void files.openFolder(files.directory, true)}
          >
            <RefreshCwIcon aria-hidden="true" />
          </Button>
          <ListingControls
            class="shrink-0"
            fields={FIELDS}
            fieldState={listing.fields}
            view={listing.view}
          />
        </div>

        <PrinterFileListing
          {listing}
          row={rowContext}
          actions={tileActions}
          {refusal}
          onRetry={() => void files.openFolder(files.directory, true)}
          loading={files.filesLoading}
          busy={files.filesRefreshing}
          readingSince={files.filesReadingSince}
          unread={files.filesUnread}
          {searching}
          {query}
          {empty}
          {atRoot}
          rootBlock={uploadBlock === 'storagesUnknown'
            ? uploadBlock
            : 'noStorage'}
          {checkingStorages}
          {onRecheck}
          onClearSearch={clearSearch}
        />
      </div>

      {#if ingesting}
        <PrinterFilesIngest
          class={SPLIT_LEADING}
          {dropzone}
          {driveName}
          {queue}
          {transfers}
          {uploads}
          {onCancelUpload}
          onFiles={receive}
          {keep}
          block={blocked}
          checking={checkingStorages}
          {onRecheck}
        />
      {/if}
    </CardContent>
  </Card>
</div>

<PrinterFilesDialogs
  {creating}
  {folderName}
  {folderFault}
  flashing={pendingFlash}
  deleting={pending}
  {deleteTitle}
  {deleteNote}
  {nameOf}
  onCreatingChange={(open: boolean) => {
    creating = open;
    if (!open) folderName = '';
  }}
  onFolderName={(next: string) => {
    folderName = next;
  }}
  onCreate={createFolder}
  onFlashCancel={() => {
    pendingFlash = undefined;
  }}
  onFlash={flash}
  onDeleteCancel={() => {
    pending = [];
  }}
  onDelete={remove}
/>
