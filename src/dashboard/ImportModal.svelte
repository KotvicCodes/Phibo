<script lang="ts">
  import { createEventDispatcher } from "svelte"
  import type { AuthTokenRow } from "../lib/db/types"
  import { formatConnectionDate } from "./format"

  export let hasLocalData: boolean
  export let isImporting: boolean
  export let importMessage: string
  export let isOuraConnected: boolean
  export let isEditingToken: boolean
  export let savedOuraToken: AuthTokenRow | null
  export let isSyncing: boolean
  export let syncMessage: string
  export let accessToken: string
  export let startDate: string
  export let endDate: string

  let importFileInput: HTMLInputElement | null = null

  const dispatch = createEventDispatcher<{
    close: null
    importFiles: File[]
    connect: null
    sync: null
    disconnect: null
    changeKey: null
    cancelKeyChange: null
  }>()

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      dispatch("close")
    }
  }

  function handleFileInput(event: Event) {
    const input = event.currentTarget

    if (!(input instanceof HTMLInputElement)) {
      return
    }

    dispatch("importFiles", Array.from(input.files ?? []))
    input.value = ""
  }

  function handleDrop(event: DragEvent) {
    dispatch("importFiles", Array.from(event.dataTransfer?.files ?? []))
  }
</script>

<div class="modal-backdrop" role="presentation" on:click={handleBackdropClick}>
  <section
    class="import-modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="import-modal-title"
  >
    <div class="modal-header">
      <div>
        <p class="section-kicker">{hasLocalData ? "Local data" : "Private import"}</p>
        <h2 id="import-modal-title">Import Oura data</h2>
      </div>
      <button type="button" class="modal-close" on:click={() => dispatch("close")}>
        Close
      </button>
    </div>

    <div class="modal-grid">
      <section class="modal-instructions">
        <p>
          Download your Oura personal data export, then import it here. Files are read locally and never uploaded.
        </p>
        <ol class="import-steps">
          <li>
            Open
            <a href="https://membership.ouraring.com" target="_blank" rel="noreferrer">
              Oura Membership Hub
            </a>
          </li>
          <li>Choose Export data, request your data, then download the export.</li>
          <li>Import the ZIP, JSON, or CSV files into Phibo.</li>
        </ol>
      </section>

      <div
        class="import-panel"
        role="group"
        aria-label="Import Oura export files"
        on:dragover|preventDefault
        on:drop|preventDefault={handleDrop}
      >
        <input
          bind:this={importFileInput}
          class="file-input"
          type="file"
          accept=".zip,.json,.csv"
          multiple
          on:change={handleFileInput}
        />
        <div>
          <strong>{isImporting ? "Importing Oura export" : "Drop Oura export here"}</strong>
          <span>Supports the Oura ZIP or CSVs like dailysleep, dailyreadiness, dailyactivity, and enhancedtag.</span>
        </div>
        <button type="button" on:click={() => importFileInput?.click()} disabled={isImporting}>
          {isImporting ? "Reading files" : "Choose files"}
        </button>
        <p>{importMessage}</p>
      </div>
    </div>

    <details class="advanced-sync" open={isOuraConnected || isEditingToken}>
      <summary>Automatic sync with Oura key</summary>
      <div class="sync-strip compact">
        <div>
          <p class="section-kicker">{isOuraConnected ? "Connected locally" : "Optional"}</p>
          <h2>{isOuraConnected ? "Oura key saved on this device" : "Connect with your Oura key"}</h2>
          <p class="privacy-note">
            Automatic sync stores your key locally. Import is the recommended path if you prefer not to grant API access.
          </p>
        </div>
        {#if isOuraConnected && savedOuraToken}
          <div class="connection-panel">
            <div class="connection-status">
              <div>
                <span>Saved key</span>
                <strong aria-label="Oura key is hidden">•••• •••• ••••</strong>
              </div>
              <div>
                <span>Validated</span>
                <strong>{formatConnectionDate(savedOuraToken.lastValidatedAt)}</strong>
              </div>
              <div>
                <span>Last synced</span>
                <strong>{formatConnectionDate(savedOuraToken.lastSyncedAt)}</strong>
              </div>
            </div>
            <form class="sync-form connected" on:submit|preventDefault={() => dispatch("sync")}>
              <label>
                <span>Start</span>
                <input bind:value={startDate} type="date" />
              </label>
              <label>
                <span>End</span>
                <input bind:value={endDate} type="date" />
              </label>
              <div class="connection-actions">
                <button type="submit" disabled={isSyncing}>
                  {isSyncing ? "Syncing" : "Sync data"}
                </button>
                <button type="button" class="secondary" on:click={() => dispatch("changeKey")}>
                  Change key
                </button>
                <button type="button" class="danger" on:click={() => dispatch("disconnect")}>
                  Disconnect
                </button>
              </div>
              <p>{syncMessage}</p>
            </form>
          </div>
        {:else}
          <form class="sync-form" on:submit|preventDefault={() => dispatch("connect")}>
            <label>
              <span>Oura key</span>
              <input
                bind:value={accessToken}
                type="password"
                autocomplete="off"
                placeholder="Paste Oura personal access token"
              />
            </label>
            <label>
              <span>Start</span>
              <input bind:value={startDate} type="date" />
            </label>
            <label>
              <span>End</span>
              <input bind:value={endDate} type="date" />
            </label>
            <div class="connection-actions">
              <button type="submit" disabled={isSyncing}>
                {isSyncing ? "Connecting" : "Connect & sync"}
              </button>
              {#if savedOuraToken}
                <button type="button" class="secondary" on:click={() => dispatch("cancelKeyChange")}>
                  Cancel
                </button>
              {/if}
              <a
                href="https://cloud.ouraring.com/personal-access-tokens"
                target="_blank"
                rel="noreferrer"
              >
                Open Oura keys
              </a>
            </div>
            <p class="key-help">
              Find or create your key in
              <a
                href="https://cloud.ouraring.com/personal-access-tokens"
                target="_blank"
                rel="noreferrer"
              >
                Oura Cloud Personal Access Tokens
              </a>
              and enable daily and tag access.
            </p>
            <p>{syncMessage}</p>
          </form>
        {/if}
      </div>
    </details>
  </section>
</div>

<style>
  .sync-strip {
    display: grid;
    grid-template-columns: minmax(220px, 0.85fr) minmax(260px, 1.15fr);
    gap: 1rem;
    width: min(1180px, 100%);
    margin-inline: auto;
  }

  .modal-backdrop {
    align-items: center;
    background: rgba(23, 32, 27, 0.42);
    display: grid;
    inset: 0;
    justify-items: center;
    padding: 1.2rem;
    position: fixed;
    z-index: 20;
  }

  .import-modal {
    background: #fbf7ef;
    border: 1px solid #d3d5c8;
    border-radius: 8px;
    box-shadow: 0 24px 80px rgba(23, 32, 27, 0.22);
    box-sizing: border-box;
    display: grid;
    gap: 1rem;
    max-height: calc(100vh - 2.4rem);
    max-width: 920px;
    overflow: auto;
    padding: 1rem;
    width: min(920px, 100%);
  }

  .modal-header {
    align-items: flex-start;
    border-bottom: 1px solid #d8d8cc;
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    padding-bottom: 0.85rem;
  }

  .modal-close {
    appearance: none;
    background: #f7f1e8;
    border: 1px solid #c5cbbd;
    border-radius: 8px;
    color: #17201b;
    cursor: pointer;
    font: inherit;
    font-size: 0.84rem;
    font-weight: 800;
    min-height: 38px;
    padding: 0.5rem 0.72rem;
  }

  .modal-grid {
    align-items: stretch;
    display: grid;
    grid-template-columns: minmax(230px, 0.78fr) minmax(320px, 1.22fr);
    gap: 0.85rem;
  }

  .modal-instructions {
    display: grid;
    align-content: start;
    gap: 0.55rem;
  }

  .modal-instructions > p {
    color: #566157;
    font-size: 0.9rem;
    line-height: 1.45;
  }

  .sync-strip.compact {
    border-top: 1px solid #d8d8cc;
    padding-top: 1rem;
  }

  .privacy-note {
    color: #566157;
    font-size: 0.9rem;
    line-height: 1.45;
    margin-top: 0.45rem;
    max-width: 34rem;
  }

  .import-steps {
    color: #566157;
    display: grid;
    gap: 0.32rem;
    font-size: 0.9rem;
    line-height: 1.45;
    margin: 0.7rem 0 0;
    padding-left: 1.25rem;
  }

  .import-steps a,
  .key-help a {
    color: #263f6f;
    font-weight: 800;
  }

  .import-panel {
    align-items: center;
    border: 1px dashed #b8c1af;
    border-radius: 8px;
    background: rgba(255, 252, 246, 0.52);
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.75rem;
    min-height: 174px;
    padding: 1rem;
  }

  .import-panel div {
    display: grid;
    gap: 0.22rem;
    min-width: 0;
  }

  .import-panel strong {
    font-size: 1.05rem;
  }

  .import-panel span,
  .import-panel p {
    color: #566157;
    font-size: 0.9rem;
    line-height: 1.45;
  }

  .import-panel p {
    grid-column: 1 / -1;
  }

  .import-panel button {
    appearance: none;
    border: 1px solid #1d2a22;
    border-radius: 8px;
    background: #1d2a22;
    color: #f8f3ea;
    cursor: pointer;
    font: inherit;
    font-weight: 800;
    min-height: 42px;
    padding: 0.58rem 0.8rem;
    white-space: nowrap;
  }

  .import-panel button:disabled {
    cursor: wait;
    opacity: 0.72;
  }

  .file-input {
    display: none;
  }

  .advanced-sync {
    display: grid;
    gap: 0.8rem;
  }

  .advanced-sync summary {
    color: #4f5f53;
    cursor: pointer;
    font-size: 0.82rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .connection-panel {
    display: grid;
    gap: 0.7rem;
    min-width: 0;
  }

  .connection-status {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.55rem;
  }

  .connection-status div {
    border: 1px solid #d8d8cc;
    border-radius: 8px;
    background: rgba(255, 252, 246, 0.52);
    min-width: 0;
    padding: 0.65rem 0.7rem;
  }

  .connection-status span,
  .connection-actions a {
    color: #6f786f;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
  }

  .connection-status strong {
    display: block;
    font-size: 0.92rem;
    line-height: 1.25;
    margin-top: 0.2rem;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sync-form {
    display: grid;
    grid-template-columns: minmax(180px, 1.2fr) minmax(130px, 0.55fr) minmax(
        130px,
        0.55fr
      );
    gap: 0.65rem;
  }

  .sync-form.connected {
    grid-template-columns: minmax(130px, 0.55fr) minmax(130px, 0.55fr) minmax(
        260px,
        1fr
      );
  }

  .sync-form label {
    display: grid;
    gap: 0.3rem;
  }

  .sync-form span {
    color: #6f786f;
    font-size: 0.72rem;
    font-weight: 750;
    text-transform: uppercase;
  }

  .sync-form input {
    width: 100%;
    min-width: 0;
    border: 1px solid #cdcfc2;
    border-radius: 8px;
    background: #fbf7ef;
    box-sizing: border-box;
    color: #17201b;
    font: inherit;
    padding: 0.68rem 0.75rem;
  }

  .connection-actions {
    align-items: end;
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    min-width: 0;
  }

  .connection-actions button,
  .connection-actions a {
    align-items: center;
    appearance: none;
    border: 1px solid #c5cbbd;
    border-radius: 8px;
    background: #fbf7ef;
    color: #17201b;
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    font-size: 0.84rem;
    font-weight: 800;
    justify-content: center;
    min-height: 42px;
    padding: 0.58rem 0.72rem;
    text-decoration: none;
    white-space: nowrap;
  }

  .connection-actions button[type="submit"] {
    background: #1d2a22;
    border-color: #1d2a22;
    color: #f8f3ea;
  }

  .connection-actions button:disabled {
    cursor: wait;
    opacity: 0.72;
  }

  .connection-actions .secondary {
    background: #f7f1e8;
  }

  .connection-actions .danger {
    border-color: #d2b5a5;
    color: #8a3f2f;
  }

  .sync-form p {
    grid-column: 1 / -1;
    color: #566157;
    font-size: 0.9rem;
    line-height: 1.45;
  }

  @media (max-width: 820px) {
    .modal-grid,
    .import-panel,
    .sync-strip,
    .sync-form,
    .sync-form.connected,
    .connection-status {
      grid-template-columns: 1fr;
    }
  }
</style>
